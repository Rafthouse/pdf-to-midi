"""Parse MusicXML into the internal model (models.py) using music21.

Responsibilities:
  * read score metadata (title, composer, parts, time/key/tempo);
  * flatten every part into NoteEvents with both musical time (quarter-lengths)
    and wall-clock time (seconds), via a piecewise tempo map;
  * surface honest warnings about anything that looks suspect.

This module is OMR-engine agnostic: it only consumes MusicXML, so any engine
that emits MusicXML plugs in unchanged.
"""
from __future__ import annotations

from bisect import bisect_right
from pathlib import Path

from music21 import converter, tempo, meter, key as m21key, note as m21note, chord as m21chord

from . import config
from .models import (
    BBox, Pitch, NoteEvent, TimeSignature, KeySignature, TempoMark,
    ScoreMeta, HighlightEvent,
)


# --------------------------------------------------------------------------- #
# Tempo map: convert a quarter-length offset to seconds with tempo changes.
# --------------------------------------------------------------------------- #
class TempoMap:
    def __init__(self, changes: list[tuple[float, float]]):
        # changes: sorted list of (offset_ql, bpm); always starts at offset 0.
        if not changes or changes[0][0] > 0:
            changes = [(0.0, config.DEFAULT_TEMPO_BPM)] + changes
        changes.sort(key=lambda c: c[0])
        self._offsets = [c[0] for c in changes]
        self._bpms = [c[1] for c in changes]
        # Precompute cumulative seconds at each tempo-change boundary.
        self._secs = [0.0]
        for i in range(1, len(self._offsets)):
            span_ql = self._offsets[i] - self._offsets[i - 1]
            sec_per_ql = 60.0 / self._bpms[i - 1]
            self._secs.append(self._secs[-1] + span_ql * sec_per_ql)

    def seconds_at(self, offset_ql: float) -> float:
        i = bisect_right(self._offsets, offset_ql) - 1
        if i < 0:
            i = 0
        sec_per_ql = 60.0 / self._bpms[i]
        return self._secs[i] + (offset_ql - self._offsets[i]) * sec_per_ql


def _pitch_name(step: str, alter: int, octave: int) -> str:
    if alter > 0:
        acc = "#" * alter
    elif alter < 0:
        acc = "b" * (-alter)
    else:
        acc = ""
    return f"{step}{acc}{octave}"


_SHARP_SPELL = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
_SHARP_ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]


def midi_to_pitch(m: int) -> Pitch:
    """Build a Pitch from a MIDI number (sharp spelling)."""
    pc = ((m % 12) + 12) % 12
    octave = m // 12 - 1
    step = _SHARP_SPELL[pc]
    alter = _SHARP_ALTER[pc]
    return Pitch(step=step, alter=alter, octave=octave, midi=m,
                 name=_pitch_name(step, alter, octave))


def _to_pitch(p) -> Pitch:
    alter = int(p.alter) if p.alter is not None else 0
    return Pitch(
        step=p.step,
        alter=alter,
        octave=p.octave if p.octave is not None else 4,
        midi=int(p.midi),
        name=_pitch_name(p.step, alter, p.octave if p.octave is not None else 4),
    )


def _collect_tempo_map(score) -> tuple[TempoMap, list[TempoMark]]:
    marks: list[tuple[float, float]] = []
    for mm in score.flatten().getElementsByClass(tempo.MetronomeMark):
        bpm = None
        try:
            bpm = mm.getQuarterBPM()
        except Exception:
            bpm = mm.number
        if bpm:
            marks.append((float(mm.offset), float(bpm)))
    tmap = TempoMap(marks)
    tempos = [TempoMark(onset_ql=o, bpm=b) for o, b in zip(tmap._offsets, tmap._bpms)]
    return tmap, tempos


def _collect_signatures(part) -> tuple[list[TimeSignature], list[KeySignature]]:
    tsigs: list[TimeSignature] = []
    ksigs: list[KeySignature] = []
    flat = part.flatten()
    for ts in flat.getElementsByClass(meter.TimeSignature):
        tsigs.append(TimeSignature(
            measure=ts.measureNumber or 0,
            numerator=ts.numerator,
            denominator=ts.denominator,
        ))
    for ks in flat.getElementsByClass(m21key.KeySignature):
        mode = getattr(ks, "mode", None)
        ksigs.append(KeySignature(
            measure=ks.measureNumber or 0,
            fifths=int(ks.sharps),
            mode=mode,
        ))
    return tsigs, ksigs


def _dynamics_lookup(part):
    """Return a function offset->dynamic-string using Dynamic objects in part."""
    from music21 import dynamics as m21dyn
    pairs = []
    for d in part.flatten().getElementsByClass(m21dyn.Dynamic):
        pairs.append((float(d.offset), d.value))
    pairs.sort()
    offsets = [p[0] for p in pairs]

    def active(at: float):
        if not offsets:
            return None
        i = bisect_right(offsets, at) - 1
        return pairs[i][1] if i >= 0 else None

    return active


