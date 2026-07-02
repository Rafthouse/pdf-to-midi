import { create } from 'zustand';
import { api } from './api/client';
import { SoundFontEngine } from './audio/SoundFontEngine';
import type { ScoreDocument, NoteEdit } from './types';
import type { TimbreId, ReverbMode } from './lib/sound';

const engine = new SoundFontEngine();

export type LoadPhase = 'idle' | 'importing' | 'ready' | 'error';

interface AppState {
  doc: ScoreDocument | null;
  phase: LoadPhase;
  statusText: string;
  error: string | null;

  // transport
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  tempoPercent: number;
  volume: number;
  loop: boolean;

  // current highlight
  activeMidi: number[];
  currentMeasure: number;

  // loop selection (spec section 3-4)
  measureTimes: Record<number, { start: number; end: number }>;
  loopStartMeasure: number | null;
  loopEndMeasure: number | null;
  setLoopMeasures: (a: number, b: number) => void;
  clearLoop: () => void;
  setLoopStartHere: () => void;
  setLoopEndHere: () => void;
  playSelection: () => Promise<void>;

  // instrument / timbre selection
  instrumentId: string;       // visualizer instrument (keyboard/fretboard)
  tuningId: string;           // visualizer tuning (e.g. bouzouki GDAD)
  timbre: TimbreId;           // playback sound (SoundFont program)

  // sound quality
  reverbMode: ReverbMode;
  humanizeVelocity: boolean;
  humanizeTiming: boolean;
  engineReady: boolean;

  // compare-with-original view
  showOriginal: boolean;
  toggleOriginal: () => void;

  // correction editor
  showCorrection: boolean;
  toggleCorrection: () => void;
  selectedMeasure: number | null;
  selectMeasure: (m: number | null) => void;
  applyEdits: (edits: NoteEdit[]) => Promise<void>;

  // actions
  openDialog: () => Promise<void>;
  importPath: (path: string) => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  exportResult: () => Promise<void>;
  togglePlay: () => Promise<void>;
  stop: () => void;
  seek: (sec: number) => void;
  setTempo: (percent: number) => void;
  setVolume: (v: number) => void;
  toggleLoop: () => void;
  setInstrument: (id: string) => void;
  setTuning: (id: string) => void;
  setTimbre: (t: TimbreId) => void;
  setReverb: (m: ReverbMode) => void;
  setHumanizeVelocity: (v: boolean) => void;
  setHumanizeTiming: (v: boolean) => void;
}

let rafId = 0;
let clockRunning = false;

/** Push the engine's current position/highlight into the store once. */
function updateOnce(set: (p: Partial<AppState>) => void) {
  const pos = engine.position();
  const { midi, measure } = engine.activeAt(pos);
  set({ positionSec: pos, activeMidi: midi, currentMeasure: measure, isPlaying: engine.isPlaying });
}

/** Run the highlight clock ONLY while playing; settle once and stop on pause.
 *  Avoids 60fps re-renders (and OSMD/fretboard churn) when idle. */
function runClock(set: (p: Partial<AppState>) => void) {
  if (clockRunning) return;
  clockRunning = true;
  const loop = () => {
    updateOnce(set);
    if (engine.isPlaying) {
      rafId = requestAnimationFrame(loop);
    } else {
      clockRunning = false;
    }
  };
  rafId = requestAnimationFrame(loop);
}

/** Per-measure time span (seconds, base timeline) from the highlight timeline. */
function computeMeasureTimes(doc: ScoreDocument): Record<number, { start: number; end: number }> {
  const m: Record<number, { start: number; end: number }> = {};
  for (const c of doc.timeline) {
    const end = c.onset_sec + c.duration_sec;
    const cur = m[c.measure];
    if (!cur) m[c.measure] = { start: c.onset_sec, end };
    else { cur.start = Math.min(cur.start, c.onset_sec); cur.end = Math.max(cur.end, end); }
  }
  return m;
}

/** Wire a freshly loaded document into the playback engine + store. */
function wireDoc(
  doc: ScoreDocument,
  get: () => AppState,
  set: (p: Partial<AppState>) => void
) {
  engine.load(doc.timeline, doc.meta.duration_sec);
  engine.setTempoPercent(get().tempoPercent);
  engine.setVolume(get().volume);
  engine.setTimbre(get().timbre);
  engine.setReverb(get().reverbMode);
  engine.humanizeVelocity = get().humanizeVelocity;
  engine.humanizeTiming = get().humanizeTiming;
  engine.onEnd = () => set({ isPlaying: false });
  engine.setLoopRange(null, null);
  set({
    doc,
    phase: 'ready',
    durationSec: doc.meta.duration_sec,
    positionSec: 0,
    currentMeasure: 0,
    activeMidi: [],
    selectedMeasure: null,
    measureTimes: computeMeasureTimes(doc),
    loopStartMeasure: null,
    loopEndMeasure: null,
    statusText: doc.meta.title
      ? `${doc.meta.title}${doc.meta.composer ? ' — ' + doc.meta.composer : ''}`
      : 'Готово',
  });
  updateOnce(set);
}

