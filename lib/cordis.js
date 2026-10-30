// @paperlab/plugin — cordis apply adapter.
// Bridges the paperlab v0.6 tool definitions (module shape: { toolDefinition:
// { name, description, parameters, handler } }) onto the dsh-native tool
// surface ({ name, description, parameters, execute, output }), registers the
// 5 sub-agent presets as a system-prompt section, and exposes a small
// `paperlab` service (ledger / integrity / skills listing) for other plugins.

import { defineTool } from '@deepseek-ai/dsh-tools';
import { TOOLS } from './tools/index.js';
import { ClaimEvidenceLedger, IntegrityChecker } from './integrity/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const PAPERLAB_VERSION = '0.7.0';

/** List installed paper-writing skills (skills/<stage>/<name>/SKILL.md). */
export function listSkills() {
  const skillsDir = path.join(ROOT, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  const out = [];
  for (const stage of fs.readdirSync(skillsDir)) {
    const stageDir = path.join(skillsDir, stage);
    if (!fs.statSync(stageDir).isDirectory()) continue;
    for (const name of fs.readdirSync(stageDir)) {
      const skillFile = path.join(stageDir, name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        out.push({ stage, name, path: skillFile });
      }
    }
  }
  return out;
}

/** List sub-agent presets (lib/subagents/*.system.md). */
export function listSubagents() {
  const dir = path.join(ROOT, 'lib', 'subagents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.system.md'))
    .map((f) => f.replace(/\.system\.md$/, ''));
}

/**
 * Normalize a paperlab v0.6 parameter map onto the dsh-native spec:
 * every property must carry an explicit `additionalProperties: false` on the
 * object level, and `enum` arrays pass through untouched.
 */
function normalizeParams(params) {
  const out = {};
  for (const [key, prop] of Object.entries(params ?? {})) {
    const p = { ...prop };
    if (p.type === 'object' && p.additionalProperties === undefined) p.additionalProperties = false;
    out[key] = p;
  }
  return out;
}

/** Load a tool module and return its definition in a uniform shape. */
async function loadToolDefs() {
  const defs = [];
  for (const entry of TOOLS) {
    try {
      const mod = await import(new URL(entry.from, `file://${ROOT}/lib/tools/`).href);
      const def = mod.toolDefinition ?? mod[entry.tool] ?? mod.default;
      if (def && def.name && (def.handler || def.execute)) defs.push(def);
      else if (entry.tool && mod[entry.tool]) defs.push(mod[entry.tool]);
    } catch (error) {
      console.warn(`[paperlab] failed to load tool ${entry.name}:`, String(error).slice(0, 120));
    }
  }
  return defs;
}

const PIPELINE_PROMPT = `## PaperLab pipeline
When the user wants to write a paper, drive the canonical 5-stage pipeline:
topic → data → write → audit → submit.
- Start with paperlab-session-status, then paperlab-drive-stage --stage <s>.
- Stages cannot be skipped; human gates at topic/audit/submit require
  paperlab-human-gate with an explicit decision before advancing.
- Every deterministic claim must land in the claim-evidence ledger
  (paperlab-ledger-write) with an evidence artifact pointer.
- Verify every citation with paperlab-citation-check before it enters refs.bib.
- After audit, use paperlab-rollback-stage to revise when findings block.`;

/** Cordis plugin — name + apply. */
export const name = 'paperlab-plugin';

/** Cordis service injections required by apply(). */
export const inject = ['tools', 'systemPrompt', 'webServer'];

export async function apply(ctx) {
  // a) Register paper-writing tools on the dsh-native surface.
  const defs = await loadToolDefs();
  let registered = 0;
  for (const def of defs) {
    try {
      ctx.tools.register(defineTool({
        name: def.name,
        description: def.description,
        parameters: normalizeParams(def.parameters),
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, output) => [{
            type: 'text',
            text: JSON.stringify(output, null, 2).slice(0, 8000),
          }],
        },
        execute: async (args, ctx2) => def.handler(args, ctx2),
      }));
      registered += 1;
    } catch (error) {
      console.warn(`[paperlab] failed to register ${def.name}:`, String(error).slice(0, 120));
    }
  }

  // b) System prompt: pipeline contract + sub-agent roster.
  const roster = listSubagents();
  const prompt = [PIPELINE_PROMPT,
    roster.length ? `Specialist sub-agents (via paperlab-spawn): ${roster.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
  ctx.systemPrompt?.section?.({
    name: 'paperlab-pipeline',
    order: 50,
    text: prompt,
  });

  // c) Shared service: ledger / integrity / skills for other plugins (UI panel API).
  try {
  ctx.provide('paperlab', {
    version: PAPERLAB_VERSION,
    listSkills,
    listSubagents,
    registeredTools: registered,
    openLedger: (p) => new ClaimEvidenceLedger(p),
    createIntegrityChecker: () => IntegrityChecker.create(),
  });
  } catch (error) {
    ctx.logger?.warn?.(`[paperlab] service provide skipped: ${String(error).slice(0, 100)}`);
  }
  // d) Host HTTP API for the Web UI panels (sidebar skills + pipeline).
  try {
    const workflowState = (paperDir) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(paperDir, 'evidence', 'workflow-state.json'), 'utf8'));
      } catch {
        return null;
      }
    };
    const STAGES = ['topic', 'data', 'write', 'audit', 'submit'];
    const pipelineOf = (paperDir) => {
      const wf = workflowState(paperDir);
      const done = new Set(wf?.completed_stages ?? []);
      const active = wf?.stage ?? null;
      return STAGES.map((id) => ({
        id,
        status: done.has(id) ? 'done' : active === id ? 'active' : 'pending',
      }));
    };
    ctx.webServer.register({
      kind: 'prefix',
      path: '/api/paperlab/',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/api/paperlab/skills', 'http://localhost');
        const send = (code, body) => {
          res.writeHead(code, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (url.pathname === '/api/paperlab/skills') {
          const skills = listSkills().map((k) => ({
            name: k.name,
            stage: k.stage,
            riskLevel: 'low',
            source: 'paperlab-core',
          }));
          const stages = pipelineOf(url.searchParams.get('paper') ?? '');
          send(200, { skills, stages, version: PAPERLAB_VERSION, tools: registered });
          return;
        }
        send(404, { error: 'not found' });
      },
    });
    ctx.logger?.info?.('[paperlab] host API at /api/paperlab/skills');
  } catch (error) {
    ctx.logger?.warn?.(`[paperlab] host API unavailable: ${String(error).slice(0, 120)}`);
  }

  if (ctx.logger?.info) ctx.logger.info(`[paperlab] ${registered} tools registered, ${listSkills().length} skills, ${roster.length} sub-agents`);
}

// Legacy default export — cordis unwrapExports() takes exports.default, so
// the full plugin surface (name / inject / apply) must live here.
export default {
  name,
  inject,
  apply,
  version: PAPERLAB_VERSION,
  listSkills,
  listSubagents,
};