def parse_musicxml(mxl_path: Path) -> tuple[ScoreMeta, list[NoteEvent], list[str]]:
    mxl_path = Path(mxl_path)
    score = converter.parse(str(mxl_path))
    warnings: list[str] = []

    tmap, tempos = _collect_tempo_map(score)

    md = score.metadata
    # Audiveris puts the heading in <movement-title>; music21.title reads
    # <work-title> (often empty), so fall back to movementName.
    title = None
    composer = None
    if md:
        title = md.title or md.movementName
        composer = md.composer

    parts = list(score.parts)
    part_names = [(p.partName or f"Part {i+1}") for i, p in enumerate(parts)]

    tsigs, ksigs = ([], [])
    if parts:
        tsigs, ksigs = _collect_signatures(parts[0])

    events: list[NoteEvent] = []
    eid = 0
    max_measure = 0
    total_sec = 0.0

    for pidx, part in enumerate(parts):
        dyn_at = _dynamics_lookup(part)
        for el in part.flatten().notesAndRests:
            offset = float(el.offset)
            ql = float(el.quarterLength)
            onset_sec = tmap.seconds_at(offset)
            dur_sec = tmap.seconds_at(offset + ql) - onset_sec
            total_sec = max(total_sec, onset_sec + dur_sec)
            measure = el.measureNumber or 0
            max_measure = max(max_measure, measure)

            arts = [a.name for a in getattr(el, "articulations", [])]
            tie_type = el.tie.type if getattr(el, "tie", None) else None

            if isinstance(el, m21note.Rest):
                pitches = []
                is_rest = True
            elif isinstance(el, m21chord.Chord):
                pitches = [_to_pitch(p) for p in el.pitches]
                is_rest = False
            elif isinstance(el, m21note.Note):
                pitches = [_to_pitch(el.pitch)]
                is_rest = False
            else:
                continue

            events.append(NoteEvent(
                id=eid,
                part=pidx,
                staff=None,
                voice=str(el.voice) if getattr(el, "voice", None) else None,
                measure=measure,
                onset_ql=offset,
                onset_sec=round(onset_sec, 4),
                duration_ql=ql,
                duration_sec=round(dur_sec, 4),
                is_rest=is_rest,
                pitches=pitches,
                tie=tie_type,
                articulations=arts,
                dynamics=dyn_at(offset),
                confidence=None,
                bbox=None,
            ))
            eid += 1

    events.sort(key=lambda e: (e.onset_ql, e.part))

    # Anchor every measure to the nominal grid. OMR can emit under/overfull
    # measures (a misread dotted rhythm), which makes music21's cumulative
    # offsets drift — so a single early error desynchronises ALL later bars
    # during playback. Re-anchoring keeps bars on the beat grid; a slightly
    # short bar just gets a small gap instead of shifting everything after it.
    mlen = (tsigs[0].numerator * (4.0 / tsigs[0].denominator)) if tsigs else 4.0
    _anchor_measures_to_grid(events, mlen, tmap)
    total_sec = max((e.onset_sec + e.duration_sec for e in events), default=0.0)

    if not ksigs:
        warnings.append("No key signature detected (may be correct if the score "
                        "uses inline accidentals only).")
    if all(e.is_rest for e in events) or not events:
        warnings.append("No pitched notes parsed — check OMR output.")

    meta = ScoreMeta(
        title=title,
        composer=composer,
        part_names=part_names,
        num_parts=len(parts),
        num_measures=max_measure,
        divisions=None,
        time_signatures=tsigs,
        key_signatures=ksigs,
        tempos=tempos,
        duration_sec=round(total_sec, 3),
    )
    return meta, events, warnings


def _anchor_measures_to_grid(events: list[NoteEvent], mlen: float, tmap: TempoMap) -> None:
    """Shift each measure so it starts at its nominal grid position
    (measure m -> (m-1)*mlen), preserving intra-measure relative timing.
    Removes cumulative drift caused by under/overfull OMR measures."""
    from collections import defaultdict
    by_measure: dict[int, list[NoteEvent]] = defaultdict(list)
    for e in events:
        by_measure[e.measure].append(e)

    for measure, evs in by_measure.items():
        if measure <= 0:
            continue
        actual_start = min(e.onset_ql for e in evs)
        nominal_start = (measure - 1) * mlen
        shift = nominal_start - actual_start
        if abs(shift) < 1e-9:
            continue
        for e in evs:
            e.onset_ql = round(e.onset_ql + shift, 6)
            e.onset_sec = round(tmap.seconds_at(e.onset_ql), 4)
            e.duration_sec = round(
                tmap.seconds_at(e.onset_ql + e.duration_ql) - e.onset_sec, 4
            )


def build_timeline(events: list[NoteEvent]) -> list[HighlightEvent]:
    """Group simultaneous onsets into compact highlight cues for the UI."""
    buckets: dict[tuple, list[int]] = {}
    meta: dict[tuple, tuple[float, int]] = {}
    for e in events:
        if e.is_rest:
            continue
        key = (round(e.onset_sec, 3),)
        buckets.setdefault(key, [])
        for p in e.pitches:
            buckets[key].append(p.midi)
        # keep the longest duration / the measure of this onset
        dur, _ = meta.get(key, (0.0, e.measure))
        meta[key] = (max(dur, e.duration_sec), e.measure)

    timeline = []
    for key in sorted(buckets):
        onset = key[0]
        dur, measure = meta[key]
        timeline.append(HighlightEvent(
            onset_sec=onset,
            duration_sec=round(dur, 4),
            measure=measure,
            midi=sorted(set(buckets[key])),
        ))
    return timeline
