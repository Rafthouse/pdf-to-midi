import { type Tuning, fretPositions, midiToName } from '../../lib/instruments';

// SVG fretboard for guitar / bass / bouzouki. Shows every position where an
// active MIDI note can be played (spec 4.6: "декілька можливих аплікатур"),
// labels open strings (drones), and marks standard inlay dots.
const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19];

export default function Fretboard({ tuning, frets, active }: {
  tuning: Tuning; frets: number; active: number[];
}) {
  const strings = tuning.strings;
  // Draw lowest string at the bottom: reverse for display rows.
  const rows = strings.map((_, i) => i).reverse();
  const nStrings = strings.length;

  const padL = 46, padR = 12, padT = 16, padB = 16;
  const fretW = 40, stringGap = 26;
  const width = padL + padR + frets * fretW;
  const height = padT + padB + (nStrings - 1) * stringGap;

  const yOf = (displayRow: number) => padT + displayRow * stringGap;
  const xOfFret = (f: number) => padL + (f - 0.5) * fretW; // note sits between frets
  const xNut = padL;

  const activePositions = new Set<string>();
  for (const m of active) {
    for (const p of fretPositions(strings, frets, m)) activePositions.add(`${p.stringIndex}:${p.fret}`);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="block h-full w-full select-none">
      {/* fret lines */}
      {Array.from({ length: frets + 1 }, (_, f) => (
        <line key={f}
          x1={padL + f * fretW} y1={yOf(0)} x2={padL + f * fretW} y2={yOf(nStrings - 1)}
          stroke={f === 0 ? '#cdd3e6' : '#3a4566'} strokeWidth={f === 0 ? 4 : 1.2}
        />
      ))}
      {/* inlay dots */}
      {INLAYS.filter((f) => f <= frets).map((f) => (
        <circle key={f} cx={xOfFret(f)} cy={(yOf(0) + yOf(nStrings - 1)) / 2} r={3} fill="#2b3a5c" />
      ))}
      {/* fret numbers */}
      {INLAYS.filter((f) => f <= frets).map((f) => (
        <text key={f} x={xOfFret(f)} y={height - 3} fontSize={8} textAnchor="middle" fill="#6b7aa5">{f}</text>
      ))}

      {/* strings + open labels */}
      {rows.map((stringIndex, displayRow) => {
        const open = strings[stringIndex];
        const openActive = active.includes(open);
        return (
          <g key={stringIndex}>
            <line x1={xNut} y1={yOf(displayRow)} x2={width - padR} y2={yOf(displayRow)} stroke="#54608a" strokeWidth={1 + (nStrings - 1 - displayRow) * 0.25} />
            <text x={6} y={yOf(displayRow) + 4} fontSize={11} fill={openActive ? '#ffcc4d' : '#aeb6d6'} fontWeight={700}>
              {tuning.names[stringIndex]}
            </text>
            {openActive && <circle cx={xNut - 14} cy={yOf(displayRow)} r={6} fill="#ffcc4d" />}
          </g>
        );
      })}

      {/* active fretted positions */}
      {rows.map((stringIndex, displayRow) =>
        Array.from({ length: frets }, (_, f0) => f0 + 1).map((fret) => {
          if (!activePositions.has(`${stringIndex}:${fret}`)) return null;
          const m = strings[stringIndex] + fret;
          return (
            <g key={`${stringIndex}-${fret}`}>
              <circle cx={xOfFret(fret)} cy={yOf(displayRow)} r={9} fill="#ffcc4d" stroke="#0b1020" strokeWidth={1} />
              <text x={xOfFret(fret)} y={yOf(displayRow) + 3} fontSize={7} textAnchor="middle" fill="#1b2236" fontWeight={700}>
                {midiToName(m).replace(/-?\d+/, '')}
              </text>
            </g>
          );
        })
      )}
    </svg>
  );
}
