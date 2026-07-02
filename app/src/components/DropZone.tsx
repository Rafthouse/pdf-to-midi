import { useState } from 'react';
import { useStore } from '../store';

// Drag-and-drop a PDF or click to open. Resolves the dropped File to an absolute
// path via the preload bridge (Electron webUtils) so the sidecar can read it.
export default function DropZone() {
  const importPath = useStore((s) => s.importPath);
  const openDialog = useStore((s) => s.openDialog);
  const [hover, setHover] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setHover(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const path = window.pdf2midi?.pathForFile?.(file);
    if (path) importPath(path);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      onClick={openDialog}
      className={`flex h-full cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed transition-colors ${
        hover ? 'border-accent bg-accent/10' : 'border-edge'
      }`}
    >
      <div className="text-6xl">🎼</div>
      <div className="text-lg text-slate-200">Перетягніть нотний PDF сюди</div>
      <div className="text-sm text-slate-400">або натисніть, щоб обрати файл</div>
    </div>
  );
}
