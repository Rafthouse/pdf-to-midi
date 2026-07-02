"""Orchestration + in-memory registry.

process_pdf() runs the full pipeline:
    PDF -> Audiveris (MusicXML) -> music21 parse -> NoteEvents + timeline
        -> MIDI export -> ScoreDocument (also persisted as JSON on disk).

Jobs and documents are held in memory and mirrored to WORK_DIR so a restart can
reload them. Designed to be driven either by the FastAPI app or the CLI.
"""
from __future__ import annotations

import json
import shutil
import uuid
import zipfile
from pathlib import Path

from . import config
from .models import ScoreDocument, JobStatus, NoteEdit
from .omr import run_omr, OMRError
from .parsing import parse_musicxml, build_timeline, midi_to_pitch
from .midi import write_midi, write_midi_from_events
from .notation import write_musicxml_from_events
from .analysis import compute_measure_issues, recompute_measure_onsets, auto_fix_dropped_dots


_jobs: dict[str, JobStatus] = {}
_docs: dict[str, ScoreDocument] = {}


def load_persisted() -> int:
    """Reload previously processed/edited documents from disk so a sidecar
    restart never loses work. Returns the number of documents loaded."""
    root = config.ensure_work_dir()
    count = 0
    for dj in sorted(root.glob("*/document.json")):
        try:
            doc = ScoreDocument.model_validate_json(dj.read_text(encoding="utf-8"))
        except Exception:
            continue
        _docs[doc.id] = doc
        _jobs[doc.id] = JobStatus(id=doc.id, state="done",
                                  source_pdf=doc.source_pdf, document_id=doc.id)
        count += 1
    return count


def _job_dir(job_id: str) -> Path:
    return config.ensure_work_dir() / job_id


def _render_pdf_pages(pdf_path: Path, out_dir: Path, dpi: int = 150) -> int:
    """Render each PDF page to page-{n}.png (1-based). Returns the page count."""
    try:
        import fitz  # pymupdf
    except Exception:
        return 0
    count = 0
    try:
        with fitz.open(str(pdf_path)) as doc:
            for i in range(doc.page_count):
                pix = doc[i].get_pixmap(dpi=dpi)
                pix.save(str(out_dir / f"page-{i + 1}.png"))
                count += 1
    except Exception:
        return count
    return count


def page_image_path(doc_id: str, page: int) -> Path:
    return _job_dir(doc_id) / f"page-{page}.png"


def create_job(pdf_path: Path) -> JobStatus:
    job_id = uuid.uuid4().hex[:12]
    job = JobStatus(id=job_id, state="pending", source_pdf=str(pdf_path))
    _jobs[job_id] = job
    return job


def get_job(job_id: str) -> JobStatus | None:
    return _jobs.get(job_id)


def get_document(doc_id: str) -> ScoreDocument | None:
    return _docs.get(doc_id)


def list_documents() -> list[ScoreDocument]:
    return list(_docs.values())


def document_mtime(doc_id: str) -> float:
    f = _job_dir(doc_id) / "document.json"
    try:
        return f.stat().st_mtime
    except OSError:
        return 0.0


def run_job(job_id: str) -> JobStatus:
    """Execute the pipeline for a pending job (synchronous)."""
    job = _jobs[job_id]
    job.state = "running"
    try:
        doc = process_pdf(Path(job.source_pdf), doc_id=job_id)
        job.state = "done"
        job.document_id = doc.id
    except Exception as exc:  # noqa: BLE001 - surfaced to the client honestly
        job.state = "error"
        job.error = f"{type(exc).__name__}: {exc}"
    return job


