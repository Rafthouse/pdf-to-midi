"""Regenerate MusicXML from the (edited) internal model so manual corrections
show up visually in the score viewer — not just in playback.

We rebuild a music21 score from the events (preserving pitch spelling, e.g. Eb
rather than D#) and let music21.makeNotation bar it, fill rests and add beams.
A still-short measure simply gets a rest where the missing duration is, which is
correct notation; a fully corrected measure has no gap.
"""
from __future__ import annotations

from pathlib import Path

from music21 import stream, note as m21note, chord as m21chord, pitch as m21pitch, \
    meter, clef, tempo

from .models import NoteEvent, ScoreMeta
from .analysis import measure_length_ql


def _element(e: NoteEvent):
    pitches = []
    for p in e.pitches:
        mp = m21pitch.Pitch()
        mp.step = p.step
        mp.octave = p.octave
        if p.alter:
            mp.accidental = m21pitch.Accidental(p.alter)
        pitches.append(mp)
    if len(pitches) == 1:
        el = m21note.Note(pitches[0])
    else:
        el = m21chord.Chord(pitches)
    el.quarterLength = max(e.duration_ql, 0.0625)
    return el


def build_score(events: list[NoteEvent], meta: ScoreMeta) -> stream.Score:
    sc = stream.Score()
    bpm = meta.tempos[0].bpm if meta.tempos else 100.0
    ts = meta.time_signatures[0] if meta.time_signatures else None

    for pidx in sorted({e.part for e in events}):
        part = stream.Part()
        part.insert(0, clef.TrebleClef() if pidx == 0 else clef.BassClef())
        if ts:
            part.insert(0, meter.TimeSignature(f"{ts.numerator}/{ts.denominator}"))
        part.insert(0, tempo.MetronomeMark(number=bpm))
        for e in sorted((e for e in events if e.part == pidx and not e.is_rest),
                        key=lambda e: e.onset_ql):
            part.insert(e.onset_ql, _element(e))
        # Bar into measures, add rests for gaps, beam — robust default notation.
        part.makeNotation(inPlace=True)
        sc.insert(0, part)
    return sc


def write_musicxml_from_events(events: list[NoteEvent], meta: ScoreMeta,
                               out_path: Path) -> Path:
    out_path = Path(out_path)
    score = build_score(events, meta)
    score.write("musicxml", fp=str(out_path))
    return out_path
