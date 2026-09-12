# PaperLab

<p align="center">
  <img src="assets/logo.png" alt="PaperLab logo" width="180" />
</p>

> **A paper-writing agent that takes your idea to a referee-ready manuscript — with the receipts.**

PaperLab is a terminal-native agent for writing scientific papers.
Every claim you write is paired with an evidence artifact. Every citation is
verified against DOI/arXiv/PubMed before it enters the manuscript. Every
stage has a human gate so you stay in control. Every audit failure comes
with the exact next tool call to fix it.

It runs as a plugin on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) — drop into any dsh profile and the 19 paper-writing tools appear in
the agent's catalog. The same tools are also exposed as a standalone CLI
(`paperlab <command>`) so you can script the workflow outside an agent.

---

## What makes it a *paper* agent

Generic agents give you tools. PaperLab gives you **contracts**:

| Concern | What PaperLab enforces |
|---|---|
| **Citation hallucination** (Sakana AI Scientist v2: 50.9% wrong) | `paperlab_citation_check` resolves every `\cite{}` against CrossRef + arXiv + PubMed via 2-stage fallback before it enters `refs.bib`. |
| **Train/test leakage** (Sakana: 57% had it) | `paperlab_overlap_check` Jaccard-tests every dataset pair against a configurable threshold (default 5%). |
| **"Conclusions Here" placeholders** (Sakana: 57% shipped placeholders) | `paperlab_figure_audit` runs every figure through GPT-4o and refuses to advance if labels or legends are missing. |
| **Self-contradictory claims** | The `claim-evidence-ledger` is RFC 4180 CSV with a JSON Schema. Every row must carry `evidence_status` ∈ `{supported, draft, gap}` and a non-empty `evidence_artifact_pointer` to point at the artefact that supports it. A `draft` claim cannot be promoted to a confirmed conclusion. |
| **Experiments fail silently** | `paperlab_dataset_manifest` computes sha256 + writes `manifest.json` + `traceability.json` (validated against `experiment-traceability.json`) so every dataset is reproducible. |
| **Audit is decoration** | `paperlab_paper_audit` runs `paper_audit.py` (the same engine from `paper-factory-kit`). The `paperlab_audit_run` wrapper then **parses every BLOCKED finding into a structured `suggestions[]` of next tool calls** — so when the agent sees BLOCKED it knows exactly what to do next. |
| **Picking the wrong idea** | The 5-stage state machine (`topic → data → write → audit → submit`) cannot be skipped. **Human gates at topic/audit/submit block advance** until you record `decision="approved"`. |
| **One-size-fits-all workflow** | A real **skill marketplace** lets you install any skill straight from GitHub: `paperlab skill install github:owner/repo@ref`. |

### The 6 integrity artifacts

Every paper run writes **6 categories** of structured artefacts, each
validated against a JSON Schema in `schemas/v1/`:

1. `literature-provenance` — search terms, databases, dates, inclusion/exclusion.
2. `citation-verification` — DOI/arXiv/PubMed match status, reviewer, verified date.
3. `workflow-state` — prompt, tool config, run id, model, timestamps.
4. `experiment-traceability` — inputs (sha256), code commit, params, env, output manifest.
5. `human-review-gates` — who decided what, when, and on what conditions.
6. `claim-evidence-row` — one per paper claim: `{claim_id, claim_text, evidence_status, evidence_artifact}`.

These six are the spine of the audit. Sakana AI Scientist v2 and
OpenAI Codex / Claude Code have **none of this** — PaperLab's
`claim-evidence-ledger` is the structural differentiator.

---

## Skill marketplace — install paper-writing skills from anywhere

PaperLab ships with a **git-based skill marketplace** that auto-installs
skills from any GitHub URL. Drop a SKILL.md + a `manifest.yaml` in any
public repo and your skill becomes installable.

