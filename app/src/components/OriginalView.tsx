import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api/client';

// Shows the original PDF pages (rendered server-side) for side-by-side
// comparison against the recognized score (spec 4.5) — lets the user spot
// where OMR diverged from the source.
export default function OriginalView() {
  const docId = useStore((s) => s.doc?.id ?? null);
  const numPages = useStore((s) => s.doc?.meta.num_pages ?? 0);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!docId || !numPages) { setUrls([]); return; }
    let alive = true;
    (async () => {
      const list = await Promise.all(
        Array.from({ length: numPages }, (_, i) => api.pageUrl(docId, i + 1))
      );
      if (alive) setUrls(list);
    })();
    return () => { alive = false; };
  }, [docId, numPages]);

  return (
    <div className="h-full overflow-auto bg-[#f7f7fa] p-2">
      {urls.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-slate-500">
          Оригінал недоступний
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {urls.map((u, i) => (
            <img
              key={i}
              src={u}
              alt={`Сторінка ${i + 1}`}
              className="w-full rounded shadow"
              draggable={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
