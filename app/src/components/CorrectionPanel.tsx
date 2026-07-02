import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { midiToName } from '../lib/instruments';
import type { NoteEvent, NoteEdit } from '../types';

const DURATIONS: { ql: number; label: string }[] = [
  { ql: 4, label: 'ціла (4)' },
  { ql: 3, label: '1/2. (3)' },
  { ql: 2, label: '1/2 (2)' },
  { ql: 1.5, label: '1/4. (1.5)' },
  { ql: 1, label: '1/4 (1)' },
  { ql: 0.75, label: '1/8. (0.75)' },
  { ql: 0.5, label: '1/8 (0.5)' },
  { ql: 0.375, label: '1/16. (0.375)' },
  { ql: 0.25, label: '1/16 (0.25)' },
];

interface Draft { duration_ql?: number; midi?: number[]; }

export default function CorrectionPanel() {
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selectedMeasure);
  const selectMeasure = useStore((s) => s.selectMeasure);
  const applyEdits = useStore((s) => s.applyEdits);

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState(false);

  const issues = doc?.measure_issues ?? [];
  const suspectMeasures = useMemo(
    () => [...new Set(issues.map((i) => i.measure))].sort((a, b) => a - b),
    [issues]
  );
  const expected = issues[0]?.expected_ql ?? 4;

  const measureEvents = useMemo(
    () => (doc && selected != null
      ? doc.events.filter((e) => e.measure === selected && !e.is_rest)
          .sort((a, b) => a.onset_ql - b.onset_ql || a.part - b.part)
      : []),
    [doc, selected]
  );

  const dur = (e: NoteEvent) => drafts[e.id]?.duration_ql ?? e.duration_ql;
  const midis = (e: NoteEvent) => drafts[e.id]?.midi ?? e.pitches.map((p) => p.midi);

  const setDraft = (id: number, patch: Draft) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  // Running sum per part using draft values.
  const partSums = useMemo(() => {
    const m: Record<number, number> = {};
    for (const e of measureEvents) m[e.part] = (m[e.part] ?? 0) + dur(e);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureEvents, drafts]);

  const dirty = Object.keys(drafts).length > 0;

  async function onApply() {
    if (!doc) return;
    const edits: NoteEdit[] = Object.entries(drafts).map(([id, d]) => ({
      event_id: Number(id),
      ...(d.duration_ql != null ? { duration_ql: d.duration_ql } : {}),
      ...(d.midi != null ? { midi: d.midi } : {}),
    }));
    setBusy(true);
    try {
      await applyEdits(edits);
      setDrafts({});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-sm font-semibold">🛠 Корекція</span>
        <span className="text-xs text-slate-400">{suspectMeasures.length} підозрілих</span>
      </div>

      {/* Suspect-measure chips */}
      <div className="flex flex-wrap gap-1.5 border-b border-edge p-2">
        {suspectMeasures.length === 0 && (
          <span className="text-xs text-emerald-300/90">Усі такти повні ✓</span>
        )}
        {suspectMeasures.map((m) => (
          <button
            key={m}
            onClick={() => { selectMeasure(m); setDrafts({}); }}
            className={`rounded px-2 py-1 text-xs ${selected === m ? 'bg-accent text-white' : 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'}`}
          >
            такт {m}
          </button>
        ))}
      </div>

      {/* Editor for the selected measure */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {selected == null ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-slate-500">
            Оберіть такт, щоб переглянути й виправити ноти
          </div>
        ) : (
          <div className="space-y-3">
            {[0, 1].map((part) => {
              const rows = measureEvents.filter((e) => e.part === part);
              if (rows.length === 0) return null;
              const sum = partSums[part] ?? 0;
              const ok = Math.abs(sum - expected) < 1e-6;
              return (
                <div key={part}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-400">{part === 0 ? 'Верхній стан' : 'Нижній стан'}</span>
                    <span className={ok ? 'text-emerald-300' : 'text-amber-300'}>
                      Σ {sum.toFixed(3)} / {expected}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {rows.map((e) => (
                      <div key={e.id} className="flex items-center gap-1 rounded bg-ink/60 px-1.5 py-1">
                        <span className="w-20 truncate font-mono text-xs text-slate-200" title={midis(e).map(midiToName).join(' ')}>
                          {midis(e).map(midiToName).join('+')}
                        </span>
                        <button
                          onClick={() => setDraft(e.id, { midi: midis(e).map((m) => m - 1) })}
                          className="h-5 w-5 rounded bg-edge text-xs text-slate-300" title="На півтон нижче"
                        >−</button>
                        <button
                          onClick={() => setDraft(e.id, { midi: midis(e).map((m) => m + 1) })}
                          className="h-5 w-5 rounded bg-edge text-xs text-slate-300" title="На півтон вище"
                        >+</button>
                        <select
                          value={dur(e)}
                          onChange={(ev) => setDraft(e.id, { duration_ql: parseFloat(ev.target.value) })}
                          className="ml-auto rounded border border-edge bg-panel px-1 py-0.5 text-xs text-slate-200"
                        >
                          {DURATIONS.concat(
                            DURATIONS.some((d) => Math.abs(d.ql - dur(e)) < 1e-6) ? [] : [{ ql: dur(e), label: `${dur(e)}` }]
                          ).map((d) => (
                            <option key={d.ql} value={d.ql}>{d.label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Apply */}
      <div className="border-t border-edge p-2">
        <button
          onClick={onApply}
          disabled={!dirty || busy}
          className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Застосування…' : 'Застосувати виправлення'}
        </button>
      </div>
    </div>
  );
}
