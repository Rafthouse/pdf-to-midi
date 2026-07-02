import { useStore } from '../store';

// Loading / analysis indicator, recognition warnings and errors (spec 8.1/8.2).
export default function StatusHints() {
  const phase = useStore((s) => s.phase);
  const statusText = useStore((s) => s.statusText);
  const error = useStore((s) => s.error);
  const doc = useStore((s) => s.doc);

  return (
    <div className="flex items-center gap-3 text-sm">
      {phase === 'importing' && (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      )}
      <span className={error ? 'text-red-300' : 'text-slate-300'}>{statusText}</span>

      {doc && (
        <span className="text-slate-500">
          · {doc.meta.num_measures} тактів · {doc.events.length} подій
          {doc.meta.time_signatures[0] &&
            ` · ${doc.meta.time_signatures[0].numerator}/${doc.meta.time_signatures[0].denominator}`}
        </span>
      )}

      {doc?.warnings?.length ? (
        <span className="text-amber-300/90" title={doc.warnings.join('\n')}>
          ⚠ {doc.warnings.length} застереж.
        </span>
      ) : null}

      {error && <span className="truncate text-red-300" title={error}>· {error}</span>}
    </div>
  );
}
