# PaperLab v1 Schemas

Six JSON Schemas define PaperLab's integrity-artifact contract. Every claim, citation, experiment, and human gate must validate against one of these before the next stage can start.

| File | Artifact | Used by |
|---|---|---|
| `literature-provenance.json` | Where did the lit come from? | TopicScout → write |
| `citation-verification.json` | Is the DOI/arXiv real? | PaperAuditor |
| `workflow-state.json` | What config produced this run? | dsh session log |
| `experiment-traceability.json` | What ran, with what inputs/outputs? | DataForge → PaperAuditor |
| `human-review-gates.json` | Who approved which stage? | All human gates |
| `claim-evidence-row.json` | One claim ↔ one evidence artifact | PaperWriter ledger |

The `claim-evidence-row` schema enforces the rule: **a `supported` claim MUST have a `pointer` to its artifact** (table / figure / code_output / literature / human_review / external_url). This is the machine-checkable version of "draft/gap cannot be written as a confirmed conclusion."
