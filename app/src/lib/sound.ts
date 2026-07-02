// Playback sound configuration: SoundFont timbres (GM bank:program), reverb
// modes and velocity/timing humanization defaults. Used by the SoundFontEngine.

export interface Timbre {
  id: string;
  label: string;
  bank: number;     // SoundFont bank (MSB)
  program: number;  // GM program number
}

// Verified against the bundled GeneralUser-GS soundfont (phdr scan):
// Mandolin lives at bank 16, the rest are standard GM bank 0.
export const TIMBRES: Timbre[] = [
  { id: 'piano',        label: 'Фортепіано',     bank: 0,  program: 0 },
  { id: 'nylon-guitar', label: 'Нейлонова гітара', bank: 0,  program: 24 },
  { id: 'steel-guitar', label: 'Сталева гітара',  bank: 0,  program: 25 },
  { id: 'mandolin',     label: 'Мандоліна',       bank: 16, program: 25 },
  { id: 'bouzouki',     label: 'Бузукі (≈мандоліна)', bank: 16, program: 25 },
  { id: 'strings',      label: 'Струнні',         bank: 0,  program: 48 },
  { id: 'choir',        label: 'Хор',             bank: 0,  program: 52 },
];
export type TimbreId = string;

export function timbreById(id: string): Timbre {
  return TIMBRES.find((t) => t.id === id) ?? TIMBRES[0];
}

export type ReverbMode = 'off' | 'room' | 'hall';

export interface ReverbPreset {
  id: ReverbMode;
  label: string;
  decay: number;   // seconds (impulse length)
  wet: number;     // 0..1 wet mix
}

export const REVERB_PRESETS: Record<ReverbMode, ReverbPreset> = {
  off:  { id: 'off',  label: 'Без реверберації', decay: 0,   wet: 0 },
  room: { id: 'room', label: 'Кімната',          decay: 0.6, wet: 0.22 },
  hall: { id: 'hall', label: 'Зала',             decay: 1.9, wet: 0.32 },
};

// Humanization defaults (spec tasks 4 & 5).
export const HUMANIZE = {
  velocityBase: 84,    // baseline MIDI velocity
  velocityJitter: 8,   // ±8
  timingJitterMs: 12,  // ±12 ms (audio only; highlight stays on the timeline)
  legato: 0.97,        // note length as fraction of notated duration (task 6)
};
