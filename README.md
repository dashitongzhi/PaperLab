# PaperLab

Terminal-native paper-writing agent for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

## What this is

PaperLab turns the static `paper-factory-kit` (5-stage pipeline + 6 integrity-artifact schema) into an interactive agent that lives in your terminal. You say "I want to write a paper about X", and PaperLab drives TopicScout → DataForge → PaperWriter → PaperAuditor → SubmissionPilot, with you in the loop at the three human gates (topic / audit / submit).

## Install (local development)

```sh
cd /Users/kral/project/papers/paperlab
pnpm install                    # (or npm install)

# Smoke-test: confirm PaperLab composes into dsh without errors
pnpm run smoke

# Run headless (one task, then exit)
pnpm run headless -- "write a paper about X targeting MethodsX"

# Run web UI
pnpm run web
```

## Layout

```
paperlab/
├── package.json                # @kral/paperlab — dsh plugin
├── dsh.plugin.yml              # the patch layer dsh --patch consumes
├── cordis.patch.yml            # production bundle patch (dsh.profile.bundles)
├── lib/
│   ├── skills/                 # dsh-skill runtime skill registrations
│   ├── tools/                  # 7 tool modules (each exports toolDefinition)
│   │   ├── orchestrator.js     # +6 orchestration tools
│   │   ├── paper-audit.js
│   │   ├── ledger-read.js
│   │   ├── ledger-write.js
│   │   ├── integrity-check.js
│   │   ├── venue-match.js
│   │   ├── topic-search.js
│   │   └── dataset-manifest.js
│   ├── orchestrator/           # 5-stage state machine + canAdvance
│   ├── plugins/                # subagent-spawn + skill-sync
│   ├── skill/                  # marketplace: store + indexer + installer + viewer
│   ├── subagents/              # 5 stage drivers + their system prompts
│   └── integrity/              # ledger + 6-artifact schema checker
├── schemas/v1/                 # 6 JSON Schemas (integrity artifacts)
├── skills/                     # Pi/Agent-Skills-compatible SKILL.md resources
│   ├── topic/arxiv-search/
│   ├── data/dataset-manifest/
│   ├── write/latex-compile/
│   ├── audit/citation-check/
│   ├── submit/venue-templates/
│   └── _examples/enrichment-consistency/  # template skill for `paperlab skill publish`
├── agent-presets/              # 5 dsh agent presets
├── examples/
│   ├── run-paper4.sh           # 5-stage demo (drives all paperlab tools + paper_audit.py)
│   └── fixtures/arxiv-sample.xml
└── tests/
    ├── smoke.js                # 35 assertions
    ├── smoke-plugin.js         # 35 assertions
    └── smoke-skill.js          # 30 assertions
```

## Stages

| # | Stage | Sub-agent | Inputs | Outputs | Human gate |
|---|---|---|---|---|---|
| 1 | topic | TopicScout | user intent, interests | `topics.csv` row | **YES** — confirm topic |
| 2 | data | DataForge | topic row, sources | `evidence/datasets/<id>/` + manifest | data sources |
| 3 | write | PaperWriter | topic + data + skills | `drafts/<paper_id>/` 5 sub-stages | review key sections |
| 4 | audit | PaperAuditor | draft | `checks/audit_report.md` | **YES** — confirm PASS |
| 5 | submit | SubmissionPilot | manuscript + venue | `submission/<venue>/` | **YES** — approve submission |

## 6 integrity artifacts

Every stage writes into one or more of:

1. `literature-provenance` — search terms, databases, dates, inclusion/exclusion
2. `citation-verification` — DOI/arXiv matches, status flags
3. `workflow-state` — prompt, tool config, run metadata
4. `experiment-traceability` — inputs, code, params, env, checksum, manifest
5. `human-review-gates` — which steps need review, by whom, decision log
6. `claim-evidence-row` — ClaimEvidenceLedger row (claim ↔ evidence artifact ↔ section ↔ status)

Schemas live in `schemas/v1/*.json`. The `paperlab-integrity-check` tool validates ledger rows + artifacts before the next stage can start.

## Companion runtime

