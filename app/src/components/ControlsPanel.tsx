import { useStore } from '../store';
import { ALL_INSTRUMENTS, instrumentById } from '../lib/instruments';
import { TIMBRES, REVERB_PRESETS, type ReverbMode } from '../lib/sound';

// Tempo, playback timbre (SoundFont), reverb, humanization, volume, and the
// bottom-visualizer instrument + tuning (spec tasks 2-7 / ТЗ 4.4 / 4.6 / 4.7).
export default function ControlsPanel() {
  const s = useStore();
  const inst = instrumentById(s.instrumentId);
  const fret = inst.kind === 'fretboard' ? inst : null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
      <label className="flex items-center gap-2">
        Темп
        <input type="range" min={25} max={200} step={1} value={s.tempoPercent}
          onChange={(e) => s.setTempo(parseInt(e.target.value))} className="w-28 accent-accent" />
        <span className="w-10 font-mono text-slate-200">{s.tempoPercent}%</span>
      </label>

      <label className="flex items-center gap-2">
        Гучність
        <input type="range" min={0} max={1} step={0.01} value={s.volume}
          onChange={(e) => s.setVolume(parseFloat(e.target.value))} className="w-20 accent-accent" />
      </label>

      <label className="flex items-center gap-2">
        Тембр
        <select value={s.timbre} onChange={(e) => s.setTimbre(e.target.value)}
          className="rounded-md border border-edge bg-panel px-2 py-1 text-slate-200">
          {TIMBRES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-2">
        Реверб
        <select value={s.reverbMode} onChange={(e) => s.setReverb(e.target.value as ReverbMode)}
          className="rounded-md border border-edge bg-panel px-2 py-1 text-slate-200">
          {Object.values(REVERB_PRESETS).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-1.5" title="Невелика варіація гучності й таймінгу для живішого звучання">
        <input type="checkbox" checked={s.humanizeVelocity && s.humanizeTiming}
          onChange={(e) => { s.setHumanizeVelocity(e.target.checked); s.setHumanizeTiming(e.target.checked); }}
          className="accent-accent" />
        Жвавість
      </label>

      <span className="mx-1 h-4 w-px bg-edge" />

      <label className="flex items-center gap-2">
        Інструмент
        <select value={s.instrumentId} onChange={(e) => s.setInstrument(e.target.value)}
          className="rounded-md border border-edge bg-panel px-2 py-1 text-slate-200">
          {ALL_INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      {fret && fret.tunings.length > 1 && (
        <label className="flex items-center gap-2">
          Стрій
          <select value={s.tuningId} onChange={(e) => s.setTuning(e.target.value)}
            className="rounded-md border border-edge bg-panel px-2 py-1 text-slate-200">
            {fret.tunings.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      )}

      {!s.engineReady && <span className="text-xs text-amber-300/80">завантаження звуку…</span>}
    </div>
  );
}