export const useStore = create<AppState>((set, get) => ({
  doc: null,
  phase: 'idle',
  statusText: 'Перетягніть нотний PDF або відкрийте файл',
  error: null,

  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  tempoPercent: 100,
  volume: 0.8,
  loop: false,

  activeMidi: [],
  currentMeasure: 0,

  measureTimes: {},
  loopStartMeasure: null,
  loopEndMeasure: null,

  instrumentId: 'bouzouki',
  tuningId: 'gdad',
  timbre: 'piano',

  reverbMode: 'hall',
  humanizeVelocity: true,
  humanizeTiming: true,
  engineReady: false,

  showOriginal: false,
  toggleOriginal() {
    set({ showOriginal: !get().showOriginal });
  },

  showCorrection: false,
  toggleCorrection() {
    set({ showCorrection: !get().showCorrection });
  },
  selectedMeasure: null,
  selectMeasure(m) {
    set({ selectedMeasure: m });
  },

  async applyEdits(edits) {
    const doc = get().doc;
    if (!doc || edits.length === 0) return;
    const updated = await api.editDocument(doc.id, edits);
    // Rebuild playback from the corrected timeline, preserving position.
    const pos = get().positionSec;
    engine.load(updated.timeline, updated.meta.duration_sec);
    engine.setTempoPercent(get().tempoPercent);
    engine.setVolume(get().volume);
    engine.setTimbre(get().timbre);
    engine.onEnd = () => set({ isPlaying: false });
    engine.seek(Math.min(pos, updated.meta.duration_sec));
    set({ doc: updated, durationSec: updated.meta.duration_sec });
  },

  async openDialog() {
    const path = await window.pdf2midi?.pickPdf?.();
    if (path) await get().importPath(path);
  },

  async importPath(path: string) {
    set({ phase: 'importing', error: null, statusText: 'Розпізнавання нот (OMR)…', doc: null });
    try {
      const job = await api.importByPath(path);
      const doc = await api.waitForDocument(job.id, (s) =>
        set({ statusText: s.state === 'running' ? 'Розпізнавання нот (OMR)…' : `Стан: ${s.state}` })
      );
      wireDoc(doc, get, set);
    } catch (e) {
      set({ phase: 'error', error: String(e), statusText: 'Помилка розпізнавання' });
    }
  },

  async openDocument(id) {
    set({ phase: 'importing', error: null, statusText: 'Завантаження документа…' });
    try {
      const doc = await api.getDocument(id);
      wireDoc(doc, get, set);
    } catch (e) {
      set({ phase: 'error', error: String(e), statusText: 'Не вдалося відкрити документ' });
    }
  },

  async exportResult() {
    const doc = get().doc;
    if (!doc || !window.pdf2midi?.exportDocument) return;
    const base = doc.meta.title || 'score';
    const res = await window.pdf2midi.exportDocument(doc.id, base);
    if (res.ok) {
      set({ statusText: `Експортовано ${res.files?.length ?? 0} файл(и) → ${res.dir}` });
    } else if (!res.canceled) {
      set({ statusText: `Помилка експорту: ${res.error ?? ''}` });
    }
  },

  async togglePlay() {
    if (engine.isPlaying) {
      engine.pause();
      set({ isPlaying: false });
      updateOnce(set);
    } else {
      await engine.play();
      set({ isPlaying: true });
      runClock(set);
    }
  },

  stop() {
    engine.stop();
    set({ isPlaying: false, positionSec: 0, currentMeasure: 0, activeMidi: [] });
  },

  seek(sec) {
    engine.seek(sec);
    updateOnce(set);
  },

  setTempo(percent) {
    engine.setTempoPercent(percent);
    set({ tempoPercent: percent });
  },

  setVolume(v) {
    engine.setVolume(v);
    set({ volume: v });
  },

  toggleLoop() {
    const loop = !get().loop;
    engine.loop = loop;
    set({ loop });
  },

  setLoopMeasures(a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const mt = get().measureTimes;
    const s = mt[lo]?.start, e = mt[hi]?.end;
    if (s == null || e == null) return;
    engine.setLoopRange(s, e);
    set({ loopStartMeasure: lo, loopEndMeasure: hi });
  },

  clearLoop() {
    engine.setLoopRange(null, null);
    set({ loopStartMeasure: null, loopEndMeasure: null });
  },

  setLoopStartHere() {
    const cur = get().currentMeasure || 1;
    const end = get().loopEndMeasure ?? cur;
    get().setLoopMeasures(cur, Math.max(cur, end));
  },

  setLoopEndHere() {
    const cur = get().currentMeasure || 1;
    const start = get().loopStartMeasure ?? cur;
    get().setLoopMeasures(Math.min(start, cur), cur);
  },

  async playSelection() {
    const { loopStartMeasure, measureTimes } = get();
    if (loopStartMeasure != null && measureTimes[loopStartMeasure]) {
      engine.seek(measureTimes[loopStartMeasure].start);
      updateOnce(set);
    }
    if (!engine.isPlaying) { await engine.play(); set({ isPlaying: true }); runClock(set); }
  },

  setInstrument(id) {
    set({ instrumentId: id });
  },

  setTuning(id) {
    set({ tuningId: id });
  },

  setTimbre(t) {
    engine.setTimbre(t);
    set({ timbre: t });
  },

  setReverb(m) {
    engine.setReverb(m);
    set({ reverbMode: m });
  },

  setHumanizeVelocity(v) {
    engine.humanizeVelocity = v;
    set({ humanizeVelocity: v });
  },

  setHumanizeTiming(v) {
    engine.humanizeTiming = v;
    set({ humanizeTiming: v });
  },
}));

// Surface engine readiness (SoundFont load) to the UI.
engine.ready.then(() => useStore.setState({ engineReady: true })).catch(() => {});
