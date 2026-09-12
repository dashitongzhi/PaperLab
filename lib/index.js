// paperlab/lib/index.js
// Plugin entrypoint. dsh loads this when --patch ./dsh.plugin.yml is in effect.
//
// Responsibilities:
//   - register PaperLab's 6 tools (ledger / integrity / audit / venue / topic)
//   - register the 5 sub-agents (topic-scout, data-forge, paper-writer, paper-auditor, submission-pilot)
//   - register the 5 SKILL.md resources from skills/
//   - expose IntegrityChecker + ClaimEvidenceLedger as a shared service
//
// In dsh 0.1.0-rc.7 the plugin surface is via `ctx.skills.registerProvider(...)`,
// `ctx.tools.register(...)`, `ctx.agents.register(...)`. This module returns
// a single object dsh can iterate to wire everything up.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './tools/index.js';
import { ClaimEvidenceLedger, IntegrityChecker } from './integrity/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const PAPERLAB_VERSION = '0.1.0';

export function listSkills() {
  // Walk skills/<stage>/<name>/SKILL.md
  const skillsDir = path.join(ROOT, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  const out = [];
  for (const stage of fs.readdirSync(skillsDir)) {
    const stageDir = path.join(skillsDir, stage);
    if (!fs.statSync(stageDir).isDirectory()) continue;
    for (const name of fs.readdirSync(stageDir)) {
      const skillFile = path.join(stageDir, name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        out.push({
          stage,
          name,
          path: skillFile,
          resourceBase: path.dirname(skillFile),
        });
      }
    }
  }
  return out;
}

export function listSubagents() {
  const dir = path.join(ROOT, 'lib', 'subagents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.system.md'))
    .map(f => f.replace(/\.system\.md$/, ''));
}

export async function createIntegrityChecker() {
  return IntegrityChecker.create();
}

export {
  ClaimEvidenceLedger,
  IntegrityChecker,
  TOOLS,
};

// Default export — what dsh imports
export default {
  name: 'paperlab',
  version: PAPERLAB_VERSION,
  listSkills,
  listSubagents,
  tools: TOOLS.map(t => t.name),
  createIntegrityChecker,
};