```sh
# Install a skill from a GitHub URL (no clone-then-publish dance)
paperlab skill install github:appautomaton/latex-arxiv-SKILL@v1.0.0
paperlab skill install https://github.com/somebody/biorxiv-toolkit/tree/main/skills/biorxiv-fetch

# Or from the central registry
paperlab skill install kral/enrichment-consistency@0.1.0

# Local development
paperlab skill install --from ./my-skill

# Search / list / preview
paperlab skill search "GSEA"
paperlab skill info enrichment-consistency
paperlab skill view github:kral/foo@v0.1.0     # preview SKILL.md without installing

# Publish your own
paperlab skill publish --dir ./my-skill       # validates manifest + tells you how to push
```

The marketplace has a real **manifest schema** (risk_level + IO schema
+ depends_on + entry_point) that other generic Agent-Skills marketplaces
don't enforce. See `lib/skill/manifest.js`.

---

## 19 paper-writing tools

### Core (7)

| Tool | What it does |
|---|---|
| `paperlab-ledger-read` / `paperlab-ledger-write` | The claim-evidence ledger. Every claim lands here with evidence. |
| `paperlab-integrity-check` | Validates a row against `schemas/v1/claim-evidence-row.json` before save. |
| `paperlab-paper-audit` | Shells out to `paper_audit.py` — structural + evidence hygiene. |
| `paperlab-venue-match` | MethodsX / JOSS / SoftwareX / arXiv — returns the venue template. |
| `paperlab-topic-search` | Parses arXiv Atom XML into structured hits (title / authors / abstract / DOI). |
| `paperlab-dataset-manifest` | sha256 + `manifest.json` + `traceability.json` per dataset. |

### Orchestration (6)

| Tool | What it does |
|---|---|
| `paperlab_session_status` | Read the current workflow + ledger + audit state. Call this first. |
| `paperlab_todo` | Write the paper-writing todo list. |
| `paperlab_drive_stage --stage <topic\|data\|write\|audit\|submit>` | Advance the state machine. Cannot skip stages. |
| `paperlab_complete_stage` | Close the active stage, attach artefact pointers. |
| `paperlab_human_gate --stage <s> --decision <approved\|rejected\|needs_revision\|deferred>` | Record the human decision at topic/audit/submit gates. |
| `paperlab_audit_run` | Run paper_audit.py + parse the BLOCKED findings into structured `suggestions[]` of next tool calls. |

### Paper-specific v0.6 (6)

| Tool | What it does |
|---|---|
| `paperlab_citation_check` | DOI/arXiv/PubMed 2-stage resolution. Writes `citation-verification` artefact. |
| `paperlab_bib_manage` | list / add / dedupe / format / **gap_analysis** on `refs/refs.bib`. |
| `paperlab_overlap_check` | Jaccard row-hash between two dataset files; refuses if >5%. |
| `paperlab_figure_audit` | GPT-4o vision: missing labels / illegible legends / placeholder text. |
| `paperlab_run_branch` | Spawn a sub-experiment branch with BFTS-style novelty + pass-rate scoring. |
| `paperlab_auto_review` | LLM-as-judge score against venue's review form (MethodsX / arXiv / JOSS). |

---

## End-to-end demo

```sh
cd paperlab
npm install
npm run demo         # bash examples/run-paper4.sh — drives paper4 through all 5 stages
# → verdict: PASS, 0 blocking findings
```

Or run the agent live in dsh:

```sh
npm run tui         # terminal REPL with banner + slash commands
npm run web         # browser UI at http://127.0.0.1:3080
```

