---
name: paper-audit
description: PaperLab stage 4 — run the structural and evidence-hygiene audit, dispatch fix suggestions, optionally convene the reviewer swarm, and record the human gate decision.
---

# Paper Audit

Adversarially verify the draft before any submission move.

## Workflow

1. **Structure audit** — required sections present, no TODO/TBD/PLACEHOLDER strings, every figure referenced, compile warnings resolved.
2. **Evidence audit** — every ledger row with status ≠ supported must not appear as a settled conclusion; every precise number traces to an artifact.
3. **Citation audit** — every `\cite{}` key has a verification row; any `unverified` blocks.
4. **Fix loop** — turn each BLOCKED finding into the next tool call; rollback to write is the legal path for revisions.
5. **(Optional) Reviewer swarm** — three personas (methodologist, domain expert, hostile reader), then a meta-review and a revision plan.

## Gate

Present verdict PASS/BLOCKED with findings. Human gate: audit — submission requires explicit approval.
