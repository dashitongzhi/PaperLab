// paperlab/lib/skill/store.js — local skill store layout and operations.
//
// ~/.paperlab/
//   skills/                          # built-in (read-only from repo)
//   marketplace/                     # user-installed (writable)
//     <author>/<name>@<version>/
//   registry.json                    # local index of installed skills
//   cache/                           # git clone cache

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOME = process.env.PAPERLAB_HOME
  || path.join(os.homedir(), '.paperlab');

export const BUILTIN_DIR  = path.join(HOME, 'skills');
export const MARKET_DIR   = path.join(HOME, 'marketplace');
export const REGISTRY     = path.join(HOME, 'registry.json');
export const CACHE_DIR     = path.join(HOME, 'cache');

export function ensureDirs() {
  for (const d of [HOME, BUILTIN_DIR, MARKET_DIR, CACHE_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function loadRegistry() {
  ensureDirs();
  if (!fs.existsSync(REGISTRY)) {
    fs.writeFileSync(REGISTRY, JSON.stringify({ skills: [] }, null, 2));
    return { skills: [] };
  }
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

export function saveRegistry(reg) {
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
}

export function listInstalled() {
  const reg = loadRegistry();
  return reg.skills;
}

// Add or update an installed skill entry.
export function recordInstall({ author, name, version, source, installPath, manifest }) {
  const reg = loadRegistry();
  const id = `${author}/${name}@${version}`;
  const idx = reg.skills.findIndex(s => s.id === id);
  const entry = {
    id, author, name, version, source,
    installPath,
    stage: manifest.stage,
    risk_level: manifest.risk_level,
    installed_at: new Date().toISOString(),
  };
  if (idx >= 0) reg.skills[idx] = entry;
  else reg.skills.push(entry);
  saveRegistry(reg);
  return entry;
}

export function removeInstalled(id) {
  const reg = loadRegistry();
  const idx = reg.skills.findIndex(s => s.id === id);
  if (idx < 0) return null;
  const removed = reg.skills.splice(idx, 1)[0];
  saveRegistry(reg);
  return removed;
}
