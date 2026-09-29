---
name: qa-check
description: PaperLab mechanical QA — verify every compiled PDF (pages, cited reference count, embedded fonts, zero Type-3 fonts, zero undefined references, zero layout warnings) and record sha256 per paper into qa.json. Runs inside the audit stage before any human review.
---

# QA Check

Mechanical truth about the compiled artifact.

## Workflow

1. **Compile** — zero errors; every `??` reference resolved.
2. **Measure** — pages, cited references, embedded fonts, Type-3 font count, layout warnings.
3. **Fingerprint** — sha256 of every produced PDF into `qa.json`, keyed by paper directory.
4. **Report** — a paper passes only with fonts embedded, Type-3 = 0, undefined refs = 0, layout warnings = 0.

## Gate

Attach `qa.json` to the audit report; human review starts only from a mechanically-clean artifact.
