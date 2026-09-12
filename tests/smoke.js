// paperlab/tests/smoke.js — v0.2 smoke test.
//
// Validates:
//   1. 5 SKILL.md resources are present (Pi / Agent-Skills-compatible)
//   2. 5 sub-agent system prompts are present
//   3. 6 JSON Schemas compile (Ajv, draft-07)
//   4. ClaimEvidenceLedger round-trips a row through CSV
//   5. IntegrityChecker validates good rows + rejects bad rows
//   6. Stage-transition rules work (write→audit, audit→submit, human gates)
//   7. paperlab CLI runs every subcommand
//   8. All 5 agent presets have preset.yml + agent.cordis.yml
//   9. cordis.patch.yml + dsh.plugin.yml parse as valid dsh patch format

import { listSkills, listSubagents, ClaimEvidenceLedger, IntegrityChecker } from '../lib/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; return; }
  console.log('OK  :', msg);
}

async function main() {
  console.log('=== PaperLab v0.2 smoke ===\n');

  // 1. skills
  const skills = listSkills();
  // The _examples subdirectory is for documentation/templates, not catalog skills.
  const catalogSkills = skills.filter(s => !s.path.includes('/_examples/'));
  assert(catalogSkills.length === 5, `5 catalog skills bundled (got ${catalogSkills.length}; ${skills.length} total including _examples)`);
  for (const want of ['topic/arxiv-search','data/dataset-manifest','write/latex-compile','audit/citation-check','submit/venue-templates']) {
    assert(skills.find(s => `${s.stage}/${s.name}` === want), `skill ${want} present`);
  }

  // 2. subagents
  const subs = listSubagents();
  assert(subs.length === 5, `5 sub-agents (got ${subs.length})`);

  // 3. schemas
  const checker = await IntegrityChecker.create();
  for (const t of ['literature-provenance','citation-verification','workflow-state',
                   'experiment-traceability','human-review-gates','claim-evidence-row']) {
    assert(checker.compiled[t], `schema ${t} compiled`);
  }

  // 4. ledger round-trip
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlab-smoke-'));
  const ledgerPath = path.join(tmpDir, 'ledger.csv');
  let ledger = new ClaimEvidenceLedger(ledgerPath);
  ledger.add({
    claim_id: 'C001', section: 'results',
    claim_text: 'smoke test claim long enough to pass minLength validation rule',
    evidence_status: 'supported',
    evidence_artifact_type: 'code_output',
    evidence_artifact_pointer: 'examples/paper4_enrichment_consistency/outputs/x.csv',
    reviewer: 'smoke',
  });
  ledger.save();
  ledger = new ClaimEvidenceLedger(ledgerPath);
  assert(ledger.supported().length === 1, '1 supported row in reloaded ledger');

  // 5. integrity-check positive + negative
  const v = checker.validate('claim-evidence-row', {
    claim_id: 'C001', section: 'results',
    claim_text: 'smoke test claim long enough to pass minLength validation rule',
    evidence_status: 'supported',
    evidence_artifact: { type: 'code_output', pointer: 'examples/paper4_enrichment_consistency/outputs/x.csv' },
  });
  assert(v.ok, 'valid supported row passes schema');

  const v2 = checker.validate('claim-evidence-row', {
    claim_id: 'C002', section: 'results',
    claim_text: 'bad row missing pointer',
    evidence_status: 'supported',
  });
  assert(!v2.ok, 'supported row without pointer rejected');

  // 6. stage transitions
  const t = checker.checkStageTransition('write', 'audit', {
    ledger, humanReviewGates: [], requireAllPriorGates: true,
  });
  assert(!t.ok, 'write→audit blocks without prior topic gate');

  const t2 = checker.checkStageTransition('write', 'audit', {
    ledger,
    humanReviewGates: [{ stage: 'topic', decision: 'approved', reviewer: 'user', decided_at: new Date().toISOString() }],
    requireAllPriorGates: true,
  });
  assert(t2.ok, 'write→audit passes with topic gate approved + supported row');

  const t3 = checker.checkStageTransition('audit', 'submit', {
    ledger,
    humanReviewGates: [{ stage: 'audit', decision: 'approved', reviewer: 'user', decided_at: new Date().toISOString() }],
    auditReport: 'verdict: PASS',
  });
  assert(t3.ok, 'audit→submit passes with PASS report');

  // 7. CLI smoke — each subcommand
  console.log('\n--- CLI smoke ---');
  const cli = path.join(ROOT, 'bin', 'paperlab.js');
  function runCli(args) {
    try {
      const out = execSync(`node ${cli} ${args}`, { encoding: 'utf8' }).trim();
      return { ok: true, out };
    } catch (e) {
      return { ok: false, out: e.stdout || e.message };
    }
  }
  for (const sub of ['venue-match --venue MethodsX',
                     'venue-match --venue joss',
                     'venue-match --venue arxiv',
                     'venue-match --venue unknownvenue123',
                     'topic-search --source arxiv --query "GSEA"',
                     `ledger-write --ledger ${ledgerPath} --row '{"claim_id":"C002","section":"intro","claim_text":"second smoke claim is also long enough","evidence_status":"draft","reviewer":"smoke"}'`,
                     `ledger-read --ledger ${ledgerPath}`,
                     `integrity-check --mode '{"single":{"type":"claim-evidence-row","data":{"claim_id":"C999","section":"intro","claim_text":"valid supported row","evidence_status":"supported","evidence_artifact":{"type":"code_output","pointer":"x"}}}}'`,
                     `integrity-check --mode '{"stage":{"fromStage":"write","toStage":"audit","ctx":{}}}'`,
                    ]) {
    const r = runCli(sub);
    assert(r.ok, `CLI: paperlab ${sub.split(' ')[0]} runs`);
  }

  // 8. agent presets
  console.log('\n--- agent presets ---');
  const presetsDir = path.join(ROOT, 'agent-presets');
  for (const want of ['topic-scout','data-forge','paper-writer','paper-auditor','submission-pilot']) {
    const d = path.join(presetsDir, want);
    assert(fs.existsSync(path.join(d, 'preset.yml')), `preset ${want}/preset.yml exists`);
    assert(fs.existsSync(path.join(d, 'agent.cordis.yml')), `preset ${want}/agent.cordis.yml exists`);
  }

  // 9. cordis patch + dsh plugin files
  console.log('\n--- dsh bundle files ---');
  assert(fs.existsSync(path.join(ROOT, 'cordis.patch.yml')), 'cordis.patch.yml exists (bundle)');
  assert(fs.existsSync(path.join(ROOT, 'dsh.plugin.yml')), 'dsh.plugin.yml exists (dev overlay)');
  const patch = fs.readFileSync(path.join(ROOT, 'dsh.plugin.yml'), 'utf8');
  assert(/^\s*-\s+insert:/m.test(patch) || /^\s*-\s+id:\s*paperlab-plugin/m.test(patch), 'dsh.plugin.yml starts with `- insert:` or `- id: paperlab-plugin` (correct dsh patch format)');
  assert(/paperlab-skill-filesystem/.test(patch), 'dsh.plugin.yml registers paperlab-skill-filesystem');
  assert(/paperlab-plugin/.test(patch), 'dsh.plugin.yml registers paperlab-plugin (v0.3)');

  console.log('\n=== ' + (failed === 0 ? 'ALL OK' : `FAILED ${failed}`) + ' ===');
  if (failed) process.exit(1);
}

main().catch(e => {
  console.error('SMOKE FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
