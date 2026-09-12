// paperlab/tests/smoke-skill.js — v0.4 marketplace CLI smoke.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; return; }
  console.log('OK  :', msg);
}

function runCli(args, opts = {}) {
  try {
    const env = { ...process.env, PAPERLAB_HOME: opts.home || process.env.PAPERLAB_HOME };
    const out = execSync(`node ${ROOT}/bin/paperlab-skill.js ${args}`, {
      encoding: 'utf8',
      env,
    });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || e.message };
  }
}

async function main() {
  console.log('=== PaperLab v0.4 marketplace CLI smoke ===\n');

  // 1. help
  const help = runCli('--help');
  assert(help.ok, '--help runs');
  assert(/commands:/.test(help.out), 'help text lists commands');

  // 2. publish — validate the bundled example skill
  const publish = runCli('publish --dir /Users/kral/project/papers/paperlab/skills/_examples/enrichment-consistency');
  assert(publish.ok, 'publish validates the example skill');
  assert(/manifest OK/.test(publish.out), 'manifest OK in publish output');
  assert(/"name":\s*"enrichment-consistency"/.test(publish.out), 'publish shows skill name');

  // 3. list — fresh home is empty
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlab-skill-'));
  const list1 = runCli('list', { home: tmpHome });
  assert(list1.ok, 'list on empty home runs');
  assert(/\(no skills installed\)/.test(list1.out), 'empty list says so');

  // 4. install from local path
  const install = runCli('install kral/enrichment-consistency@0.1.0 --from /Users/kral/project/papers/paperlab/skills/_examples/enrichment-consistency', { home: tmpHome });
  assert(install.ok, 'install from local path runs');
  assert(/name.*enrichment-consistency/.test(install.out), 'install output shows skill name');

  // 5. list after install — should show 1
  const list2 = runCli('list', { home: tmpHome });
  assert(list2.ok, 'list after install runs');
  assert(/enrichment-consistency@0\.1\.0/.test(list2.out), 'installed skill shows in list');

  // 6. search across installed
  const search = runCli('search enrichment', { home: tmpHome });
  assert(search.ok, 'search runs');
  assert(/enrichment-consistency/.test(search.out), 'search finds the installed skill');

  // 7. info
  const info = runCli('info enrichment-consistency', { home: tmpHome });
  assert(info.ok, 'info runs');
  assert(/enrichment-consistency/.test(info.out), 'info returns the skill');
  assert(/risk_level.*medium/.test(info.out), 'info shows risk_level');

  // 8. files actually on disk
  const installDir = path.join(tmpHome, 'marketplace', 'local', 'enrichment-consistency');
  assert(fs.existsSync(installDir), `install dir exists at ${installDir}`);
  assert(fs.existsSync(path.join(installDir, 'SKILL.md')), 'installed SKILL.md exists');
  assert(fs.existsSync(path.join(installDir, 'manifest.yaml')), 'installed manifest.yaml exists');
  assert(fs.existsSync(path.join(installDir, 'scripts/run.py')), 'installed entry-point script exists');

  // 9. uninstall — accept either author/path prefix
  const uninstall = runCli('uninstall local/enrichment-consistency@0.1.0', { home: tmpHome });
  assert(uninstall.ok, 'uninstall runs');
  const list3 = runCli('list', { home: tmpHome });
  assert(/\(no skills installed\)/.test(list3.out), 'after uninstall, list is empty');

  // 10. install with bad path fails
  const bad = runCli('install kral/missing@0.1.0 --from /nonexistent/dir', { home: tmpHome });
  assert(!bad.ok, 'install with bad path fails');

  // 11. registry.yaml parses
  const regYaml = fs.readFileSync('/Users/kral/project/papers/paper-skills-registry/registry.yaml', 'utf8');
  assert(/kral\/enrichment-consistency:/.test(regYaml), 'registry.yaml has kral/enrichment-consistency entry');
  assert(/kral\/latex-bibliography-audit:/.test(regYaml), 'registry.yaml has 2nd example entry');

  // 12. resolveRef parses GitHub URLs into a structured form
  const { resolveRef } = await import('file:///Users/kral/project/papers/paperlab/lib/skill/installer.js');
  const gh1 = resolveRef('github:kral/foo@v0.1.0');
  assert(gh1.kind === 'github' && gh1.owner === 'kral' && gh1.repo === 'foo' && gh1.ref === 'v0.1.0',
    'github:owner/repo@v parses correctly');

  const gh2 = resolveRef('https://github.com/kral/foo/tree/main/skills/foo');
  assert(gh2.kind === 'github' && gh2.ref === 'main' && gh2.subpath === 'skills/foo',
    'github.com/.../tree/ref/subpath parses correctly');

  const gh3 = resolveRef('https://github.com/kral/foo');
  assert(gh3.kind === 'github' && gh3.ref === null && gh3.subpath === null,
    'plain github.com URL parses with no ref');

  const local = resolveRef('/tmp/some/path');
  assert(local.kind === 'local' && local.path === '/tmp/some/path', 'absolute path parsed as local');

  const reg = resolveRef('kral/foo@0.1.0');
  assert(reg.kind === 'registry' && reg.author === 'kral' && reg.name === 'foo' && reg.version === '0.1.0',
    'author/name@version parsed as registry');

  // 13. view local skill (does not require network)
  const view = runCli('view /Users/kral/project/papers/paperlab/skills/_examples/enrichment-consistency');
  assert(view.ok, 'view local skill runs');
  assert(/enrichment-consistency/.test(view.out), 'view shows skill name');
  assert(/risk_level:\s*medium/.test(view.out), 'view shows manifest content');

  // 14. CLI rejects an unparseable ref
  const badRef = runCli('install "not a valid ref"');
  assert(!badRef.ok, 'install rejects unparseable ref');

  console.log('\n=== ' + (failed === 0 ? 'ALL OK' : `FAILED ${failed}`) + ' ===');
  if (failed) process.exit(1);
}

main().catch(e => { console.error('SMOKE FAILED:', e.message); console.error(e.stack); process.exit(1); });