def process_pdf(pdf_path: Path, doc_id: str | None = None) -> ScoreDocument:
    pdf_path = Path(pdf_path)
    doc_id = doc_id or uuid.uuid4().hex[:12]
    work = _job_dir(doc_id)
    work.mkdir(parents=True, exist_ok=True)

    # Stage the input so the document is self-contained.
    staged_pdf = work / pdf_path.name
    if pdf_path.resolve() != staged_pdf.resolve():
        shutil.copy2(pdf_path, staged_pdf)

    # 0) Render original PDF pages to PNG for side-by-side comparison (spec 4.5).
    page_count = _render_pdf_pages(staged_pdf, work)

    # 1) OMR -> MusicXML
    mxl = run_omr(staged_pdf, work)

    # 1b) Extract uncompressed XML (OSMD loads plain MusicXML most reliably).
    xml_path = None
    try:
        with zipfile.ZipFile(mxl) as z:
            inner = [n for n in z.namelist()
                     if n.endswith(".xml") and "META-INF" not in n]
            if inner:
                xml_path = work / (mxl.stem + ".xml")
                xml_path.write_bytes(z.read(inner[0]))
    except Exception:
        xml_path = None

    # 2) Parse -> model
    meta, events, warnings = parse_musicxml(mxl)
    meta.num_pages = page_count or None

    # 2b) Auto-correct the common Audiveris "dropped dot" rhythm error.
    autofixed = auto_fix_dropped_dots(events, meta)
    if autofixed:
        warnings.append(f"Авто-виправлено пропущені крапки в тактах: {autofixed} "
                        f"(перевірте; можна змінити в «Корекція»)")

    timeline = build_timeline(events)
    issues = compute_measure_issues(events, meta)
    if issues:
        shorts = sorted({i.measure for i in issues})
        warnings.append(f"Підозрілі такти (тривалості не сходяться): {shorts}")

    # 3) MIDI export
    midi_path = work / (mxl.stem + ".mid")
    try:
        write_midi(mxl, midi_path)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"MIDI export failed: {exc}")
        midi_path = None

    doc = ScoreDocument(
        id=doc_id,
        source_pdf=str(staged_pdf),
        musicxml_path=str(mxl),
        musicxml_xml_path=str(xml_path) if xml_path else None,
        midi_path=str(midi_path) if midi_path else None,
        meta=meta,
        events=events,
        timeline=timeline,
        measure_issues=issues,
        warnings=warnings,
    )
    _docs[doc_id] = doc
    _persist(doc)
    return doc


def _persist(doc: ScoreDocument) -> None:
    (_job_dir(doc.id) / "document.json").write_text(
        doc.model_dump_json(indent=2), encoding="utf-8"
    )


def apply_edits(doc_id: str, edits: list[NoteEdit]) -> ScoreDocument:
    """Apply manual note corrections, then re-derive timeline, issues and MIDI
    so playback and exports reflect the fixes immediately."""
    doc = _docs[doc_id]
    by_id = {e.id: e for e in doc.events}

    touched_measures: set[int] = set()
    for edit in edits:
        ev = by_id.get(edit.event_id)
        if ev is None:
            continue
        if edit.midi is not None:
            ev.pitches = [midi_to_pitch(m) for m in edit.midi]
            ev.is_rest = len(ev.pitches) == 0
        if edit.duration_ql is not None:
            ev.duration_ql = float(edit.duration_ql)
        touched_measures.add(ev.measure)

    for m in touched_measures:
        recompute_measure_onsets(doc.events, m, doc.meta)

    doc.events.sort(key=lambda e: (e.onset_ql, e.part))
    doc.timeline = build_timeline(doc.events)
    doc.measure_issues = compute_measure_issues(doc.events, doc.meta)
    doc.revision += 1

    # Regenerate MIDI + MusicXML from the edited model so both playback and the
    # on-screen score reflect the corrections (the OMR MusicXML is now stale).
    if doc.midi_path:
        try:
            write_midi_from_events(doc.events, doc.meta, Path(doc.midi_path))
        except Exception as exc:  # noqa: BLE001
            doc.warnings.append(f"MIDI re-export failed: {exc}")
    if doc.musicxml_xml_path:
        try:
            write_musicxml_from_events(doc.events, doc.meta, Path(doc.musicxml_xml_path))
        except Exception as exc:  # noqa: BLE001
            doc.warnings.append(f"MusicXML re-export failed: {exc}")

    _persist(doc)
    return doc
