"""Step-1 SugarCube -> NodeFable converter: identification & analysis.

Usage:
    python -m converter <story.html> [--out registry.json]

Parses a Twine/SugarCube export, classifies all passages, resolves the start
passage, and extracts global variables (state) and setup constants (setup)
from the init passages. Writes an intermediate registry and prints a report.
"""

import argparse
import os
import sys

from .registry import build_registry, render_report, write_registry


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="python -m converter",
        description="Identify passages, global variables, and setup constants "
                    "in a Twine/SugarCube export (step 1 of the NodeFable port).",
    )
    ap.add_argument("story", help="Path to the .html export file")
    ap.add_argument("--out", default=None, help="Where to write the registry JSON "
                    "(default: <story_dir>/<story_name>_registry.json)")
    ap.add_argument("--no-report", action="store_true",
                    help="Suppress the console report")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.story):
        print(f"error: no such file: {args.story}", file=sys.stderr)
        return 1

    registry = build_registry(args.story)

    out = args.out
    if not out:
        base = os.path.splitext(args.story)[0]
        out = base + "_registry.json"
    write_registry(registry, out)
    print(f"registry written -> {out}")

    if not args.no_report:
        print()
        print(render_report(registry))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())