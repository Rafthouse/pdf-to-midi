"""FastAPI Integration API (spec section 9.1).

Local desktop sidecar: the Electron app (or any external consumer) drives the
OMR pipeline over HTTP and pulls structured notes, a highlight timeline, and
exported MIDI/MusicXML.

Run:  uvicorn app.main:app --port 8765
Docs: http://127.0.0.1:8765/docs
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import __version__, config, service
from .models import ScoreDocument, ScoreMeta, JobStatus, NoteEvent, HighlightEvent, NoteEdit

app = FastAPI(
    title="PDF2MIDI OMR sidecar",
    version=__version__,
    description="PDF -> MusicXML (Audiveris) -> MIDI + JSON timeline.",
)

# Local desktop app: the Electron renderer (vite dev server / file://) calls us
# from a different origin, so allow it. Bound to localhost in practice.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _load_persisted() -> None:
    n = service.load_persisted()
    print(f"[sidecar] reloaded {n} persisted document(s) from disk")


class ImportRequest(BaseModel):
    path: str  # absolute path to a local PDF


class DocumentSummary(BaseModel):
    id: str
    title: str | None
    composer: str | None
    num_measures: int
    num_parts: int
    num_events: int
    duration_sec: float
    revision: int
    num_issues: int
    modified: float          # document.json mtime (epoch seconds) for ordering
    warnings: list[str]


@app.get("/")
def root() -> dict:
    return {
        "service": "pdf2midi-omr-sidecar",
        "version": __version__,
        "audiveris": str(config.AUDIVERIS_EXE),
        "audiveris_found": config.AUDIVERIS_EXE.exists(),
        "work_dir": str(config.WORK_DIR),
    }


@app.post("/import", response_model=JobStatus)
def import_pdf(req: ImportRequest, background: BackgroundTasks) -> JobStatus:
    pdf = Path(req.path)
    if not pdf.exists():
        raise HTTPException(404, f"PDF not found: {pdf}")
    job = service.create_job(pdf)
    background.add_task(service.run_job, job.id)
    return job


@app.post("/import/upload", response_model=JobStatus)
async def import_upload(background: BackgroundTasks, file: UploadFile = File(...)) -> JobStatus:
    suffix = Path(file.filename or "upload.pdf").suffix or ".pdf"
    tmp = Path(tempfile.gettempdir()) / f"pdf2midi_{file.filename}"
    tmp.write_bytes(await file.read())
    job = service.create_job(tmp)
    background.add_task(service.run_job, job.id)
    return job


@app.get("/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: str) -> JobStatus:
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


def _require_doc(doc_id: str) -> ScoreDocument:
    doc = service.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    return doc


@app.get("/documents", response_model=list[DocumentSummary])
def list_documents() -> list[DocumentSummary]:
    out = []
    for d in service.list_documents():
        out.append(DocumentSummary(
            id=d.id, title=d.meta.title, composer=d.meta.composer,
            num_measures=d.meta.num_measures, num_parts=d.meta.num_parts,
            num_events=len(d.events), duration_sec=d.meta.duration_sec,
            revision=d.revision, num_issues=len(d.measure_issues),
            modified=service.document_mtime(d.id),
            warnings=d.warnings,
        ))
    # Most recently modified first — the user's latest work on top.
    out.sort(key=lambda s: s.modified, reverse=True)
    return out


@app.get("/documents/{doc_id}", response_model=ScoreDocument)
def get_document(doc_id: str) -> ScoreDocument:
    return _require_doc(doc_id)


@app.get("/documents/{doc_id}/meta", response_model=ScoreMeta)
def get_meta(doc_id: str) -> ScoreMeta:
    return _require_doc(doc_id).meta


@app.get("/documents/{doc_id}/events", response_model=list[NoteEvent])
def get_events(doc_id: str) -> list[NoteEvent]:
    return _require_doc(doc_id).events


@app.get("/documents/{doc_id}/timeline", response_model=list[HighlightEvent])
def get_timeline(doc_id: str) -> list[HighlightEvent]:
    return _require_doc(doc_id).timeline


@app.post("/documents/{doc_id}/edit", response_model=ScoreDocument)
def edit_document(doc_id: str, edits: list[NoteEdit]) -> ScoreDocument:
    """Apply manual note corrections (pitch/duration) and return the updated
    document with rebuilt timeline, measure-issues and MIDI."""
    _require_doc(doc_id)
    return service.apply_edits(doc_id, edits)


@app.get("/documents/{doc_id}/midi")
def get_midi(doc_id: str) -> FileResponse:
    doc = _require_doc(doc_id)
    if not doc.midi_path or not Path(doc.midi_path).exists():
        raise HTTPException(404, "MIDI not available")
    return FileResponse(doc.midi_path, media_type="audio/midi",
                        filename=Path(doc.midi_path).name)


@app.get("/documents/{doc_id}/musicxml")
def get_musicxml(doc_id: str) -> FileResponse:
    doc = _require_doc(doc_id)
    if not doc.musicxml_path or not Path(doc.musicxml_path).exists():
        raise HTTPException(404, "MusicXML not available")
    return FileResponse(doc.musicxml_path, media_type="application/vnd.recordare.musicxml",
                        filename=Path(doc.musicxml_path).name)


@app.get("/documents/{doc_id}/page/{page}")
def get_page_image(doc_id: str, page: int) -> FileResponse:
    """Rendered PNG of original PDF page `page` (1-based) for comparison."""
    _require_doc(doc_id)
    img = service.page_image_path(doc_id, page)
    if not img.exists():
        raise HTTPException(404, f"page {page} not found")
    return FileResponse(img, media_type="image/png")


@app.get("/documents/{doc_id}/musicxml.xml")
def get_musicxml_xml(doc_id: str) -> FileResponse:
    """Uncompressed MusicXML — what OpenSheetMusicDisplay loads most reliably."""
    doc = _require_doc(doc_id)
    if not doc.musicxml_xml_path or not Path(doc.musicxml_xml_path).exists():
        raise HTTPException(404, "uncompressed MusicXML not available")
    return FileResponse(doc.musicxml_xml_path, media_type="application/xml",
                        filename=Path(doc.musicxml_xml_path).name)
