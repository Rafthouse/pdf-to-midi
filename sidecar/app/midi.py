"""MIDI export. Kept separate so the playback format can evolve independently."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from music21 import converter, stream, note as m21note, chord as m21chord, tempo

from .models import NoteEvent, ScoreMeta


def write_midi(mxl_path: Path, out_path: Path) -> Path:
    """Render a MusicXML file to a Standard MIDI File."""
    out_path = Path(out_path)
    score = converter.parse(str(mxl_path))
    score.write("midi", fp=str(out_path))
    return out_path


def write_midi_from_events(events: list[NoteEvent], meta: ScoreMeta, out_path: Path) -> Path:
    """Build a MIDI file directly from the (possibly edited) internal model, so
    manual corrections are reflected without going back through MusicXML."""
    out_path = Path(out_path)
    score = stream.Score()

    bpm = meta.tempos[0].bpm if meta.tempos else 100.0
    by_part: dict[int, list[NoteEvent]] = defaultdict(list)
    for e in events:
        by_part[e.part].append(e)

    for pidx in sorted(by_part):
        part = stream.Part()
        part.insert(0, tempo.MetronomeMark(number=bpm))
        for e in by_part[pidx]:
            if e.is_rest or not e.pitches:
                continue
            midis = [p.midi for p in e.pitches]
            el = (m21chord.Chord(midis) if len(midis) > 1
                  else m21note.Note(midis[0]))
            el.quarterLength = max(e.duration_ql, 0.0625)
            part.insert(e.onset_ql, el)
        score.insert(0, part)

    score.write("midi", fp=str(out_path))
    return out_path
