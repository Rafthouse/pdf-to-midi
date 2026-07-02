import { useStore } from './store';
import DropZone from './components/DropZone';
import ScoreView from './components/ScoreView';
import OriginalView from './components/OriginalView';
import TransportBar from './components/TransportBar';
import ControlsPanel from './components/ControlsPanel';
import InstrumentVisualizer from './components/InstrumentVisualizer';
import StatusHints from './components/StatusHints';
import CorrectionPanel from './components/CorrectionPanel';
import RecentDocs from './components/RecentDocs';

export default function App() {
  const phase = useStore((s) => s.phase);
  const openDialog = useStore((s) => s.openDialog);
  const hasDoc = useStore((s) => !!s.doc);
  const showOriginal = useStore((s) => s.showOriginal);
  const toggleOriginal = useStore((s) => s.toggleOriginal);
  const showCorrection = useStore((s) => s.showCorrection);
  const toggleCorrection = useStore((s) => s.toggleCorrection);
  const issueCount = useStore((s) => s.doc?.measure_issues?.length ?? 0);
  const exportResult = useStore((s) => s.exportResult);

  return (
    <div className="flex h-full flex-col bg-ink text-slate-100">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-edge px-4 py-2">
        <div className="text-lg font-semibold tracking-wide">PDF<span className="text-accent">2</span>MIDI</div>
        <button
          onClick={openDialog}
          className="rounded-md bg-edge px-3 py-1.5 text-sm text-slate-200 hover:bg-edge/70"
        >
          📂 Відкрити PDF
        </button>
        <RecentDocs />
        {hasDoc && (
          <button
            onClick={toggleOriginal}
            className={`rounded-md px-3 py-1.5 text-sm ${showOriginal ? 'bg-accent text-white' : 'bg-edge text-slate-200 hover:bg-edge/70'}`}
            title="Порівняти з оригіналом"
          >
            🔍 Оригінал
          </button>
        )}
        {hasDoc && (
          <button
            onClick={toggleCorrection}
            className={`rounded-md px-3 py-1.5 text-sm ${showCorrection ? 'bg-accent text-white' : 'bg-edge text-slate-200 hover:bg-edge/70'}`}
            title="Виправити розпізнані ноти"
          >
            🛠 Корекція{issueCount ? ` (${issueCount})` : ''}
          </button>
        )}
        {hasDoc && (
          <button
            onClick={exportResult}
            className="rounded-md bg-edge px-3 py-1.5 text-sm text-slate-200 hover:bg-edge/70"
            title="Зберегти MIDI / MusicXML / JSON"
          >
            💾 Експорт
          </button>
        )}
        <div className="flex-1" />
        <StatusHints />
      </header>

      {/* Score / drop zone */}
      <main className="min-h-0 flex-1 p-3">
        {hasDoc ? (
          <div className="flex h-full gap-3">
            {showOriginal && (
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge bg-panel">
                <div className="border-b border-edge px-3 py-1 text-xs uppercase tracking-wide text-slate-400">Оригінал</div>
                <div className="min-h-0 flex-1"><OriginalView /></div>
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge bg-panel">
              {showOriginal && (
                <div className="border-b border-edge px-3 py-1 text-xs uppercase tracking-wide text-slate-400">Розпізнано</div>
              )}
              <div className="min-h-0 flex-1"><ScoreView /></div>
            </div>
            {showCorrection && <CorrectionPanel />}
          </div>
        ) : (
          <DropZone />
        )}
      </main>

      {/* Transport + controls */}
      <section className="space-y-2 border-t border-edge bg-panel/60 px-4 py-2">
        <TransportBar />
        <ControlsPanel />
      </section>

      {/* Instrument visualizer — responsive height, content scales to fit (no clipping) */}
      <footer className="shrink-0 overflow-hidden border-t border-edge bg-ink/80" style={{ height: 'clamp(150px, 20vh, 230px)' }}>
        {phase === 'ready' || hasDoc ? (
          <InstrumentVisualizer />
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-500">
            Візуалізація інструмента з'явиться після завантаження нот
          </div>
        )}
      </footer>
    </div>
  );
}
