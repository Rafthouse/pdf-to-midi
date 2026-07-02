import { useStore } from '../store';

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function TransportBar() {
  const { isPlaying, positionSec, durationSec, loop, currentMeasure, loopStartMeasure, loopEndMeasure } = useStore();
  const togglePlay = useStore((s) => s.togglePlay);
  const stop = useStore((s) => s.stop);
  const seek = useStore((s) => s.seek);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const clearLoop = useStore((s) => s.clearLoop);
  const setLoopStartHere = useStore((s) => s.setLoopStartHere);
  const setLoopEndHere = useStore((s) => s.setLoopEndHere);
  const playSelection = useStore((s) => s.playSelection);
  const ready = useStore((s) => s.phase === 'ready');

  const hasSel = loopStartMeasure != null && loopEndMeasure != null;
  const lbl = 'rounded-md bg-edge px-2 py-1 text-xs text-slate-200 hover:bg-edge/70 disabled:opacity-40';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={togglePlay} disabled={!ready}
        className="grid h-11 w-11 place-items-center rounded-full bg-accent text-xl text-white disabled:opacity-40"
        title={isPlaying ? 'Пауза' : 'Відтворити'}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button onClick={stop} disabled={!ready}
        className="grid h-9 w-9 place-items-center rounded-full bg-edge text-sm text-slate-200 disabled:opacity-40"
        title="Стоп">⏹</button>

      <span className="w-12 text-right font-mono text-sm text-slate-300">{fmt(positionSec)}</span>
      <input type="range" min={0} max={Math.max(durationSec, 0.1)} step={0.01}
        value={Math.min(positionSec, durationSec)} onChange={(e) => seek(parseFloat(e.target.value))}
        disabled={!ready} className="min-w-[120px] flex-1 accent-accent" />
      <span className="w-12 font-mono text-sm text-slate-400">{fmt(durationSec)}</span>

      <span className="w-16 text-right text-xs text-slate-400">такт {currentMeasure || '—'}</span>

      {/* Loop controls */}
      <span className="mx-1 h-5 w-px bg-edge" />
      <button onClick={toggleLoop} disabled={!ready}
        className={`rounded-md px-3 py-1.5 text-sm ${loop ? 'bg-accent text-white' : 'bg-edge text-slate-300'} disabled:opacity-40`}
        title="Циклічне відтворення вибраного фрагмента (або всього твору)">🔁 Loop</button>
      <button onClick={setLoopStartHere} disabled={!ready} className={lbl} title="Початок петлі = поточний такт">⟦ Старт</button>
      <button onClick={setLoopEndHere} disabled={!ready} className={lbl} title="Кінець петлі = поточний такт">Кінець ⟧</button>
      <button onClick={playSelection} disabled={!ready || !hasSel} className={lbl} title="Грати вибраний фрагмент">▶ Фрагмент</button>
      <button onClick={clearLoop} disabled={!ready || !hasSel} className={lbl} title="Скинути петлю">✕</button>
      <span className="text-xs text-slate-400">
        {hasSel ? <span className="text-accent">петля: {loopStartMeasure}–{loopEndMeasure}</span> : 'виділіть такти мишкою'}
      </span>
    </div>
  );
}
