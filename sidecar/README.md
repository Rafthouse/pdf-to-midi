# PDF2MIDI — OMR sidecar

Python service that turns a sheet-music **PDF** into structured musical data:

```
PDF → Audiveris (MusicXML) → music21 parse → NoteEvents + highlight timeline → MIDI
```

It is the OMR/parsing/playback-data backend for the larger PDF2MIDI app (and,
later, the bouzouki assistant). The UI (Electron + React) consumes it over HTTP.

## Layout

| File | Responsibility |
|------|----------------|
| `app/config.py`  | paths (Audiveris exe, work dir), default tempo, timeouts |
| `app/models.py`  | pydantic schemas — `NoteEvent`, `ScoreMeta`, `HighlightEvent`, `ScoreDocument` |
| `app/omr.py`     | **only** module that knows Audiveris (swap here to change OMR engine) |
| `app/parsing.py` | MusicXML → model + tempo map (quarter-lengths **and** seconds) |
| `app/midi.py`    | MusicXML → Standard MIDI File |
| `app/service.py` | pipeline orchestration + in-memory registry (mirrored to disk) |
| `app/main.py`    | FastAPI Integration API |
| `app/cli.py`     | run the pipeline without HTTP |

## Setup

Requires **Audiveris 5.10+** installed (default `C:\Program Files\Audiveris`)
with the `eng.traineddata` OCR language file, plus Python 3.11+.

```powershell
python -m pip install -r requirements.txt
```

Override locations via env vars: `AUDIVERIS_EXE`, `PDF2MIDI_WORK_DIR`,
`PDF2MIDI_DEFAULT_TEMPO`, `PDF2MIDI_OMR_TIMEOUT`.

## CLI

```powershell
python -m app.cli process "C:\path\to\score.pdf" --json out.json
```

## HTTP API

```powershell
python -m uvicorn app.main:app --port 8765
# interactive docs: http://127.0.0.1:8765/docs
```

| Method & path | Purpose |
|---------------|---------|
| `GET  /`                          | service info / health |
| `POST /import` `{path}`           | start pipeline on a local PDF → job |
| `POST /import/upload` (multipart) | start pipeline on an uploaded PDF → job |
| `GET  /jobs/{id}`                 | job state: pending / running / done / error |
| `GET  /documents`                 | list processed documents (summaries) |
| `GET  /documents/{id}`            | full `ScoreDocument` (meta + events + timeline) |
| `GET  /documents/{id}/meta`       | score metadata only |
| `GET  /documents/{id}/events`     | every `NoteEvent` |
| `GET  /documents/{id}/timeline`   | compact highlight cues for playback |
| `GET  /documents/{id}/midi`       | exported `.mid` |
| `GET  /documents/{id}/musicxml`   | exported `.mxl` |

### Timeline cue shape

```json
{ "onset_sec": 0.0, "duration_sec": 0.6, "measure": 1, "midi": [48, 60] }
```

The score viewer highlights `measure`; the instrument visualizer (keyboard /
guitar / bass / bouzouki) lights up `midi` for `duration_sec` starting at
`onset_sec`. Tempo changes in playback rescale `*_sec` proportionally.

## Known limitations (honest reporting, per spec §5)

- `confidence` and `bbox` on every `NoteEvent` are `null` for now. Audiveris
  stores per-symbol confidence and geometry inside its `.omr` project; wiring
  that through (to drive "uncertain note" UI and PDF overlay) is a follow-up.
- Best on engraved / digital PDFs. Scans and handwriting are lower quality and
  belong to a separate pipeline (spec §12).
- A missing key signature is reported as a warning but may be correct (scores
  using inline accidentals only — e.g. the Nyman test piece).
