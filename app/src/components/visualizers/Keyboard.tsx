import { KEYBOARD, isBlackKey, midiToName } from '../../lib/instruments';

// SVG piano keyboard. Active MIDI notes light up (spec 4.6).
export default function Keyboard({ active }: { active: number[] }) {
  const set = new Set(active);
  const { lowMidi, highMidi } = KEYBOARD;

  const whites: number[] = [];
  for (let m = lowMidi; m <= highMidi; m++) if (!isBlackKey(m)) whites.push(m);

  const W = 26;          // white key width
  const H = 120;         // white key height
  const bw = W * 0.62;   // black key width
  const bh = H * 0.62;
  const width = whites.length * W;

  const xOf: Record<number, number> = {};
  whites.forEach((m, i) => (xOf[m] = i * W));

  return (
    <svg viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="xMidYMid meet" className="block h-full w-full select-none">
      {/* white keys */}
      {whites.map((m) => {
        const on = set.has(m);
        return (
          <g key={m}>
            <rect
              x={xOf[m]} y={0} width={W - 1} height={H} rx={3}
              fill={on ? '#ffcc4d' : '#fbfbfd'} stroke="#9aa3bf" strokeWidth={0.7}
            />
            {m % 12 === 0 && (
              <text x={xOf[m] + W / 2} y={H - 6} fontSize={7} textAnchor="middle" fill="#5b6b9a">
                {midiToName(m)}
              </text>
            )}
          </g>
        );
      })}
      {/* black keys */}
      {Array.from({ length: highMidi - lowMidi + 1 }, (_, k) => lowMidi + k)
        .filter(isBlackKey)
        .map((m) => {
          // place black key centered over the gap after the white key below it
          const leftWhite = m - 1;
          const baseX = xOf[leftWhite];
          if (baseX === undefined) return null;
          const x = baseX + W - bw / 2;
          const on = set.has(m);
          return (
            <rect
              key={m} x={x} y={0} width={bw} height={bh} rx={2}
              fill={on ? '#e0a800' : '#1b2236'} stroke="#0b1020" strokeWidth={0.7}
            />
          );
        })}
    </svg>
  );
}
