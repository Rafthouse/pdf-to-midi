# PDF2MIDI — desktop app

Electron + React UI for the PDF→MIDI OMR pipeline. Loads a sheet-music PDF,
renders the recognized score, plays it back, and highlights the current notes
on the score **and** on an instrument (keyboard / guitar / bass / Irish
bouzouki in GDAD or FCGC).

The heavy lifting (OMR, MusicXML, MIDI, timeline) lives in the Python
**sidecar** at `../sidecar`; this app spawns it automatically and talks to it
over HTTP.

## Stack

React 18 · Vite 6 · `vite-plugin-electron` · Electron 33 · Tailwind 3 ·
zustand · Tone.js · OpenSheetMusicDisplay.

## Run (dev)

```powershell
cd F:\PDF2MIDI\app
npm install        # first time
npm run dev        # starts Vite + Electron; Electron boots the Python sidecar
```

Requires the sidecar's Python deps installed (`../sidecar/requirements.txt`)
and Audiveris on the machine. Override the sidecar launch via env vars:
`PDF2MIDI_PYTHON`, `PDF2MIDI_PORT`, `PDF2MIDI_SIDECAR_DIR`.

## How it works

```
PDF ─▶ sidecar /import ─▶ poll /jobs ─▶ ScoreDocument (meta + events + timeline)
        │
        ├─ OSMD renders /documents/{id}/musicxml.xml   (ScoreView)
        ├─ PlaybackEngine schedules the timeline cues   (Tone.js)
        └─ RAF clock: position → active MIDI → measure   (highlight + visualizer)
```

Playback is driven directly from the timeline (`onset_sec`, `midi[]`), so the
audio and the visual highlight share one clock. Tempo is a time-scaling factor,
keeping them locked when you change speed.

## Structure

| Path | Role |
|------|------|
| `electron/main.ts`    | window + spawns/stops the Python sidecar |
| `electron/preload.ts` | `pickPdf`, `apiBase`, `pathForFile` bridge |
| `src/store.ts`        | app state (zustand) + RAF highlight clock |
| `src/audio/PlaybackEngine.ts` | Tone.js scheduler driven by the timeline |
| `src/api/client.ts`   | sidecar HTTP client |
| `src/components/ScoreView.tsx` | OSMD render + cursor follow |
| `src/components/visualizers/`  | `Keyboard`, `Fretboard` |
| `src/lib/instruments.ts`       | tunings (GDAD, FCGC, guitar, bass) + fingering math |

## Status

Stage 1 of the spec is complete: PDF → OMR → MIDI → playback with synced note
highlighting and a working bouzouki/keyboard visualizer. Next: OSMD measure
overlay, `confidence`/`bbox` from Audiveris `.omr`, manual note correction,
the LLM assist layer, and `electron-builder` packaging.
