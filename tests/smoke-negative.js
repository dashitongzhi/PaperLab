// paperlab/tests/smoke-negative.js
// Negative Test Suite — verifies that PaperLab's trust and state boundaries
// actually block illegal transitions, bypasses, soft-passes, and misclassifications.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  newWorkflow,
  startStage,
  completeStage,
  recordGate,
  rollbackStage,
  canAdvance,
  checkCanStartStage,
} from '../lib/orchestrator/state.js';
import { driveStageTool, rollbackStageTool } from '../lib/tools/orchestrator.js';
import { IntegrityChecker } from '../lib/integrity/checker.js';
import { parseAuditVerdict } from '../lib/tools/paper-audit.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
    return;
  }
  console.log('OK  :', msg);
}

async function testStateMachineBypasses() {
  console.log('--- 1. Negative Tests: State Machine Jumps & Bypasses ---');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlab-neg-'));
  const wf = newWorkflow(tmpDir);

  // Test 1.1: Direct jump to 'submit' on a fresh workflow must be blocked
  const checkSubmit = checkCanStartStage(wf, 'submit');
  assert(!checkSubmit.canStart, 'fresh workflow cannot start submit directly');
  assert(/prior stage 'topic' is not completed/i.test(checkSubmit.reason), 'reason cites topic not completed');

  let directSubmitThrew = false;
  try {
    startStage(wf, 'submit');
  } catch (e) {
    directSubmitThrew = true;
  }
  assert(directSubmitThrew, 'startStage(wf, "submit") threw error on fresh workflow');

  // Test 1.2: driveStageTool returns ok: false with blocking message
  const toolRes = driveStageTool.handler({ paperDir: tmpDir, stage: 'submit' });
  assert(toolRes.ok === false, 'driveStageTool returns ok: false for illegal submit jump');
  assert(toolRes.blocking && toolRes.blocking.length > 0, 'driveStageTool returns blocking reasons');

  // Test 1.3: Start topic -> complete topic without human gate approval
  startStage(wf, 'topic');
  completeStage(wf, 'topic completed');
  assert(wf.last_completed_stage === 'topic', 'topic completed recorded');

  // Can we start 'data' without topic gate approved?
  const checkDataWithoutGate = checkCanStartStage(wf, 'data');
  assert(!checkDataWithoutGate.canStart, 'cannot start data without topic gate approval');
  assert(/human gate for 'topic' is not approved/i.test(checkDataWithoutGate.reason), 'reason cites unapproved topic human gate');

  // Test 1.4: Now approve topic gate -> starting data must be permitted
  recordGate(wf, 'topic', 'approved', 'user');
  const checkDataWithGate = checkCanStartStage(wf, 'data');
  assert(checkDataWithGate.canStart, 'can start data after topic gate is approved');

  // Start and complete data
  startStage(wf, 'data');
  completeStage(wf, 'data acquired');

  // Test 1.5: Cannot jump from data completion directly to audit or submit
  const checkSkipToAudit = checkCanStartStage(wf, 'audit');
  assert(!checkSkipToAudit.canStart, 'cannot skip from data completion directly to audit');
  assert(/prior stage 'write' is not completed/i.test(checkSkipToAudit.reason), 'reason cites write not completed');

  // Start and complete write
  startStage(wf, 'write');
  completeStage(wf, 'draft written');

  // Start audit
  startStage(wf, 'audit');
  completeStage(wf, 'audit finished with findings');

  // Test 1.6: Cannot start submit without audit human gate approval
  const checkSubmitWithoutAuditGate = checkCanStartStage(wf, 'submit');
  assert(!checkSubmitWithoutAuditGate.canStart, 'cannot start submit without audit human gate approval');
  assert(/human gate for 'audit' is not approved/i.test(checkSubmitWithoutAuditGate.reason), 'reason cites unapproved audit gate');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function testRollbackMechanism() {
  console.log('\n--- 2. Negative & Positive Tests: Scientific Revision / Rollback ---');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlab-rollback-'));
  const wf = newWorkflow(tmpDir);

  // Drive through topic -> data -> write -> audit
  startStage(wf, 'topic');
  completeStage(wf, 'topic done');
  recordGate(wf, 'topic', 'approved', 'user');

  startStage(wf, 'data');
  completeStage(wf, 'data done');

  startStage(wf, 'write');
  completeStage(wf, 'write done');

  startStage(wf, 'audit');
  completeStage(wf, 'audit run');
  recordGate(wf, 'audit', 'needs_revision', 'peer-reviewer');

  // Test 2.1: Rollback to a future or invalid stage must throw
  let invalidRollbackThrew = false;
  try {
    rollbackStage(wf, 'submit', 'illegal forward rollback');
  } catch (e) {
    invalidRollbackThrew = true;
  }
  assert(invalidRollbackThrew, 'rolling back forward to submit is rejected');

  // Test 2.2: Rollback from audit back to write
  rollbackStage(wf, 'write', 'Audit identified missing baseline comparison');
  assert(wf.stage === 'write', 'active stage is now write');
  assert(wf.rounds.write.completed === false, 'write completed flag reset to false');
  assert(wf.rounds.audit.completed === false, 'audit completed flag reset to false');
  assert(wf.gates.audit.invalidated === true, 'audit gate marked invalidated');
  assert(wf.gates.audit.decision === 'needs_revision', 'audit gate marked needs_revision');

  // Test 2.3: Check rollbackStageTool
  const rbRes = rollbackStageTool.handler({
    paperDir: tmpDir,
    stage: 'data',
    reason: 'Need synthetic data rerun',
  });
  assert(rbRes.ok === true, 'rollbackStageTool succeeds on valid earlier stage');
  assert(rbRes.rolled_back_to === 'data', 'tool reports rolled back to data');

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function testFailClosedIntegrityChecker() {
  console.log('\n--- 3. Negative Tests: Fail-Closed Integrity Checker ---');
  const checker = new IntegrityChecker(); // Empty, uncompiled instance

  // Uncompiled schema must NOT soft-pass
  const res = checker.validate('claim-evidence-row', {
    claim_id: 'C001',
    claim_text: 'sample text',
  });
  assert(res.ok === false, 'uncompiled schema validation returns ok: false (no soft-pass)');
  assert(res.blocking === true, 'uncompiled schema returns blocking: true');
  assert(res.errors && res.errors.length > 0, 'uncompiled schema reports fail-closed error');

  // Transition check with un-PASS or mixed audit output
  const transCheck = checker.checkStageTransition('audit', 'submit', {
    auditReport: '- Verdict: **BLOCKED**\n- Finding: did not PASS\nprojects=1 blocked=1 passed=0',
    humanReviewGates: [{ stage: 'audit', decision: 'approved', reviewer: 'user' }],
  });
  assert(transCheck.ok === false, 'audit->submit transition blocked when audit report contains BLOCKED');
  assert(transCheck.blocking.some(b => /audit report is not PASS/i.test(b)), 'blocking message identifies audit failure');
}

async function testAuditVerdictParsing() {
  console.log('\n--- 4. Negative Tests: Structured Audit Verdict Parsing ---');

  // 4.1: Mixed output containing PASS word but blocked=1
  const mixedOutput = 'paper4_enrichment_consistency\tBLOCKED\tchecks/audit_report.md\nprojects=1 blocked=1 passed=0';
  assert(parseAuditVerdict(mixedOutput, 1) === 'BLOCKED', 'mixed output with exitCode 1 parsed as BLOCKED');

  // 4.2: Output saying "did not PASS" with exit code 1
  const trickyOutput = 'Finding: Table 1 did not PASS consistency check.\nprojects=1 blocked=1 passed=0';
  assert(parseAuditVerdict(trickyOutput, 1) === 'BLOCKED', '"did not PASS" parsed as BLOCKED');

  // 4.3: Real PASS output with exit code 0
  const passOutput = 'paper4_enrichment_consistency\tPASS\tchecks/audit_report.md\nprojects=1 blocked=0 passed=1';
  assert(parseAuditVerdict(passOutput, 0) === 'PASS', 'clean PASS output with exitCode 0 parsed as PASS');
}

async function main() {
  console.log('=== PaperLab Negative Test Suite ===\n');
  await testStateMachineBypasses();
  await testRollbackMechanism();
  await testFailClosedIntegrityChecker();
  await testAuditVerdictParsing();

  console.log('\n=== ' + (failed === 0 ? 'ALL NEGATIVE TESTS PASSED' : `FAILED ${failed}`) + ' ===');
  if (failed) process.exit(1);
}

main().catch(e => {
  console.error('TEST SUITE CRASHED:', e);
  process.exit(1);
});
