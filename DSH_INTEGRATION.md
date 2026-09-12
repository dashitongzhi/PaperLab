# PaperLab — dsh framework integration

PaperLab is a **bundle + plugin** that composes onto any DeepSeek
Harness profile. It uses dsh's public APIs only — no monkey-patching,
no source-level forks.

This document records exactly which dsh framework surfaces PaperLab hooks
into, with examples. Future maintainers (and reviewers) should be able
to grep one of these APIs and find the corresponding PaperLab code.

## 1. Bundle surface — `cordis.patch.yml`

PaperLab ships a bundle whose `cordis.patch.yml` is a top-level array of
Loader PatchOptions:

```yaml
- insert:
    - id: paperlab-plugin
      name: '@kral/paperlab-plugin'

- id: paperlab-skill-filesystem
  config:
    roots:
      - /Users/kral/project/papers/paperlab/skills

- id: paperlab-subagent-spawn
  name: '@deepseek-ai/dsh-subagent-spawn-in-process'
  config:
    providerName: paperlab-spawn
```

What this does:

1. `paperlab-plugin` — Cordis plugin entry that runs `@kral/paperlab-plugin`'s `apply()`.
2. `paperlab-skill-filesystem` — **override** of dsh-base's existing `paperlab-skill-filesystem` row to add PaperLab's `skills/` root. We do NOT insert a second `dsh-skill-filesystem` row (the bundle layer above already inserted one). Instead we override the `roots` config in place.
3. `paperlab-subagent-spawn` — new row registering a named subagent provider `paperlab-spawn`.

The bundle's own `package.json` declares:

```json
{
  "name": "paperlab-bundle",
  "dsh": { "name": "paperlab", "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": { "@kral/paperlab-plugin": "link:./plugin" }
}
```

## 2. Plugin surface — `@kral/paperlab-plugin/lib/index.js`

The plugin is a Cordis plugin (`{ name, inject, apply }`). Its `apply()`:

```js
async function apply(ctx, config) {
  // a) Register 19 model-facing tools via ctx.tools.register + defineTool
  for (const def of await loadAllToolDefs()) {
    ctx.tools.register(defineTool(wrapForDsh(def)));
  }
  for (const def of await loadOrchestratorDefs()) {
    ctx.tools.register(defineTool({ ...def, execute: handler }));
  }

  // b) Inject system-prompt sections
  ctx.systemPrompt.section({ name: 'paperlab-pipeline', order: 50, text: PIPELINE_PROMPT });
  ctx.systemPrompt.section({ name: 'paperlab-md',      order: 51, text: paperLabMd });

  // c) Register slash commands (silently no-op if dsh doesn't expose this API)
  if (ctx.systemPrompt.slashCommand) {
    for (const [name, description] of SLASH_COMMANDS) {
      ctx.systemPrompt.slashCommand({ name, description });
    }
  }

  // d) Skill sync: push installed marketplace skills into dsh catalog
  await registerSyncProvider(ctx);

  // e) Sub-agent routing metadata
  const { listPresets } = await import('./subagent-spawn.js');
  ctx.logger?.info?.(`paperlab sub-agents: ${listPresets().map(p => p.name).join(', ')}`);

  // f) Audit-fixup hook (Claude Code PostToolUse semantics)
  installAuditFixupHook(ctx);

  // g) Session banner (silently no-op if dsh doesn't expose this API)
  if (ctx.session?.banner) ctx.session.banner(() => renderBanner(ctx));
}
```

## 3. Tool registration — `ctx.tools.register`

All 19 paperlab tools register through the dsh-tools `defineTool` API.
The wrapper converts each `toolDefinition` (a plain JSON spec exported by
`paperlab/lib/tools/*.js`) into a dsh-compatible tool definition.

```js
import { defineTool } from '@deepseek-ai/dsh-tools';
ctx.tools.register(defineTool({
  name: 'paperlab_ledger_write',
  description: 'Add or update a row in the claim-evidence ledger.',
  parameters: { ledgerPath: { type: 'string', required: true }, row: {...} },
  output: { schema: {...}, render: (a, v) => [{type:'text',text:JSON.stringify(v)}] },
  execute: async (args, exec) => handler(args, { cwd: process.cwd(), signal: exec.signal }),
}));
```

