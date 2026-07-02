"""OMR stage: drive Audiveris in batch mode to turn a PDF into MusicXML.

This is intentionally the *only* module that knows about Audiveris. Swapping the
OMR engine (spec section 9.2) means replacing just this file's `run_omr`.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from . import config


class OMRError(RuntimeError):
    pass


def run_omr(pdf_path: Path, out_dir: Path) -> Path:
    """Run Audiveris on `pdf_path`, exporting MusicXML into `out_dir`.

    Returns the path to the produced `.mxl` file. Raises OMRError on failure.
    """
    pdf_path = Path(pdf_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not config.AUDIVERIS_EXE.exists():
        raise OMRError(f"Audiveris not found at {config.AUDIVERIS_EXE}")
    if not pdf_path.exists():
        raise OMRError(f"Input PDF not found: {pdf_path}")

    # NOTE: never pass -force on a fresh book; Audiveris fails reaching PAGE.
    cmd = [
        str(config.AUDIVERIS_EXE),
        "-batch",
        "-transcribe",
        "-export",
        "-output", str(out_dir),
        "--", str(pdf_path),
    ]

    log_path = out_dir / "audiveris.log"
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.OMR_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired as exc:
        raise OMRError(f"Audiveris timed out after {config.OMR_TIMEOUT_SEC}s") from exc

    log_path.write_text((proc.stdout or "") + "\n" + (proc.stderr or ""), encoding="utf-8")

    mxl_files = sorted(out_dir.glob("*.mxl"))
    if not mxl_files:
        tail = "\n".join((proc.stdout or "").splitlines()[-15:])
        raise OMRError(
            f"Audiveris produced no MusicXML (exit {proc.returncode}).\n"
            f"--- log tail ---\n{tail}\n"
            f"Full log: {log_path}"
        )
    return mxl_files[0]