Open `paper4_enrichment_consistency/PAPERLAB.md` (auto-loaded into the
agent's system prompt) to see how project memory works.

---

## Install in any dsh profile

```sh
# 1. Install plugin into dsh's package tree
mkdir -p /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin/node_modules/@deepseek-ai
ln -sf /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@deepseek-ai/dsh-tools \
       /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin/node_modules/@deepseek-ai/dsh-tools
cp -R lib /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin/

# 2. Add to your dsh profile (or use the overlay via `dsh --patch`)
echo 'bundles: ["@deepseek-ai/dsh-base", "paperlab"]' >> ~/.dsh/profiles/<your>/dsh.profile

# 3. Run
dsh --profile <your> "drive the paperlab pipeline for /path/to/paper"
```

---

## Five human gates, not zero

```
$ paperlab workflow status
  paper dir : /Users/kral/project/papers/drafts/paper4_enrichment_consistency
  stage     : audit
  workflow  : /Users/kral/project/papers/paperlab
  model     : gpt-5.6-sol

  [topic]   approved by kral  (2026-09-10)
  [data]    completed         (2 datasets, 1 manifest)
  [write]   completed         (3 claims in ledger, 1 supported)
  [audit]   ACTIVE — verdict BLOCKED → fix suggestions[] then re-run
  [submit]  not started

  call: paperlab_human_gate --stage audit --decision approved
```

You always see what stage you're in, who approved the last gate, and
exactly which tool call will advance you.

---

## 122-assertion smoke suite

```
$ npm run smoke          → 35 assertions  ALL OK
$ npm run smoke:plugin   → 35 assertions  ALL OK  (plugin apply → 19 tools registered)
$ npm run smoke:skill    → 30 assertions  ALL OK  (install/uninstall/GitHub URL)
$ npm run smoke:v6       → 22 assertions  ALL OK  (citation-check / bib-manage / overlap / branch / figure-audit / auto-review)
$ npm run demo           → verdict: PASS, 0 blocking findings
```

---

## File layout

```
paperlab/
├── bin/
│   ├── paperlab.js          # 14 paperlab CLI commands
│   └── paperlab-skill.js    # marketplace CLI (list/search/info/view/install/uninstall/publish)
├── lib/
│   ├── integrity/           # ClaimEvidenceLedger + IntegrityChecker (6-artifact schema validator)
│   ├── tools/               # 13 tool modules (also importable directly)
│   ├── orchestrator/        # 5-stage state machine + canAdvance
│   ├── plugins/             # subagent-spawn + skill-sync + paper-md loader + audit-fixup hook
│   ├── skill/               # manifest schema + store + installer + indexer + viewer
│   └── subagents/           # 5 system prompts (topic-scout, data-forge, paper-writer, paper-auditor, submission-pilot)
├── schemas/v1/              # 6 JSON Schemas (integrity artifacts)
├── skills/                  # 5 built-in SKILL.md + 1 example skill (enrichment-consistency)
├── agent-presets/           # 5 dsh agent presets
├── examples/
│   ├── run-paper4.sh        # 5-stage demo
│   └── fixtures/arxiv-sample.xml
├── cordis.patch.yml         # dsh bundle manifest (paperlab-plugin + skill-fs + subagent-spawn)
├── dsh.plugin.yml           # dev --patch overlay
├── PAPERLAB.md.protocol.md  # spec for the PAPERLAB.md project-memory convention
├── DSH_INTEGRATION.md       # which dsh framework APIs PaperLab hooks into
└── tests/                   # 4 smoke suites, 122 assertions total
```

---

## Roadmap

- [ ] Peer-review response letter generator (round-2 reply skill)
- [ ] Signed skills + marketplace auto-test runner
- [ ] Multi-paper project support (one workflow, N papers)
- [ ] Wire `paperlab_citation_check` into `paper_audit.py` so `\cite{}` keys
      without `citation-verification` rows BLOCK

---

## License

MIT. See `LICENSE`.

## Acknowledgements

The 5-stage pipeline + 6-artifact schema derive from the earlier
`paper-factory-kit` work in `/Users/kral/project/papers/codex-archive/`.
The skill marketplace format extends the [Anthropic Agent Skills
standard](https://github.com/anthropics/skills) with an explicit
manifest schema (`risk_level`, `inputs_schema`, `outputs_schema`,
`depends_on`, `entry_point`) — the standard lacks these.
