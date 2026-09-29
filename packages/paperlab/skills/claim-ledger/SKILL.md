---
name: claim-ledger
description: PaperLab evidence contract — classify every claim (worked example, design proposal, planned protocol, literature, document correctness) and bind each class to allowed wording and explicitly unsupported wording. The ledger distinguishes completed artifacts from proposed science.
---

# Claim Ledger

The distinction between completed artifacts and proposed science.

## Claim classes (bind wording to class)

| Claim class | Evidence | Allowed wording | NOT supported |
|---|---|---|---|
| Worked example | the script + math definition that produced it | the exact computed result in the stated model | better performance, new algorithms |
| Design proposal | manuscript section + figure | proposed rules and prospective analysis | observed leakage, measured gaps |
| Planned protocol | protocol sections | planning choices to be frozen | collected samples, achieved power |
| Existing literature | SOURCES.md + refs.bib | bounded primary-source background | novelty certification, reproduced baselines |
| Document correctness | qa.json + visual checks | compiled readable PDF, resolved citations | peer review, venue acceptance |

## Workflow

1. **Class before write** — a sentence's class is decided before it is written; the class dictates wording.
2. **Ledger row per claim** — claim_id, class, evidence pointer, allowed wording, section.
3. **Review disposition** — record who reviewed what and what was amended; internal review is not external peer review.

## Gate

Audit fails any sentence whose wording exceeds its claim class.
