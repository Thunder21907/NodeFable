"""Assemble the intermediate registry and print the human-readable report.

The registry is the **step-1 deliverable**: it records what was identified in
the source export — passages (classified), the start passage, global variables
and setup constants — without producing any NodeFable project yet.
"""

import json
import os

from .extract import scan_globals
from .twine_parser import parse_file

__all__ = ["build_registry", "write_registry", "render_report"]


def build_registry(path: str, source_label: str = None):
    story = parse_file(path)

    # start passage from startnode pid (SugarCube), else a "Start"-named
    # passage, else the first content passage.
    start = None
    if story.startnode_pid:
        by_pid = story.by_pid(story.startnode_pid)
        if by_pid:
            start = by_pid.name
    if not start:
        for name, p in story.passages.items():
            if name == "Start" and p.kind == "content":
                start = name
                break
    if not start:
        for name, p in story.passages.items():
            if p.kind == "content":
                start = name
                break

    globals_scan = scan_globals(story.passages)

    return {
        "source": source_label or os.path.basename(path),
        "title": story.title,
        "ifid": story.ifid,
        "format": story.format,
        "format_version": story.format_version,
        "start_passage": start,
        "startnode_pid": story.startnode_pid,
        "constants": globals_scan.to_dict()["constants"],
        "variables": globals_scan.to_dict()["variables"],
        "mutated_constants": globals_scan.to_dict()["mutated_constants"],
        "init_passages": globals_scan.to_dict()["init_passages"],
        "passages": {
            name: p.to_dict() for name, p in story.passages.items()
        },
    }


def write_registry(registry: dict, out_path: str):
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)


def _count(registry, kind):
    return sum(1 for p in registry["passages"].values() if p["kind"] == kind)


def render_report(registry: dict) -> str:
    lines = []
    lines.append("=" * 62)
    lines.append(f"  {registry['title'] or registry['source']}")
    lines.append(f"  IFID {registry['ifid'] or '-'}   format {registry['format'] or '-'}"
                 f" {registry['format_version'] or ''}")
    lines.append("=" * 62)

    kinds = ("content", "widget", "special", "script", "stylesheet", "header", "footer", "private")
    counts = [(k, _count(registry, k)) for k in kinds]
    lines.append("Passages:")
    for k, c in counts:
        if c:
            lines.append(f"  {k:10s} {c}")
    lines.append(f"  {'total':10s} {len(registry['passages'])}")
    lines.append(f"Start passage: {registry['start_passage']}")
    lines.append(f"Init passages scanned: {len(registry['init_passages'])}")
    lines.append("")

    lines.append(f"Global constants (setup): {len(registry['constants'])}")
    for name, info in sorted(registry["constants"].items()):
        flag = "  " if info["resolved"] else "??"
        val = json.dumps(info["value"], ensure_ascii=False) if info["resolved"] else info["expression"]
        lines.append(f"  {flag} {name:30s} : {val}")
    if registry["mutated_constants"]:
        lines.append("  (mutated at runtime, value unknown: "
                     + ", ".join(registry["mutated_constants"]) + ")")
    lines.append("")

    lines.append(f"Global variables (state): {len(registry['variables'])}")
    for name, info in sorted(registry["variables"].items()):
        flag = "  " if info["resolved"] else "??"
        val = json.dumps(info["value"], ensure_ascii=False) if info["resolved"] else info["expression"]
        lines.append(f"  {flag} {name:28s} : {val}")
    unresolved = [n for n, i in registry["variables"].items() if not i["resolved"]]
    if unresolved:
        lines.append(f"\n  Unresolved variables: {', '.join(unresolved)}")
    lines.append("")

    return "\n".join(lines)