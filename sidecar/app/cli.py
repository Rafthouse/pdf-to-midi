"""CLI entry point — run the pipeline without HTTP (for testing & batch use).

Usage:
    python -m app.cli process "C:\\path\\to\\score.pdf"
    python -m app.cli process score.pdf --json out.json
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import service


def _cmd_process(args) -> int:
    pdf = Path(args.pdf)
    if not pdf.exists():
        print(f"ERROR: PDF not found: {pdf}", file=sys.stderr)
        return 2
    print(f"[1/3] OMR + parse + MIDI on: {pdf.name} ...", file=sys.stderr)
    doc = service.process_pdf(pdf)

    m = doc.meta
    print("\n=== SCORE ===")
    print(f"  id          : {doc.id}")
    print(f"  title       : {m.title}")
    print(f"  composer    : {m.composer}")
    print(f"  parts       : {m.num_parts} {m.part_names}")
    print(f"  measures    : {m.num_measures}")
    print(f"  time sig    : {[f'{t.numerator}/{t.denominator}@m{t.measure}' for t in m.time_signatures]}")
    print(f"  key sig     : {[f'{k.fifths}@m{k.measure}' for k in m.key_signatures] or 'none'}")
    print(f"  tempo       : {[f'{t.bpm:.0f}bpm@{t.onset_ql}ql' for t in m.tempos]}")
    print(f"  duration    : {m.duration_sec:.1f}s")
    print(f"  events      : {len(doc.events)}  | timeline cues: {len(doc.timeline)}")
    print(f"  musicxml    : {doc.musicxml_path}")
    print(f"  midi        : {doc.midi_path}")
    if doc.warnings:
        print("  warnings    :")
        for w in doc.warnings:
            print(f"    - {w}")

    if args.json:
        Path(args.json).write_text(doc.model_dump_json(indent=2), encoding="utf-8")
        print(f"\n  wrote full document JSON -> {args.json}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="pdf2midi", description="OMR sidecar CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("process", help="run full pipeline on a PDF")
    p.add_argument("pdf", help="path to input PDF")
    p.add_argument("--json", help="write full ScoreDocument JSON to this path")
    p.set_defaults(func=_cmd_process)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
