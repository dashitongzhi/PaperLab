# PAPERLAB.md — PaperLab project memory protocol

## Purpose

`PAPERLAB.md` is a plain-Markdown file placed at the **root of a paper
directory** that records the author's research plan, target venue, hard
constraints, methodology choice, and related work. The PaperLab plugin
auto-loads it at session start and injects it into the dsh agent's
system prompt as a `paperlab-md` section, so the agent treats it as
authoritative for the duration of the paper-writing run.

This is the PaperLab analog of Codex's `AGENTS.md` and Claude Code's
`CLAUDE.md`, scoped to the paper-writing domain.

## Location

Place `PAPERLAB.md` at the root of the paper directory, e.g.

```
/Users/kral/project/papers/drafts/paper4_enrichment_consistency/
├── PAPERLAB.md                       ← here
├── project.json
├── drafts/
├── evidence/
├── manuscript/
├── checks/
└── ...
```

## Schema

`PAPERLAB.md` is plain Markdown. The plugin recognises **section
headings** with these exact spellings (case-insensitive, kebab-or-space
separated) — anything else is left in the prompt as free-form context:

```markdown
# optional top-level title

## research_question
How concordant are ORA and preranked GSEA results from gseapy/enrichr,
gseapy/prerank, and g:Profiler on the same simulated DE inputs?

## target_venue
methodsx                       # kebab-case preferred

## hard_constraints
- Every claim must land in claim_evidence_ledger.csv with status=supported.
- Synthetic dataset only — no human / patient data.
- Figures must have captions + axis labels + legible legend.

## related_work
- Subramanian et al. 2005 — GSEA seminal paper.
- Kuleshov et al. 2016 — Enrichr.

## methodology_choice
- Use gseapy_ora + gseapy_prerank + g:Profiler.
- Concordance metric: Jaccard on top-10 pathways.

## additional_notes
Anything else you want the agent to know.
```

## How the plugin loads it

`lib/plugins/paper-md.js` reads the file (capped at 4 KB), wraps it in a
named system-prompt section (`paperlab-md`, order 51), and registers it
on `ctx.systemPrompt.section()`. If `PAPERLAB.md` is missing, no section
is added — the plugin stays silent.

```js
import { paperLabMdAsPromptSection } from '@kral/paperlab-plugin/paper-md';
const section = paperLabMdAsPromptSection('/path/to/paper');
if (section) ctx.systemPrompt.section({ name: 'paperlab-md', order: 51, text: section });
```

## Environment override

If you keep `PAPERLAB.md` somewhere other than the paper root, set:

```sh
export PAPERLAB_PAPER_DIR=/path/to/paper/root
```

…and the plugin will read `$PAPERLAB_PAPER_DIR/PAPERLAB.md`.

## Citation keys

`PAPERLAB.md` is a **memory file**, not a citation source. Citations
live in `refs/refs.bib` and are verified by
`paperlab_citation_check`. Do not mix the two.

## Versioning

- v1 — `research_question` / `target_venue` / `hard_constraints` /
  `related_work` / `methodology_choice` / `additional_notes`.

## Failure modes

- `PAPERLAB.md` is missing → silent; agent still works, just without
  project memory.
- File is > 4 KB → truncated with a note.
- Headings have non-standard spelling → free-form text in section.
- Multiple PAPERLAB.md files in nested dirs → only the one in
  `$PAPERLAB_PAPER_DIR` is read; no merging across nested memory.