This plugin runs on **DeepSeek Harness** (`dsh` >= 0.1.0-rc.7). It also installs cleanly into any runtime that consumes the [Anthropic Agent Skills standard](https://github.com/anthropics/skills) — `~/.pi/agent/skills/` for Pi, or the `K-Dense-AI/claude-scientific-skills` paper subdirectory.

## Status

**v0.4 — end-to-end demo + skill marketplace ✅**

What works end to end:

1. **Topic** — `paperlab topic-search` parses arXiv Atom XML into
   structured hits (title, authors, abstract, arxiv_id, DOI).
2. **Data** — `paperlab dataset-manifest` computes sha256, writes
   `manifest.json` + `traceability.json` (validated against
   `schemas/v1/experiment-traceability.json`), and can append a
   `claim-evidence-row` to the ledger in one call.
3. **Write** — `paperlab ledger-write` validates each row against
   `schemas/v1/claim-evidence-row.json` before saving. CSV round-trips
   with full RFC 4180 quote handling.
4. **Audit** — `paperlab paper-audit` shells out to paper-factory-kit's
   `paper_audit.py`. End-to-end demo (`bash examples/run-paper4.sh`)
   produces **verdict: PASS, 0 blocking findings**.
5. **Submit** — `paperlab venue-match` returns the template path for
   MethodsX/JOSS/SoftwareX/Software Impacts/PeerJ CS/arXiv.

**v0.5 — Claude Code-style orchestration ✅**

13 model-facing tools registered on the dsh agent:

| Stage | Tool | Purpose |
|---|---|---|
| session start | `paperlab_session_status` | read workflow + ledger + audit verdict |
| | `paperlab_todo` | write the paper-writing todo list |
| topic | `paperlab_drive_stage --stage topic` | start topic stage |
| | `paperlab_topic_search` | parse arXiv Atom XML into hits |
| | `paperlab_human_gate --stage topic --decision approved` | stop for human approval |
| data | `paperlab_drive_stage --stage data` | start data stage |
| | `paperlab_dataset_manifest` | sha256 + manifest + traceability |
| write | `paperlab_drive_stage --stage write` | start write stage |
| | `paperlab_ledger_read` / `paperlab_ledger_write` | append claims to the ledger |
| | `paperlab_integrity_check` | validate a claim-evidence-row |
| audit | `paperlab_drive_stage --stage audit` | start audit stage |
| | `paperlab_paper_audit` | shell out to paper_audit.py |
| | `paperlab_audit_run` | paper_audit.py + structured actionable suggestions |
| | `paperlab_human_gate --stage audit` | stop for human approval |
| submit | `paperlab_drive_stage --stage submit` | start submit stage |
| | `paperlab_venue_match` | find the venue template |
| | `paperlab_complete_stage` | close the active stage |
| | `paperlab_human_gate --stage submit` | stop for human approval |

Claude Code-style UX:
- Session banner at boot shows paper dir, current stage, slash commands.
- Slash commands registered: `/paperlab-topic`, `/paperlab-data`,
  `/paperlab-write`, `/paperlab-audit`, `/paperlab-submit`, `/paperlab-status`.
- 5-stage state machine enforces: stages cannot be skipped; human gates
  at topic/audit/submit must record `decision="approved"` before advancing.
- Skill marketplace syncs into dsh catalog via `lib/plugins/skill-sync.js`.
- 5 sub-agent presets route via `lib/plugins/subagent-spawn.js`.
- `paperlab-skill` CLI: `list / search / info / view / install / uninstall / publish`
- **GitHub URL support**: `paperlab skill install github:owner/repo@v0.1.0`
  or `paperlab skill install https://github.com/owner/repo/tree/main/skills/foo`
  — clones the repo via git, checks out the ref, symlinks into
  `~/.paperlab/marketplace/<owner>/<name>@<version>/`. Subpath
  extraction handles `/tree/main/skills/foo`.
- **`paperlab skill view <ref>`**: fetches SKILL.md + manifest.yaml
  from GitHub via raw.githubusercontent.com WITHOUT installing or cloning.
  Use to preview before installing.
- Skills are also installed from the central registry at
  `/Users/kral/project/papers/paper-skills-registry/registry.yaml`.
- Install protocol: clone URL → checkout tag → validate
  `manifest.yaml` + `SKILL.md` → symlink into
  `~/.paperlab/marketplace/<author>/<name>@<version>/`.
- Manifest schema: `name / version / stage[] / risk_level /
  inputs_schema / outputs_schema / depends_on / tests[] / entry_point`.
- Compatible with Anthropic Agent Skills standard (`SKILL.md` frontmatter).

```sh
# Internal smoke (35 assertions, no dsh needed):
node tests/smoke.js

# v0.3 plugin smoke (35 assertions, imports installed plugin module):
node tests/smoke-plugin.js

# v0.6 paper-specific smoke (22 assertions):
node tests/smoke-v6.js

# End-to-end demo on real paper4 — drives all 5 stages:
bash examples/run-paper4.sh
# → verdict: PASS, 0 blocking findings

# Skill marketplace:
node bin/paperlab-skill.js search GSEA
node bin/paperlab-skill.js info enrichment-consistency
node bin/paperlab-skill.js view github:kral/foo@v0.1.0          # preview from GitHub without installing
node bin/paperlab-skill.js install github:kral/foo@v0.1.0        # install from GitHub URL
node bin/paperlab-skill.js install kral/foo@0.1.0                # install from registry
node bin/paperlab-skill.js install --from ./my-skill              # local install
node bin/paperlab-skill.js uninstall kral/foo@0.1.0
node bin/paperlab-skill.js publish --dir ./my-skill
```

**Layout**

```
paperlab/
├── bin/
│   ├── paperlab.js          # 7 model-facing tool commands
│   └── paperlab-skill.js    # marketplace CLI (list/search/info/install/uninstall/publish)
├── lib/
│   ├── integrity/           # ClaimEvidenceLedger + IntegrityChecker
│   ├── tools/               # 7 tool modules (also importable directly)
│   ├── skill/               # manifest schema + store + installer + indexer
│   └── subagents/           # 5 system prompt files for the 5 stages
├── schemas/v1/              # 6 JSON Schemas (integrity artifacts)
├── skills/                  # 5 built-in SKILL.md + 1 example skill (enrichment-consistency)
├── agent-presets/           # 5 dsh agent presets (topic-scout / data-forge / paper-writer / paper-auditor / submission-pilot)
├── examples/
│   ├── run-paper4.sh        # 5-stage demo (drives all paperlab tools + paper_audit.py)
│   ├── paper4_enrichment_consistency/   # populated by run-paper4.sh
│   └── fixtures/arxiv-sample.xml
├── cordis.patch.yml         # production bundle manifest
├── dsh.plugin.yml           # dev --patch overlay
└── tests/
    ├── smoke.js             # 35 assertions
    ├── smoke-plugin.js      # 35 assertions
    └── smoke-skill.js       # 23 assertions
```

**Install path: how to drop paperlab into a fresh dsh profile**

1. Symlink the plugin into dsh's lib/node_modules:
   ```sh
   mkdir -p /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin/node_modules/@deepseek-ai
   ln -sf /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools \
          /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin/node_modules/@deepseek-ai/dsh-tools
   cp -R lib /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin/
   ```
2. Add to your profile (`~/.dsh/profiles/<name>/dsh.profile`):
   ```yaml
   bundles:
     - '@deepseek-ai/dsh-base'
     - '@deepseek-ai/dsh-headless'   # or web-app / tui
     - paperlab
   ```
   Or use the `dsh.plugin.yml` overlay directly via `dsh --patch`.

3. **For tui/web profile** — also install the plugin as a profile dependency:
   ```sh
   dsh plugin --profile tui add @kral/paperlab-plugin
   # or, if you cloned the paperlab repo to a non-standard path:
   dsh plugin --profile tui add /Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin
   ```

**Known limits**
- 6 paperlab tools wrap the Node CLI — they show up in the agent's tool
  catalog as native function calls (not bash invocations).
- LLM-side quota (CLIProxyAPI upstream) may rate-limit paper-writing runs
  on some plans. The plugin itself is rate-limit free.
- Skill marketplace v0.4 is git-based; we do not sign skills or run
  marketplace tests automatically. Add a `tests/` dir to your skill and
  reference it from `manifest.yaml.tests` to opt in.
