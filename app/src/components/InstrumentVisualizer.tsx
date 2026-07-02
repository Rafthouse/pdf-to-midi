import { useStore } from '../store';
import { instrumentById, tuningFor } from '../lib/instruments';
import Keyboard from './visualizers/Keyboard';
import Fretboard from './visualizers/Fretboard';

export default function InstrumentVisualizer() {
  const instrumentId = useStore((s) => s.instrumentId);
  const tuningId = useStore((s) => s.tuningId);
  const active = useStore((s) => s.activeMidi);

  const inst = instrumentById(instrumentId);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden px-4 py-2">
      {inst.kind === 'keyboard'
        ? <Keyboard active={active} />
        : <Fretboard tuning={tuningFor(inst, tuningId)} frets={inst.frets} active={active} />}
    </div>
  );
}
