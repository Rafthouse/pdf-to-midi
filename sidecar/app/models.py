"""Internal music model — the structured representation that every downstream
consumer (MIDI, score viewer, instrument visualizer, LLM layer) reads.

The schema follows the data contract in the spec (section 7.3): every musical
event carries pitch, timing, voice/measure/staff placement, articulation,
dynamics, a confidence score and an optional source bounding box in the PDF.

`confidence` and `bbox` are nullable on purpose: Audiveris stores per-symbol
confidence and geometry inside its `.omr` project, but those are not present in
the exported MusicXML. We expose the fields now (stable contract) and will
populate them later by reading the `.omr` sheets directly. Per the spec we must
never hide low recognition quality, so these stay explicit rather than faked.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class BBox(BaseModel):
    """Bounding box in PDF page coordinates (points), origin top-left."""
    page: int
    x: float
    y: float
    w: float
    h: float


class Pitch(BaseModel):
    step: str                      # C, D, E, F, G, A, B
    alter: int = 0                 # -1 flat, +1 sharp, 0 natural
    octave: int
    midi: int                      # MIDI note number 0..127
    name: str                      # e.g. "Eb4"


class NoteEvent(BaseModel):
    """One onset on the timeline. A chord is a single event with >1 pitch."""
    id: int
    part: int                      # part index (0-based)
    staff: Optional[int] = None    # staff number within the part (grand staff: 1=top)
    voice: Optional[str] = None    # MusicXML voice id
    measure: int                   # measure number

    onset_ql: float                # onset in quarter-lengths from score start
    onset_sec: float               # onset in seconds (via tempo map)
    duration_ql: float
    duration_sec: float

    is_rest: bool = False
    pitches: list[Pitch] = Field(default_factory=list)

    tie: Optional[str] = None              # "start" | "stop" | "continue"
    articulations: list[str] = Field(default_factory=list)
    dynamics: Optional[str] = None         # e.g. "mf", "p"

    confidence: Optional[float] = None     # 0..1, None until wired from .omr
    bbox: Optional[BBox] = None            # source geometry, None until wired


class TimeSignature(BaseModel):
    measure: int
    numerator: int
    denominator: int


class KeySignature(BaseModel):
    measure: int
    fifths: int                    # -7..+7 (negative = flats)
    mode: Optional[str] = None


class TempoMark(BaseModel):
    onset_ql: float
    bpm: float


class ScoreMeta(BaseModel):
    title: Optional[str] = None
    composer: Optional[str] = None
    part_names: list[str] = Field(default_factory=list)
    num_parts: int = 0
    num_measures: int = 0
    num_pages: Optional[int] = None
    divisions: Optional[int] = None
    time_signatures: list[TimeSignature] = Field(default_factory=list)
    key_signatures: list[KeySignature] = Field(default_factory=list)
    tempos: list[TempoMark] = Field(default_factory=list)
    duration_sec: float = 0.0


class HighlightEvent(BaseModel):
    """Compact playback cue for the score viewer / instrument visualizer:
    at `onset_sec`, light up these MIDI notes for `duration_sec`."""
    onset_sec: float
    duration_sec: float
    measure: int
    midi: list[int]


class MeasureIssue(BaseModel):
    """A measure whose note durations don't fill the time signature — a strong
    signal of an OMR rhythm error (spec 8.2: visible recognition-quality)."""
    measure: int
    part: int
    filled_ql: float        # duration of the fullest voice in this part
    expected_ql: float      # what the time signature requires
    kind: str               # "short" | "overfull"


class ScoreDocument(BaseModel):
    id: str
    source_pdf: str
    revision: int = 0                           # bumps on each edit (cache-bust)
    musicxml_path: Optional[str] = None        # compressed .mxl
    musicxml_xml_path: Optional[str] = None     # uncompressed .xml (for OSMD)
    midi_path: Optional[str] = None
    meta: ScoreMeta
    events: list[NoteEvent] = Field(default_factory=list)
    timeline: list[HighlightEvent] = Field(default_factory=list)
    measure_issues: list[MeasureIssue] = Field(default_factory=list)

    # Honest quality reporting (spec section 5 / 8.2): surfaced to the UI.
    warnings: list[str] = Field(default_factory=list)


class NoteEdit(BaseModel):
    """A manual correction to a single NoteEvent (by id)."""
    event_id: int
    duration_ql: Optional[float] = None     # new duration in quarter-lengths
    midi: Optional[list[int]] = None        # replace pitches with these MIDI notes


class JobStatus(BaseModel):
    id: str
    state: str                     # "pending" | "running" | "done" | "error"
    source_pdf: str
    error: Optional[str] = None
    document_id: Optional[str] = None