`defineTool` is a thin DSL over JSON Schema (`type / required / enum / description`) plus a `~standard` validator. See `lib/plugins/skill-sync.js` for the orchestration pattern.

## 4. System-prompt sections — `ctx.systemPrompt.section`

PaperLab injects two sections:

| Section | Order | Content |
|---|---|---|
| `paperlab-pipeline` | 50 | 5-stage instructions + slash command list + tool catalogue |
| `paperlab-md` | 51 | Contents of paper root's `PAPERLAB.md` (research_question / target_venue / hard_constraints / methodology_choice / related_work) |

Both are loaded via `ctx.systemPrompt.section({ name, order, text })`. Order ensures PaperLab's instructions appear before the tool catalogue but after dsh-base's core sections.

## 5. Slash commands — `ctx.systemPrompt.slashCommand`

Six slash commands registered:

- `/paperlab-topic`, `/paperlab-data`, `/paperlab-write`, `/paperlab-audit`, `/paperlab-submit`, `/paperlab-status`, `/paperlab-explore`

Each is registered as `{ name, description }`. dsh maps these to UI affordances (TUI / web sidebar). If `ctx.systemPrompt.slashCommand` is not exposed by the dsh build, the call is silently swallowed (the plugin still works; slash commands just don't appear in the UI).

## 6. Skill provider — `ctx.skills.registerProvider`

PaperLab registers a **marketplace** provider whose root expands as users install skills:

```js
ctx.skills.registerProvider({
  name: 'paperlab-marketplace',
  list: async () => listAllSkills().map(s => ({ name: s.name, description: s.description, _path: s.path })),
  load: async (candidate) => ({ name: candidate.name, description: candidate.description, body: '...' }),
  invalidate: () => {},
});
```

A `fs.watch` on `~/.paperlab/marketplace/` calls `ctx.skills.invalidateCache()` whenever a new skill is installed, so the dsh catalog updates in real time.

The **filesystem** provider (separate dsh-base row) is overridden in-place:

```yaml
- id: paperlab-skill-filesystem
  config:
    roots:
      - /Users/kral/project/papers/paperlab/skills
```

This adds PaperLab's 5 built-in SKILL.md resources to dsh-base's existing filesystem provider without inserting a second provider (which would crash on `duplicateError`).

## 7. Sub-agent routing — `lib/plugins/subagent-spawn.js`

PaperLab declares 5 sub-agent presets (`topic-scout`, `data-forge`, `paper-writer`, `paper-auditor`, `submission-pilot`) and a stage→preset routing table:

```js
const ROUTING = {
  topic: 'topic-scout',
  data:  'data-forge',
  write: 'paper-writer',
  audit: 'paper-auditor',
  submit:'submission-pilot',
};
```

When the dsh subagent registry is available (`ctx.subagents.spawn`), the plugin spawns the appropriate preset. Otherwise it returns metadata for the parent agent to act on directly. The routing lives in `paperlab/lib/plugins/subagent-spawn.js`.

## 8. Audit-fixup hook — `installAuditFixupHook(ctx)`

After every `paperlab_paper_audit` invocation, PaperLab parses the audit report and attaches an actionable `suggestions[]` array to the tool result:

```js
ctx.tools.observe(async (toolName, args, result) => {
  if (toolName !== 'paperlab_paper_audit') return result;
  const md = readLatestAuditReport(args.batchPath);
  return { ...result, suggestions: mdToSuggestions(md) };
});
```

This is PaperLab's analog of Claude Code's `PostToolUse` hook — when an audit comes back BLOCKED, the agent sees the next-step tool calls inline.

## 9. Session banner — `ctx.session.banner`

On session boot, PaperLab renders a Claude Code-style working-directory header:

```js
ctx.session.banner(() => renderBanner(ctx));
```

The banner shows: paper dir, current workflow stage, slash commands, model. If `ctx.session.banner` is not exposed by the dsh build, the call is silently swallowed.

## 10. Tool catalogue — what gets registered

PaperLab registers **19 model-facing tools** via `ctx.tools.register`:

| Stage | Tool | Plugin wrapper |
|---|---|---|
| any | `paperlab-ledger-read` | shell out to `bin/paperlab.js ledger-read` |
| any | `paperlab-ledger-write` | shell out to `bin/paperlab.js ledger-write` |
| any | `paperlab-integrity-check` | shell out |
| any | `paperlab-paper-audit` | shell out to `paper_audit.py` |
| any | `paperlab-venue-match` | shell out |
| any | `paperlab-topic-search` | shell out (parses arXiv Atom XML) |
| any | `paperlab-dataset-manifest` | shell out (sha256 + manifest + traceability) |
| topic | `paperlab_drive_stage` | inline orchestrator JS |
| topic | `paperlab_complete_stage` | inline |
| topic | `paperlab_human_gate` | inline |
| audit | `paperlab_audit_run` | inline + parses suggestions[] |
| any | `paperlab_todo` | inline |
| any | `paperlab_session_status` | inline |
| any | `paperlab-citation-check` | inline (CrossRef + arXiv + PubMed 2-stage) |
| any | `paperlab-bib-manage` | inline (list/add/dedupe/format/gap_analysis) |
| any | `paperlab-overlap-check` | inline (Jaccard) |
| write | `paperlab-figure-audit` | inline (GPT-4o vision) |
| any | `paperlab-run-branch` | inline (BFTS) |
| audit | `paperlab-auto-review` | inline (LLM-as-judge) |

The 7 **shell-out** tools use `bin/paperlab.js` (the CLI exists independently of dsh, so users can drive PaperLab from any shell). The 12 **inline** tools call JS handlers directly.

## 11. What PaperLab does NOT use

PaperLab deliberately does **not** hook into:

- dsh-goal round driver — replaced by PaperLab's local 5-stage state machine in `lib/orchestrator/state.js`. Reason: dsh-goal is a thin state service without stage semantics; rebuilding the round loop on top of it would not add capability.
- dsh-agent-presets — replaced by PaperLab's `agent-presets/` directory (5 dsh-format presets). Reason: paperlab presets are specific to the paper-writing pipeline and would otherwise pollute dsh's shipped preset list.
- dsh-tools code-mode (TypeScript SDK generation) — PaperLab tools are simple JSON-schema; the SDK adds no value here.
- dsh-tools presentation cards — PaperLab tools return plain `{type: 'text', text: JSON.stringify(...)}` content. The 5 dsh presentation kinds (`generic / terminal / diff / search / read / web`) don't fit paperlab's tabular / JSON outputs.
- dsh-tools image input — PaperLab figures are file paths, not inline bytes.

## 12. Where to find the integration code

| Concern | File |
|---|---|
| Bundle manifest | `/Users/kral/project/papers/paperlab-bundle/cordis.patch.yml` |
| Plugin apply() | `/Users/kral/project/papers/paperlab-bundle/plugin/lib/index.js` |
| Tool definitions | `/Users/kral/project/papers/paperlab/lib/tools/*.js` |
| Orchestrator JS | `/Users/kral/project/papers/paperlab/lib/orchestrator/state.js` |
| Skill sync | `/Users/kral/project/papers/paperlab/lib/plugins/skill-sync.js` |
| Subagent routing | `/Users/kral/project/papers/paperlab/lib/plugins/subagent-spawn.js` |
| Audit hook | `/Users/kral/project/papers/paperlab/lib/plugins/hooks.js` |
| PAPERLAB.md loader | `/Users/kral/project/papers/paperlab/lib/plugins/paper-md.js` |
| PAPERMARK.md spec | `/Users/kral/project/papers/paperlab/PAPERLAB.md.protocol.md` |

## 13. Install on a fresh dsh profile

```sh
# 1. Drop the bundle into the profile's packages + list it in dsh.profile.bundles
mkdir -p ~/.dsh/profiles/<name>/node_modules/paperlab-bundle
cp -R /path/to/paperlab-bundle/* ~/.dsh/profiles/<name>/node_modules/paperlab-bundle/
ln -sf ../plugin ~/.dsh/profiles/<name>/node_modules/paperlab-bundle/node_modules/@kral/paperlab-plugin

# 2. Edit ~/.dsh/profiles/<name>/package.json
{
  "dsh": {
    "profile": { "bundles": ["@deepseek-ai/dsh-base", "paperlab-bundle"] }
  }
}

# 3. Run
dsh --profile <name> "drive the paperlab pipeline for /path/to/paper"
```

The bundle composes onto any dsh profile (headless / web / tui / agent-presets). All 19 tools + 6 slash commands + skill marketplace + subagent presets + audit hook become available without further wiring.
