#!/usr/bin/env python3
"""latex-bibliography-audit — entry point.

Usage (via PaperLab skill runner):
    paperlab skill run latex-bibliography-audit --paper_dir <paper>

Writes <paper_dir>/checks/bibliography-audit.md with findings.
"""
import argparse
import re
import sys
from collections import Counter
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--paper_dir", required=True)
    args = p.parse_args()
    paper = Path(args.paper_dir)
    tex_candidates = [paper / "manuscript" / "main.tex", paper / "drafts" / "04_draft.md"]
    bib = paper / "refs" / "refs.bib"
    tex = next((t for t in tex_candidates if t.exists()), None)

    out_lines = [f"# Bibliography audit — {paper.name}", ""]

    if not tex:
        out_lines += ["**ERROR**: no manuscript found.", ""]
        write(paper, out_lines)
        return 1

    used = set(re.findall(r"\\cite(?:\[[^\]]*\])?\{([^}]+)\}", tex.read_text()))
    if not bib.exists():
        out_lines += ["**ERROR**: refs/refs.bib missing.", ""]
        write(paper, out_lines)
        return 1

    bib_text = bib.read_text()
    entries = parse_bib(bib_text)
    defined = set(entries.keys())
    missing = sorted(used - defined)
    do_map = Counter(e["doi"] for e in entries.values() if e.get("doi"))

    out_lines += [
        "## Summary",
        f"- manuscript uses {len(used)} \\cite keys",
        f"- refs.bib defines {len(defined)} @entry",
        f"- missing entries: **{len(missing)}**",
        f"- duplicate DOIs: **{sum(1 for c in do_map.values() if c > 1)}**",
        "",
    ]
    if missing:
        out_lines += ["## Missing", "", *("- " + k for k in missing), ""]
    out_lines += [
        "## Entries missing DOI / arXiv",
        "",
        *(f"- {k}" for k, e in entries.items() if not e.get("doi") and not e.get("eprint")),
        "",
    ]
    write(paper, out_lines)
    print(f"wrote {paper / 'checks' / 'bibliography-audit.md'}")
    return 0


def parse_bib(text):
    entries = {}
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}", text):
        body = m.group(3)
        fields = dict(re.findall(r"(\w+)\s*=\s*\{([^{}]*)\}", body))
        entries[m.group(2)] = fields
    return entries


def write(paper, lines):
    out = paper / "checks" / "bibliography-audit.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
