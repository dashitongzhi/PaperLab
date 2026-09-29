#!/usr/bin/env python3
import argparse
import csv
import re
from pathlib import Path


REQUIRED_SECTIONS = (
    "Introduction",
    "Methods",
    "Results",
    "Discussion",
    "Conclusion",
)
PLACEHOLDER_RE = re.compile(r"\b(?:TODO|TBD|INSERT|PLACEHOLDER)\b", re.IGNORECASE)
CITE_RE = re.compile(r"\\cite\w*\{([^}]+)\}")
BIB_RE = re.compile(r"@\w+\{\s*([^,\s]+)")


def read_csv(path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def audit_project(project):
    blockers = []
    warnings = []
    manuscript = project / "manuscript" / "main.tex"
    bib = project / "manuscript" / "references.bib"
    ledger_path = project / "evidence" / "claim_evidence_ledger.csv"
    sources_path = project / "evidence" / "sources.csv"

    if not manuscript.exists():
        return ["Missing manuscript/main.tex"], warnings

    text = manuscript.read_text(encoding="utf-8")
    placeholder_count = len(PLACEHOLDER_RE.findall(text))
    if placeholder_count:
        blockers.append(f"Manuscript contains {placeholder_count} unresolved placeholders.")

    for section in REQUIRED_SECTIONS:
        if not re.search(rf"\\section\{{{re.escape(section)}\}}", text):
            blockers.append(f"Missing required section: {section}.")

    if "TODO: authors" in text or "\\author{}" in text:
        blockers.append("Author and affiliation metadata are incomplete.")

    cite_keys = set()
    for group in CITE_RE.findall(text):
        cite_keys.update(key.strip() for key in group.split(",") if key.strip())
    bib_text = bib.read_text(encoding="utf-8") if bib.exists() else ""
    bib_keys = set(BIB_RE.findall(bib_text))
    missing = sorted(cite_keys - bib_keys)
    if missing:
        blockers.append("Citation keys missing from BibTeX: " + ", ".join(missing))
    if not cite_keys:
        warnings.append("No in-text citations found.")

    ledger = read_csv(ledger_path)
    if not ledger:
        blockers.append("Claim-evidence ledger is missing or empty.")
    else:
        supported = [row for row in ledger if row.get("status", "").strip().lower() == "supported"]
        unresolved = [
            row for row in ledger
            if row.get("status", "").strip().lower() not in {"supported", "rejected"}
        ]
        if not supported:
            blockers.append("No claims are marked supported in the claim-evidence ledger.")
        if unresolved:
            ids = [row.get("claim_id", "?") for row in unresolved]
            blockers.append("Unresolved claim rows: " + ", ".join(ids))
        for row in supported:
            if not row.get("evidence_artifact", "").strip():
                blockers.append(f"Supported claim {row.get('claim_id', '?')} has no evidence artifact.")

    sources = read_csv(sources_path)
    for row in sources:
        status = row.get("verification_status", "").strip().lower()
        if status not in {"verified", "metadata_verified", "full_text_verified"}:
            blockers.append(f"Source {row.get('source_id', '?')} is not verified.")
        if not (row.get("identifier", "").strip() or row.get("url", "").strip()):
            blockers.append(f"Source {row.get('source_id', '?')} lacks an identifier or URL.")

    if "Limitations and future work" not in text:
        warnings.append("No dedicated limitations and future work subsection found.")
    if "AI usage disclosure" not in text:
        warnings.append("No AI usage disclosure section found.")
    return blockers, warnings


def render_report(project, blockers, warnings):
    verdict = "BLOCKED" if blockers else "PASS"
    lines = [
        "# Deterministic paper audit",
        "",
        f"- Project: `{project.name}`",
        f"- Verdict: **{verdict}**",
        f"- Blocking findings: {len(blockers)}",
        f"- Warnings: {len(warnings)}",
        "",
        "## Blocking findings",
        "",
    ]
    lines.extend(f"- {item}" for item in blockers or ["None."])
    lines.extend(["", "## Warnings", ""])
    lines.extend(f"- {item}" for item in warnings or ["None."])
    lines.extend([
        "",
        "This audit checks structural and evidence hygiene only. A PASS is not a peer-review or submission-readiness guarantee.",
        "",
    ])
    target = project / "checks" / "audit_report.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")
    return verdict, target


def main():
    parser = argparse.ArgumentParser(description="Audit generated paper workspaces.")
    parser.add_argument("--batch", required=True)
    args = parser.parse_args()
    root = Path(args.batch)
    projects = sorted(path for path in root.iterdir() if (path / "project.json").exists())
    blocked = 0
    for project in projects:
        blockers, warnings = audit_project(project)
        verdict, report = render_report(project, blockers, warnings)
        blocked += verdict == "BLOCKED"
        print(f"{project.name}\t{verdict}\t{report}")
    print(f"projects={len(projects)} blocked={blocked} passed={len(projects) - blocked}")
    raise SystemExit(1 if blocked else 0)


if __name__ == "__main__":
    main()
