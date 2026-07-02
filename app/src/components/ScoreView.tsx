import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { useStore } from '../store';
import { api } from '../api/client';

interface Rect { x: number; y: number; w: number; h: number; }
type RectMap = Record<number, Rect>;

const HILITE = '#2f73ff';        // active-note colour
const COLORABLE = 'path, ellipse';

// Renders the recognized MusicXML (OSMD) with:
//  - real-time per-beat note highlighting synced to playback (notes recolour,
//    current measure framed) driven by the internal timeline, not the PDF;
//  - mouse measure selection (click / drag) and a visible loop range used by
//    the player to repeat that section (spec: highlighting + loop).
export default function ScoreView() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const zoomRef = useRef(1);
  const fitRef = useRef(true);
  const lastBeatRef = useRef(-1);
  const lastPlayingRef = useRef(false);
  const spwRef = useRef(2.4); // seconds per whole note

  const [zoomPct, setZoomPct] = useState(100);
  const [ready, setReady] = useState(false);
  const [rects, setRects] = useState<RectMap>({});
  const [hlMeasure, setHlMeasure] = useState(0);

  const docId = useStore((s) => s.doc?.id ?? null);
  const revision = useStore((s) => s.doc?.revision ?? 0);
  const bpm = useStore((s) => s.doc?.meta.tempos[0]?.bpm ?? 100);
  const loopStart = useStore((s) => s.loopStartMeasure);
  const loopEnd = useStore((s) => s.loopEndMeasure);
  const setLoopMeasures = useStore((s) => s.setLoopMeasures);
  const selectedMeasure = useStore((s) => s.selectedMeasure);

  // --- measure rectangle map (overlay/host coordinate space) -------------- //
  const buildRects = useCallback(() => {
    const osmd = osmdRef.current as unknown as {
      zoom: number; GraphicSheet?: { MeasureList?: unknown[][] };
    } | null;
    const ml = osmd?.GraphicSheet?.MeasureList;
    if (!osmd || !ml) return;
    const U = 10 * osmd.zoom;
    const map: RectMap = {};
    for (let i = 0; i < ml.length; i++) {
      const top = ml[i]?.[0] as { measureNumber?: number; PositionAndShape?: { AbsolutePosition: { x: number; y: number }; Size: { width: number; height: number } } } | undefined;
      const bot = (ml[i]?.[ml[i].length - 1] ?? top) as typeof top;
      if (!top?.PositionAndShape) continue;
      const tp = top.PositionAndShape;
      const bp = bot!.PositionAndShape!;
      const num = top.measureNumber ?? i + 1;
      map[num] = {
        x: tp.AbsolutePosition.x * U,
        y: tp.AbsolutePosition.y * U,
        w: tp.Size.width * U,
        h: (bp.AbsolutePosition.y + bp.Size.height - tp.AbsolutePosition.y) * U,
      };
    }
    setRects(map);
  }, []);

  const applyZoom = useCallback((z: number) => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    const clamped = Math.max(0.25, Math.min(3, z));
    zoomRef.current = clamped;
    osmd.zoom = clamped;
    osmd.render();
    try { osmd.cursor.show(); } catch { /* noop */ }
    lastBeatRef.current = -1;
    setZoomPct(Math.round(clamped * 100));
    buildRects();
  }, [buildRects]);

  const fitWidth = useCallback(() => {
    const osmd = osmdRef.current;
    const scroller = scrollRef.current;
    const host = hostRef.current;
    if (!osmd || !scroller || !host) return;
    osmd.zoom = 1;
    osmd.render();
    const natural = host.querySelector('svg')?.getBoundingClientRect().width || scroller.clientWidth;
    const avail = scroller.clientWidth - 24;
    applyZoom(Math.max(0.25, Math.min(3, avail / natural)));
  }, [applyZoom]);

  // --- (re)load score ----------------------------------------------------- //
  useEffect(() => {
    if (!docId || !hostRef.current) return;
    let cancelled = false;
    setReady(false);

    const osmd = new OpenSheetMusicDisplay(hostRef.current, {
      autoResize: false, backend: 'svg', drawingParameters: 'compacttight', followCursor: false,
    });
    osmdRef.current = osmd;

    (async () => {
      const url = await api.musicxmlUrl(docId, revision);
      await osmd.load(url);
      if (cancelled) return;
      fitRef.current = true;
      fitWidth();
      osmd.cursor.show();
      osmd.cursor.reset();
      lastBeatRef.current = -1;
      setReady(true);
    })().catch((e) => console.error('OSMD load failed', e));

    return () => {
      cancelled = true;
      try { osmd.cursor?.hide(); } catch { /* noop */ }
      if (hostRef.current) hostRef.current.innerHTML = '';
      osmdRef.current = null;
    };
  }, [docId, revision, fitWidth]);

  useEffect(() => { spwRef.current = (4 * 60) / bpm; }, [bpm]);

  // re-fit on resize
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !osmdRef.current) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => fitWidth(), 150);
    });
    ro.observe(scroller);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, [fitWidth]);

  // --- highlight clock: sync cursor + colour notes to playback position --- //
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let active = true; // guards against a stale loop (React StrictMode double-mount)
    // Bulletproof clear: reset EVERY note we may have coloured by querying the
    // SVG, not a tracked list (immune to ref desync / StrictMode / HMR churn).
    const uncolor = () => {
      hostRef.current?.querySelectorAll<SVGElement>(COLORABLE).forEach((e) => {
        const f = e.style.fill;
        if (f && (f === HILITE || f.replace(/\s/g, '') === 'rgb(47,115,255)')) e.style.fill = '';
      });
    };
    const recolor = (cur: { GNotesUnderCursor?: () => { getSVGGElement?: () => SVGElement | null }[] }) => {
      uncolor();
      const gn = cur.GNotesUnderCursor?.() ?? [];
      for (const n of gn) {
        const g = n.getSVGGElement?.();
        g?.querySelectorAll<SVGElement>(COLORABLE).forEach((e) => { e.style.fill = HILITE; });
      }
    };
    const tick = () => {
      if (!active) return;
      const osmd = osmdRef.current;
      if (osmd?.cursor) {
        const cur = osmd.cursor;
        const it = cur.iterator as unknown as { currentTimeStamp: { RealValue: number }; EndReached: boolean };
        const spw = spwRef.current;
        const pos = useStore.getState().positionSec;
        const tOf = () => it.currentTimeStamp.RealValue * spw;
        let g = 0;
        while (tOf() > pos + 1e-4 && it.currentTimeStamp.RealValue > 0 && g++ < 4000) cur.previous();
        g = 0;
        while (!it.EndReached && g++ < 4000) {
          cur.next();
          if (it.EndReached) { cur.previous(); break; }
          if (tOf() > pos + 1e-4) { cur.previous(); break; }
        }
        const playing = useStore.getState().isPlaying;
        const beat = it.currentTimeStamp.RealValue;
        if (beat !== lastBeatRef.current || playing !== lastPlayingRef.current) {
          lastBeatRef.current = beat;
          lastPlayingRef.current = playing;
          cur.update();
          const m = ((cur.iterator as unknown as { CurrentMeasureIndex: number }).CurrentMeasureIndex ?? 0) + 1;
          setHlMeasure(m);
          // Colour notes only while sounding; clear them as soon as we pause /
          // stop / reach the end so highlights never stick.
          if (playing) recolor(cur as never);
          else uncolor();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(raf); uncolor(); };
  }, [ready]);

  // scroll to a measure picked in the correction panel
  useEffect(() => {
    if (selectedMeasure == null) return;
    const r = rects[selectedMeasure];
    const sc = scrollRef.current;
    if (r && sc) sc.scrollTo({ top: Math.max(0, r.y - 40), behavior: 'smooth' });
  }, [selectedMeasure, rects]);

  // scroll the active measure into view during playback
  useEffect(() => {
    const r = rects[hlMeasure];
    const sc = scrollRef.current;
    if (!r || !sc) return;
    const top = r.y, bottom = r.y + r.h;
    if (top < sc.scrollTop + 8 || bottom > sc.scrollTop + sc.clientHeight - 8) {
      sc.scrollTo({ top: Math.max(0, top - 40), behavior: 'smooth' });
    }
  }, [hlMeasure, rects]);

  // --- mouse measure selection (click = single / two-click & drag = range) - //
  const measureAt = useCallback((clientX: number, clientY: number): number | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const wr = wrap.getBoundingClientRect();
    const x = clientX - wr.left, y = clientY - wr.top;
    let best: number | null = null;
    for (const [num, r] of Object.entries(rects)) {
      if (y >= r.y && y <= r.y + r.h && x >= r.x && x <= r.x + r.w) { best = +num; break; }
    }
    return best;
  }, [rects]);

  const dragRef = useRef<{ anchor: number; moved: boolean } | null>(null);
  const onDown = (e: React.MouseEvent) => {
    const m = measureAt(e.clientX, e.clientY);
    if (m == null) return;
    dragRef.current = { anchor: m, moved: false };
    setLoopMeasures(m, m);
  };
  const onMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const m = measureAt(e.clientX, e.clientY);
    if (m != null && m !== d.anchor) { d.moved = true; setLoopMeasures(d.anchor, m); }
  };
  const onUp = (e: React.MouseEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    // pure click: extend an existing single selection to a range (Mode A)
    if (loopStart != null && loopStart === loopEnd && loopStart !== d.anchor) {
      setLoopMeasures(loopStart, d.anchor);
    }
  };

  const zoomBy = (delta: number) => { fitRef.current = false; applyZoom(zoomRef.current + delta); };
  const inLoop = (m: number) => loopStart != null && loopEnd != null && m >= loopStart && m <= loopEnd;

  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-md bg-ink/80 px-1.5 py-1 text-sm backdrop-blur">
        <button onClick={() => zoomBy(-0.1)} className="h-6 w-6 rounded bg-edge text-slate-200">−</button>
        <span className="w-12 text-center font-mono text-xs text-slate-300">{zoomPct}%</span>
        <button onClick={() => zoomBy(+0.1)} className="h-6 w-6 rounded bg-edge text-slate-200">+</button>
        <button onClick={() => { fitRef.current = true; fitWidth(); }} className="ml-1 rounded bg-edge px-2 text-xs text-slate-200" title="Вмістити по ширині">⤢</button>
      </div>

      <div ref={scrollRef} className="h-full overflow-auto p-3">
        <div ref={wrapRef} className="relative">
          <div ref={hostRef} className="osmd-host min-h-[200px]" />

          {/* visual overlay: loop range + current measure (no pointer events) */}
          <div className="pointer-events-none absolute inset-0">
            {Object.entries(rects).map(([num, r]) =>
              inLoop(+num) ? (
                <div key={num} className="absolute rounded-sm"
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h,
                    background: 'rgba(91,140,255,0.16)', outline: '1px solid rgba(91,140,255,0.5)' }} />
              ) : null
            )}
            {loopStart != null && rects[loopStart] && (
              <div className="absolute" style={{ left: rects[loopStart].x, top: rects[loopStart].y, width: 3, height: rects[loopStart].h, background: '#22c55e' }} />
            )}
            {loopEnd != null && rects[loopEnd] && (
              <div className="absolute" style={{ left: rects[loopEnd].x + rects[loopEnd].w - 3, top: rects[loopEnd].y, width: 3, height: rects[loopEnd].h, background: '#f59e0b' }} />
            )}
            {hlMeasure > 0 && rects[hlMeasure] && (
              <div className="absolute rounded-sm" style={{ left: rects[hlMeasure].x, top: rects[hlMeasure].y, width: rects[hlMeasure].w, height: rects[hlMeasure].h, outline: '2px solid rgba(255,204,77,0.85)' }} />
            )}
          </div>

          {/* hit layer for selection */}
          <div className="absolute inset-0 cursor-crosshair" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} />
        </div>
      </div>
    </div>
  );
}
