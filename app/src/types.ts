// Mirrors the sidecar pydantic models (app/models.py).

export interface Pitch {
  step: string;
  alter: number;
  octave: number;
  midi: number;
  name: string;
}

export interface NoteEvent {
  id: number;
  part: number;
  staff: number | null;
  voice: string | null;
  measure: number;
  onset_ql: number;
  onset_sec: number;
  duration_ql: number;
  duration_sec: number;
  is_rest: boolean;
  pitches: Pitch[];
  tie: string | null;
  articulations: string[];
  dynamics: string | null;
  confidence: number | null;
  bbox: unknown | null;
}

export interface TimeSignature { measure: number; numerator: number; denominator: number; }
export interface KeySignature { measure: number; fifths: number; mode: string | null; }
export interface TempoMark { onset_ql: number; bpm: number; }

export interface ScoreMeta {
  title: string | null;
  composer: string | null;
  part_names: string[];
  num_parts: number;
  num_measures: number;
  num_pages: number | null;
  divisions: number | null;
  time_signatures: TimeSignature[];
  key_signatures: KeySignature[];
  tempos: TempoMark[];
  duration_sec: number;
}

export interface HighlightEvent {
  onset_sec: number;
  duration_sec: number;
  measure: number;
  midi: number[];
}

export interface MeasureIssue {
  measure: number;
  part: number;
  filled_ql: number;
  expected_ql: number;
  kind: 'short' | 'overfull';
}

export interface NoteEdit {
  event_id: number;
  duration_ql?: number;
  midi?: number[];
}

export interface ScoreDocument {
  id: string;
  source_pdf: string;
  revision: number;
  musicxml_path: string | null;
  musicxml_xml_path: string | null;
  midi_path: string | null;
  meta: ScoreMeta;
  events: NoteEvent[];
  timeline: HighlightEvent[];
  measure_issues: MeasureIssue[];
  warnings: string[];
}

export interface DocumentSummary {
  id: string;
  title: string | null;
  composer: string | null;
  num_measures: number;
  num_parts: number;
  num_events: number;
  duration_sec: number;
  revision: number;
  num_issues: number;
  modified: number;
  warnings: string[];
}

export interface JobStatus {
  id: string;
  state: 'pending' | 'running' | 'done' | 'error';
  source_pdf: string;
  error: string | null;
  document_id: string | null;
}
