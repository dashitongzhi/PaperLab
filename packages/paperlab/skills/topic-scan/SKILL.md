---
name: topic-scan
description: PaperLab stage 1 — scan public sources (arXiv/PubMed/OpenAlex/S2) for a falsifiable research question, cluster gaps, score feasibility, and record the topic in the paper ledger. Run this before any other paper stage.
---

# Topic Scan

Turn "I want to write a paper" into an approved, falsifiable research question.

## Workflow

1. **Search public sources only** — arXiv, PubMed, bioRxiv, OpenAlex, Semantic Scholar. Never fabricate a citation; every reference must carry a stable ID you actually saw (`citation_status: unverified` otherwise).
2. **Cluster the gaps** — group findings into 2–4 candidate questions. A topic is a question, not a phrase: "gene expression" is not a topic; "how concordant are ORA and preranked GSEA across tools on simulated DE inputs" is.
3. **Score feasibility** — data availability, compute cost, novelty delta vs the 5 closest papers.
4. **Record** — write `PAPERLAB.md` (research_question, target_venue, hard_constraints) and one ledger row per candidate claim (status: draft).

## Gate

STOP after presenting candidates. The human must approve the topic (gate: topic) before data work begins.
