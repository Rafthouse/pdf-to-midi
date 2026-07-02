"""Runtime configuration for the OMR sidecar.

All paths can be overridden via environment variables so the service can be
relocated or pointed at a different Audiveris install without code changes.
"""
from __future__ import annotations

import os
from pathlib import Path


def _env_path(name: str, default: str) -> Path:
    return Path(os.environ.get(name, default)).expanduser()


# Audiveris executable (Windows install default). Override with AUDIVERIS_EXE.
AUDIVERIS_EXE: Path = _env_path(
    "AUDIVERIS_EXE", r"C:\Program Files\Audiveris\Audiveris.exe"
)

# Root working directory: one sub-folder per imported document (job).
WORK_DIR: Path = _env_path("PDF2MIDI_WORK_DIR", r"F:\PDF2MIDI\work")

# Default playback tempo (BPM) used when the score carries no metronome mark.
DEFAULT_TEMPO_BPM: float = float(os.environ.get("PDF2MIDI_DEFAULT_TEMPO", "100"))

# Hard ceiling on Audiveris batch run (seconds) to avoid a hung sidecar.
OMR_TIMEOUT_SEC: int = int(os.environ.get("PDF2MIDI_OMR_TIMEOUT", "600"))


def ensure_work_dir() -> Path:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    return WORK_DIR
