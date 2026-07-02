// Visualizer instruments + tunings. Instrument and Tuning are explicit,
// decoupled entities (spec task 7) so the bouzouki assistant can later drive
// fretboard/fingering visualization from an (Instrument, Tuning) pair.

export interface Tuning {
  id: string;
  label: string;
  strings: number[];  // open-string MIDI notes, low (top row) -> high (bottom)
  names: string[];    // per-string display labels
}

export interface FretInstrument {
  kind: 'fretboard';
  id: string;
  label: string;
  frets: number;
  tunings: Tuning[];
}

export interface KeyboardInstrument {
  kind: 'keyboard';
  id: string;
  label: string;
  lowMidi: number;
  highMidi: number;
}

export type Instrument = FretInstrument | KeyboardInstrument;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToName(midi: number): string {
  const n = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${n}${Math.floor(midi / 12) - 1}`;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

// MIDI refs: G2=43 D3=50 A3=57 D4=62 E4=64 ; F2=41 C3=48 G3=55 C4=60.
export const KEYBOARD: KeyboardInstrument = {
  kind: 'keyboard', id: 'keyboard', label: 'Клавіатура', lowMidi: 36, highMidi: 84,
};

export const FRET_INSTRUMENTS: FretInstrument[] = [
  {
    kind: 'fretboard', id: 'bouzouki', label: 'Бузукі', frets: 14,
    tunings: [
      { id: 'gdad', label: 'GDAD', strings: [43, 50, 57, 62], names: ['G', 'D', 'A', 'D'] },
      { id: 'gdae', label: 'GDAE', strings: [43, 50, 57, 64], names: ['G', 'D', 'A', 'E'] },
      { id: 'fcgc', label: 'FCGC (−1 тон)', strings: [41, 48, 55, 60], names: ['F', 'C', 'G', 'C'] },
    ],
  },
  {
    kind: 'fretboard', id: 'guitar', label: 'Гітара', frets: 15,
    tunings: [
      { id: 'eadgbe', label: 'EADGBE', strings: [40, 45, 50, 55, 59, 64], names: ['E', 'A', 'D', 'G', 'B', 'e'] },
    ],
  },
  {
    kind: 'fretboard', id: 'bass', label: 'Бас-гітара', frets: 15,
    tunings: [
      { id: 'eadg', label: 'EADG', strings: [28, 33, 38, 43], names: ['E', 'A', 'D', 'G'] },
    ],
  },
];

export const ALL_INSTRUMENTS: Instrument[] = [KEYBOARD, ...FRET_INSTRUMENTS];

export function instrumentById(id: string): Instrument {
  return ALL_INSTRUMENTS.find((i) => i.id === id) ?? KEYBOARD;
}

export function tuningFor(inst: FretInstrument, tuningId: string | null): Tuning {
  return inst.tunings.find((t) => t.id === tuningId) ?? inst.tunings[0];
}

export interface FretPosition { stringIndex: number; fret: number; }

/** All playable positions for a MIDI pitch given open strings and fret count. */
export function fretPositions(strings: number[], frets: number, midi: number): FretPosition[] {
  const out: FretPosition[] = [];
  strings.forEach((open, stringIndex) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= frets) out.push({ stringIndex, fret });
  });
  return out;
}
