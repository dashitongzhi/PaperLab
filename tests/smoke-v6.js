// paperlab/tests/smoke-v6.js — v0.6 smoke for the 7 new paper-specific tools.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BIN = `node ${ROOT}/bin/paperlab.js`;

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; return; }
  console.log('OK  :', msg);
}

function runCli(args, opts = {}) {
  try {
    return { ok: true, out: execSync(`${BIN} ${args}`, { encoding: 'utf8', timeout: 15_000 }).trim() };
  } catch (e) {
    return { ok: false, out: e.stdout || '', err: e.stderr || e.message };
  }
}

async function main() {
  console.log('=== PaperLab v0.6 paper-specific smoke ===\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlab-v6-'));
  fs.mkdirSync(path.join(tmp, 'refs'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'manuscript'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'refs/refs.bib'), '');
  fs.writeFileSync(path.join(tmp, 'manuscript/main.tex'),
    '\\documentclass{article}\n\\begin{document}\nCiting \\cite{known1} and \\cite{missing1}.\n\\end{document}\n');
  // A tiny dataset for overlap-check.
  fs.writeFileSync(path.join(tmp, 'train.tsv'),
    'col1,col2\nrow1,a\nrow2,b\nrow3,c\nrow4,d\nrow5,e\nrow6,f\nrow7,g\nrow8,h\nrow9,i\nrow10,j\n');
  fs.writeFileSync(path.join(tmp, 'test.tsv'),
    'col1,col2\nrow1,a\nrow2,b\nrow3,c\nrow4,d\nrow6,f\nrow7,g\nrow8,h\nrow11,k\nrow12,l\nrow13,m\n');

  // 1. bib-manage list / gap_analysis
  const list = runCli(`bib-manage --paperDir ${tmp} --action list`);
  assert(list.ok && /"entries": \[\]/.test(list.out), 'bib-manage list on empty bib');
  const gap = runCli(`bib-manage --paperDir ${tmp} --action gap_analysis`);
  assert(gap.ok && /"missing": \[/.test(gap.out) && /known1/.test(gap.out),
    'bib-manage gap_analysis finds missing keys');

  // 2. overlap-check (high overlap)
  const ovHigh = runCli(`overlap-check --pathA ${tmp}/train.tsv --pathB ${tmp}/test.tsv --threshold 0.05`);
  assert(ovHigh.ok && /"refuses": true/.test(ovHigh.out),
    'overlap-check refuses >5% overlap');

  // 3. overlap-check (low overlap) — use disjoint file
  const ovLow = runCli(`overlap-check --pathA ${tmp}/train.tsv --pathB ${tmp}/refs/refs.bib --threshold 0.05`);
  assert(ovLow.ok && /"refuses": false/.test(ovLow.out),
    'overlap-check accepts low overlap');

  // 4. citation-check returns "cannot_locate" for unknown citation (no network required)
  const cite1 = runCli(`citation-check --citationKey notreal2024 --title "no such paper" --paperDir ${tmp}`);
  assert(cite1.ok && /"status": "cannot_locate"/.test(cite1.out),
    'citation-check returns cannot_locate for unknown paper');
  assert(/"status"/.test(cite1.out) && /"doi": null|"doi":\s*"/.test(cite1.out),
    'citation-check returns citation-verification-shaped JSON');

  // 5. run-branch creates branch_tree.json
  fs.mkdirSync(path.join(tmp, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'runme.sh'), '#!/bin/bash\necho branch ran\n');
  fs.chmodSync(path.join(tmp, 'runme.sh'), 0o755);
  const br1 = runCli(`run-branch --paperDir ${tmp} --hypothesis "first arm" --runCommand "echo ran-arm-1" --novelty 0.7`);
  assert(br1.ok, 'run-branch returns ok');
  assert(/"branch_id"/.test(br1.out), 'run-branch returns a branch_id');
  assert(/"score": 0\.7/.test(br1.out), 'run-branch returns score=0.7 for novelty=0.7 with pass');
  assert(fs.existsSync(path.join(tmp, 'evidence', 'branch_tree.json')),
    'run-branch writes evidence/branch_tree.json');

  // 6. figure-audit (no API key set) returns a soft-fail or ok-false
  fs.writeFileSync(path.join(tmp, 'fig.png'), Buffer.from('89504E470D0A1A0A', 'hex'));
  const fig = runCli(`figure-audit --figurePath ${tmp}/fig.png --paperDir ${tmp}`);
  // We don't require success — we require the CLI runs and returns JSON.
  assert(/\{[\s\S]*\}/.test(fig.out), 'figure-audit returns JSON');

  // 7. auto-review (no API key) returns JSON
  fs.mkdirSync(path.join(tmp, 'checks'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'checks/audit_report.md'),
    '# Audit\n- Verdict: **PASS**\n');
  const rev = runCli(`auto-review --paperDir ${tmp} --venue methodsx`);
  assert(/\{[\s\S]*\}/.test(rev.out), 'auto-review returns JSON');

  // 8. CLI help lists all 14 commands
  const help = runCli('--help');
  const expected = [
    'ledger-read', 'ledger-write', 'integrity-check', 'paper-audit',
    'venue-match', 'topic-search', 'dataset-manifest',
    'citation-check', 'bib-manage', 'overlap-check',
    'figure-audit', 'run-branch', 'auto-review',
  ];
  for (const c of expected) {
    assert(new RegExp(`^\\s+${c}\\b`, 'm').test(help.out), `CLI help lists ${c}`);
  }

  console.log('\n=== ' + (failed === 0 ? 'ALL OK' : `FAILED ${failed}`) + ' ===');
  if (failed) process.exit(1);
}

main().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
