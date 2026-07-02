import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api/client';
import type { DocumentSummary } from '../types';

// Reopen a previously processed / corrected document. Documents are persisted
// on disk by the sidecar, so corrections survive restarts and can be restored
// here instead of being lost.
export default function RecentDocs() {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const openDocument = useStore((s) => s.openDocument);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    api.listDocuments().then(setDocs).catch(() => setDocs([]));
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-edge px-3 py-1.5 text-sm text-slate-200 hover:bg-edge/70"
        title="Відкрити збережений документ"
      >
        🕘 Нещодавні
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-[60vh] w-[360px] overflow-auto rounded-md border border-edge bg-panel shadow-xl">
          {docs.length === 0 ? (
            <div className="p-3 text-sm text-slate-400">Немає збережених документів</div>
          ) : (
            docs.map((d) => (
              <button
                key={d.id}
                onClick={() => { openDocument(d.id); setOpen(false); }}
                className="flex w-full items-center gap-2 border-b border-edge/60 px-3 py-2 text-left text-sm hover:bg-ink/60"
              >
                <span className="min-w-0 flex-1 truncate">
                  {d.title || 'Без назви'}
                  <span className="text-slate-500"> · {d.num_measures} т.</span>
                </span>
                {d.revision > 0 && (
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-xs text-accent" title="Має правки">
                    ✏ rev {d.revision}
                  </span>
                )}
                {d.num_issues > 0 ? (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-200" title="Підозрілі такти">
                    ⚠ {d.num_issues}
                  </span>
                ) : (
                  <span className="text-xs text-emerald-300/80">✓</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
