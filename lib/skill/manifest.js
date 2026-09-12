// paperlab/lib/skill/manifest.js — skill manifest schema + validator.
//
// A paperlab skill is a directory containing:
//   SKILL.md          (Agent Skills compatible — frontmatter + body)
//   manifest.yaml     (paperlab-specific — risk_level + IO schema)
//   <stage>/          (entry-point scripts)
//
// manifest.yaml shape:
//   name: <string>
//   version: <semver>
//   stage: [topic, data, write, audit, submit]
//   risk_level: low | medium | high
//   inputs_schema:   { <arg>: { type, required, enum?, default? }, ... }
//   outputs_schema:  { <arg>: { type, description }, ... }
//   depends_on:
//     dsh_tools: [tool-bash, tool-web, ...]
//     python:   ">=3.11"
//     packages: [gseapy>=1.1, ...]
//   tests:
//     - tests/test_smoke.py
//   entry_point: scripts/run.py

import fs from 'node:fs';
import path from 'node:path';

export const STAGES = ['topic', 'data', 'write', 'audit', 'submit'];
export const RISK_LEVELS = ['low', 'medium', 'high'];

export function loadManifest(skillDir) {
  const p = path.join(skillDir, 'manifest.yaml');
  if (!fs.existsSync(p)) {
    throw new Error(`manifest.yaml not found in ${skillDir}`);
  }
  // Tiny YAML reader — handles the flat manifest shape we use. For richer
  // YAML we fall back to a regex parser; no js-yaml dep needed for v1.
  const text = fs.readFileSync(p, 'utf8');
  const manifest = parseSimpleYaml(text);
  validateManifest(manifest, skillDir);
  return manifest;
}

export function validateManifest(m, dir) {
  const errs = [];
  if (!m.name || typeof m.name !== 'string') errs.push('name required (string)');
  if (!m.version || typeof m.version !== 'string') errs.push('version required (semver string)');
  if (!Array.isArray(m.stage) || m.stage.length === 0) errs.push('stage required (non-empty array)');
  else if (!m.stage.every(s => STAGES.includes(s))) errs.push(`stage values must be one of ${STAGES.join(',')}`);
  if (!RISK_LEVELS.includes(m.risk_level)) errs.push(`risk_level must be one of ${RISK_LEVELS.join(',')}`);
  if (m.tests && !Array.isArray(m.tests)) errs.push('tests must be array');
  if (m.entry_point && typeof m.entry_point !== 'string') errs.push('entry_point must be string');
  if (!m.entry_point) errs.push('entry_point required');
  const skillMd = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) errs.push(`SKILL.md required at ${skillMd}`);
  if (errs.length) throw new Error(`manifest invalid in ${dir}:\n  - ${errs.join('\n  - ')}`);
  return true;
}

// Minimal YAML reader for the flat manifest.yaml shape:
//   key: value
//   nested:
//     subkey: value
//     list:
//       - item1
//       - item2
export function parseSimpleYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (let raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.slice(indent);
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const top = stack[stack.length - 1];

    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];

    if (val === '' || val === undefined) {
      // nested object or list follows
      const next = lines[lines.indexOf(raw) + 1] || '';
      const nextIndent = next.match(/^ */)?.[0].length ?? 0;
      if (nextIndent > indent && next.trim().startsWith('- ')) {
        // list
        const arr = [];
        for (const l2 of lines.slice(lines.indexOf(raw) + 1)) {
          if (!l2.trim()) continue;
          const ind2 = l2.match(/^ */)[0].length;
          if (ind2 <= indent) break;
          const lm = l2.slice(ind2).match(/^- (.*)$/);
          if (lm) arr.push(coerce(lm[1]));
        }
        top.obj[key] = arr;
      } else {
        // nested object
        const sub = {};
        top.obj[key] = sub;
        stack.push({ indent, obj: sub });
      }
    } else if (val.startsWith('[') && val.endsWith(']')) {
      // inline array
      top.obj[key] = val.slice(1, -1).split(',').map(s => coerce(s.trim()));
    } else {
      top.obj[key] = coerce(val);
    }
  }
  return root;
}

function coerce(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  // strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
