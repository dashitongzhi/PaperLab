---
name: latex-bibliography-audit
description: |
  Audit a paper's LaTeX bibliography end-to-end. Verifies every \cite{} key
  resolves against refs.bib, flags missing DOIs / arXiv IDs, detects
  duplicate entries (same DOI), and reports citation recency. Runs as a
  PaperLab skill invoked via `paperlab skill run latex-bibliography-audit`.
metadata:
  paperlab:
    stage: audit
    risk_level: low
    inputs_schema:
      paper_dir:
        type: string
        required: true
    outputs_schema:
      audit_report:
        type: string
        description: Path to bibliography-audit.md
---

# latex-bibliography-audit

End-to-end bibliography audit. Used during the audit stage of a PaperLab
run. Detects:

- `\cite{}` keys used in manuscript but missing from `refs/refs.bib`
- duplicate BibTeX entries (same DOI / arXiv ID)
- entries missing `doi = {...}` or `eprint = {...}`
- citation recency (median year of cited works)

Pairs with `paperlab_citation_check`: this skill does structural audits,
`paperlab_citation_check` does external DOI/arXiv resolution.

## Procedure

1. Read `manuscript/main.tex` (or `drafts/04_draft.md`).
2. Read `refs/refs.bib`.
3. Build the set of `\cite{key}` keys actually used.
4. Build the set of `@entry{key, ...}` keys actually defined.
5. Report keys in (3) but not (4) as **missing**.
6. Detect duplicate `doi = {...}` / `eprint = {...}` across entries.
7. Report entries without a `doi = {...}` or `eprint = {...}` field.
8. Compute median publication year and percent of citations from 2020+.

Writes output to `<paper_dir>/checks/bibliography-audit.md`.

## Risk

`risk_level: low`. Read-only over manuscript + refs.bib.
