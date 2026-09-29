---
name: paper-write
description: PaperLab stage 3 — draft the manuscript section by section under paragraph-skeleton constraints, pairing every claim with a ledger row and verifying every citation before it enters refs.bib.
---

# Paper Write

Draft the manuscript with the evidence contract enforced.

## Workflow

1. **Skeleton first** — Introduction: Hook → Background → Gap → This Work → Contribution. Methods: design → inputs → procedure → metrics. No wall-of-text generation.
2. **Claim → ledger row** — every factual sentence gets `evidence_status ∈ {supported, draft, gap}` + an artifact pointer. `draft`/`gap` claims MUST NOT be phrased as conclusions.
3. **Citation check** — resolve every `\cite{}` against CrossRef → arXiv → PubMed before it enters `refs/refs.bib`. A failed resolution blocks the citation.
4. **Figures** — every figure needs a caption stating what the reader should see; no placeholder images.

## Gate

Deliver the draft + ledger summary, then stop for audit.
