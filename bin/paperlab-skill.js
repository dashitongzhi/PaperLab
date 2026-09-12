#!/usr/bin/env node
// paperlab/bin/paperlab-skill.js — paperlab skill marketplace CLI.
//
// Usage:
//   paperlab skill list                 # list installed
//   paperlab skill search [query]       # search across installed + marketplace
//   paperlab skill info <ref>           # show one skill
//   paperlab skill install <ref>        # install author/name@version
//   paperlab skill install --from <dir> # install from local path
//   paperlab skill uninstall <ref>      # remove
//   paperlab skill publish --dir <dir>  # validate + tar a local skill for sharing

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const libSkill = path.join(ROOT, 'lib', 'skill');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub || sub === '--help') {
    console.log(`paperlab-skill — PaperLab skill marketplace CLI

commands:
  list                              list installed skills
  search [query] [--stage S] [--risk low|medium|high]
  info <ref>                        show one skill (by ref or name)
  view <ref>                        fetch SKILL.md + manifest.yaml from a
                                   github: ref or local path WITHOUT installing
  install <ref>                     install author/name@version
                                   also accepts: github:owner/repo[@ref]
                                                    https://github.com/owner/repo[@ref]
                                                    /local/path
    --from <dir>                    install from a local directory (offline)
    --version <v>                   pin version (overrides ref @version)
  uninstall <ref>                   remove an installed skill
  publish --dir <path>              validate manifest + print tarball path

env:
  PAPERLAB_HOME       override skill store (default ~/.paperlab)
  PAPERLAB_REGISTRY_URL override registry repo (default github:K-Dense-AI/paper-skills-registry)
`);
    process.exit(sub ? 0 : 1);
  }

  if (sub === 'list') {
    const { listInstalled } = await import(path.join(libSkill, 'store.js'));
    const reg = listInstalled();
    if (reg.length === 0) {
      console.log('(no skills installed)');
      return;
    }
    for (const s of reg) {
      console.log(`${s.id}\tstage=${(s.stage || []).join(',')}\trisk=${s.risk_level}`);
    }
    return;
  }

  if (sub === 'search') {
    const { search } = await import(path.join(libSkill, 'indexer.js'));
    const stage = arg('stage');
    const riskLevel = arg('risk');
    const results = search(rest[0] || '', { stage, riskLevel });
    if (results.length === 0) {
      console.log('(no skills matched)');
      return;
    }
    for (const s of results) {
      console.log(`${s.ref}\t${s.name}\tstage=${(s.stage || []).join(',')}\trisk=${s.risk_level}`);
      if (s.description) console.log(`    ${s.description.slice(0, 120)}${s.description.length > 120 ? '…' : ''}`);
    }
    return;
  }

  if (sub === 'info') {
    const { info } = await import(path.join(libSkill, 'indexer.js'));
    const ref = rest[0];
    if (!ref) throw new Error('usage: paperlab skill info <ref>');
    const s = info(ref);
    if (!s) { console.error(`not found: ${ref}`); process.exit(2); }
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  if (sub === 'view') {
    const { viewRef } = await import(path.join(libSkill, 'viewer.js'));
    const ref = rest[0];
    if (!ref) throw new Error('usage: paperlab skill view <github:owner/repo | https://... | /local/path>');
    const v = await viewRef(ref);
    console.log('--- source ---');
    console.log(v.source);
    if (v.url) console.log('url:', v.url);
    console.log('--- manifest.yaml ---');
    console.log(v.manifestYaml || '(none)');
    console.log('--- SKILL.md ---');
    console.log(v.skillMd || '(none)');
    return;
  }

  if (sub === 'install') {
    const { installSkill } = await import(path.join(libSkill, 'installer.js'));
    const ref = rest[0];
    if (!ref) throw new Error('usage: paperlab skill install <author>/<name>@<version>');
    const entry = installSkill(ref, { from: arg('from') });
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  if (sub === 'uninstall') {
    const { uninstallSkill } = await import(path.join(libSkill, 'installer.js'));
    const ref = rest[0];
    if (!ref) throw new Error('usage: paperlab skill uninstall <ref>');
    const removed = uninstallSkill(ref);
    console.log(JSON.stringify(removed, null, 2));
    return;
  }

  if (sub === 'publish') {
    const dir = arg('dir');
    if (!dir) throw new Error('usage: paperlab skill publish --dir <path>');
    const { loadManifest } = await import(path.join(libSkill, 'manifest.js'));
    const m = loadManifest(dir);
    const tarName = `${m.name}-${m.version}.tar.gz`;
    console.log('manifest OK:', JSON.stringify(m, null, 2));
    console.log('To publish:');
    console.log(`  1. cd ${dir}`);
    console.log(`  2. git tag v${m.version}`);
    console.log(`  3. git push --tags`);
    console.log(`  4. Register the URL in ${process.env.PAPERLAB_REGISTRY_URL || 'github:K-Dense-AI/paper-skills-registry'}/registry.yaml`);
    console.log(`Tarball target: ${tarName}`);
    return;
  }

  console.error(`unknown sub-command: ${sub}`);
  process.exit(2);
}

main().catch(e => {
  console.error('paperlab-skill:', e.message);
  if (process.env.PAPERLAB_DEBUG) console.error(e.stack);
  process.exit(1);
});
