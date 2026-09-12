// paperlab/lib/skill/indexer.js — search across installed + local marketplace skills.
//
// Searches by name, description (from SKILL.md frontmatter), stage,
// risk_level. Returns matching records.

import fs from 'node:fs';
import path from 'node:path';
import { loadManifest } from './manifest.js';
import { BUILTIN_DIR, MARKET_DIR, listInstalled, loadRegistry } from './store.js';

export function listAllSkills() {
  const out = [];

  // Built-in skills (read-only copy in store).
  if (fs.existsSync(BUILTIN_DIR)) {
    walkSkills(BUILTIN_DIR, 'builtin', out);
  }

  // User-installed marketplace skills.
  if (fs.existsSync(MARKET_DIR)) {
    for (const author of fs.readdirSync(MARKET_DIR)) {
      const authorDir = path.join(MARKET_DIR, author);
      if (!fs.statSync(authorDir).isDirectory()) continue;
      for (const verDir of fs.readdirSync(authorDir)) {
        const full = path.join(authorDir, verDir);
        if (!fs.statSync(full).isDirectory()) continue;
        out.push(readSkillSummary(full, `${author}/${verDir}`));
      }
    }
  }

  return out;
}

function walkSkills(root, sourceTag, out) {
  // Layout: <root>/<stage>/<name>/SKILL.md + manifest.yaml
  for (const stage of fs.readdirSync(root)) {
    const stageDir = path.join(root, stage);
    if (!fs.statSync(stageDir).isDirectory()) continue;
    for (const name of fs.readdirSync(stageDir)) {
      const skillDir = path.join(stageDir, name);
      if (!fs.statSync(skillDir).isDirectory()) continue;
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      out.push(readSkillSummary(skillDir, `${sourceTag}/${stage}/${name}`));
    }
  }
}

function readSkillSummary(skillDir, ref) {
  let manifest = null;
  try { manifest = loadManifest(skillDir); } catch (e) { manifest = { _error: e.message }; }
  const skillMd = path.join(skillDir, 'SKILL.md');
  const body = fs.readFileSync(skillMd, 'utf8');
  const fm = parseFrontmatter(body);
  return {
    ref,
    path: skillDir,
    manifest,
    name: fm.name ?? manifest.name,
    description: fm.description,
    stage: manifest.stage ?? [fm.stage].filter(Boolean),
    risk_level: manifest.risk_level,
  };
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

export function search(query, { stage, riskLevel } = {}) {
  const q = (query || '').toLowerCase();
  return listAllSkills().filter(s => {
    if (stage && !(s.stage || []).includes(stage)) return false;
    if (riskLevel && s.risk_level !== riskLevel) return false;
    if (!q) return true;
    return [s.name, s.description, (s.stage || []).join(' '), s.risk_level]
      .filter(Boolean)
      .some(x => String(x).toLowerCase().includes(q));
  });
}

export function info(ref) {
  return listAllSkills().find(s => s.ref === ref || s.name === ref);
}
