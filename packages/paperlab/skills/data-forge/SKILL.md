---
name: data-forge
description: PaperLab stage 2 — acquire or simulate the dataset, compute sha256 manifests, run train/test overlap checks, and record experiment traceability. Requires an approved topic gate.
---

# Data Forge

Turn the approved question into reproducible data.

## Workflow

1. **Manifest first** — every dataset gets sha256 + `data/manifest.json` + `traceability.json` (inputs, code commit, params, env, seed).
2. **Overlap check** — Jaccard row-hash every dataset pair; refuse to proceed above the 5% threshold (train/test leakage is the #1 AI-paper failure).
3. **Traceability** — every experiment writes `evidence/experiment-traceability.jsonl`; a number without a manifest pointer cannot enter the paper.
4. **Run the real experiment** — results only from code you ran in this session; cite the run id.

## Gate

Report dataset stats and stop. The write stage may not start until data artifacts are on disk.
