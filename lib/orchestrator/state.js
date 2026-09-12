// paperlab/lib/orchestrator/state.js
// Workflow state machine for the 5-stage paper-writing pipeline.
//
// This is the "what stage are we in?" source of truth. dsh-goal could
// host the same state machine; for v0.4 we keep it local so it survives
// dsh restarts and works in headless / CLI mode without booting dsh.

import fs from 'node:fs';
import path from 'node:path';

export const STAGES = ['topic', 'data', 'write', 'audit', 'submit'];
export const HUMAN_GATE_STAGES = new Set(['topic', 'audit', 'submit']);

export function newWorkflow(paperDir) {
  return {
    schema_version: 1,
    paper_dir: paperDir,
    stage: null,           // null | 'topic' | 'data' | 'write' | 'audit' | 'submit'
    stage_index: -1,
    rounds: {},           // { topic: { attempted, completed, last_error, ... }, ... }
    gates: {},            // { topic: { decision, reviewer, decided_at, conditions, notes } }
    history: [],          // chronological events
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function loadWorkflow(paperDir) {
  const p = path.join(paperDir, 'evidence', 'workflow-state.json');
  if (!fs.existsSync(p)) return newWorkflow(paperDir);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveWorkflow(wf) {
  wf.updated_at = new Date().toISOString();
  const p = path.join(wf.paper_dir, 'evidence', 'workflow-state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(wf, null, 2));
}

export function startStage(wf, stage) {
  if (!STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  if (wf.stage && wf.stage !== stage) {
    throw new Error(`workflow already in stage ${wf.stage}; cannot start ${stage}`);
  }
  const prev = wf.stage_index;
  const nextIdx = STAGES.indexOf(stage);
  if (prev >= 0 && nextIdx !== prev + 1 && stage !== STAGES[prev]) {
    throw new Error(`cannot skip from ${STAGES[prev]} to ${stage}`);
  }
  wf.stage = stage;
  wf.stage_index = nextIdx;
  wf.rounds[stage] = wf.rounds[stage] || { attempted: 0, completed: false };
  wf.rounds[stage].attempted += 1;
  wf.rounds[stage].started_at = new Date().toISOString();
  pushHistory(wf, `stage-start: ${stage}`);
  saveWorkflow(wf);
  return wf;
}

export function completeStage(wf, summary) {
  const stage = wf.stage;
  if (!stage) throw new Error('no active stage');
  wf.rounds[stage] = wf.rounds[stage] || {};
  wf.rounds[stage].completed = true;
  wf.rounds[stage].completed_at = new Date().toISOString();
  wf.rounds[stage].summary = summary || null;
  pushHistory(wf, `stage-complete: ${stage}`);
  // advance
  if (wf.stage_index < STAGES.length - 1) {
    wf.stage = null;
    wf.stage_index = -1;
  }
  saveWorkflow(wf);
  return wf;
}

export function recordGate(wf, stage, decision, reviewer, conditions, notes) {
  if (!HUMAN_GATE_STAGES.has(stage)) {
    throw new Error(`stage ${stage} has no human gate`);
  }
  wf.gates[stage] = {
    stage,
    decision,
    reviewer,
    decided_at: new Date().toISOString(),
    conditions: conditions || [],
    notes: notes || '',
  };
  pushHistory(wf, `gate ${stage}: ${decision}`);
  saveWorkflow(wf);
  return wf.gates[stage];
}

export function isStageApproved(wf, stage) {
  return wf.gates?.[stage]?.decision === 'approved';
}

export function nextStage(wf) {
  const idx = wf.stage_index;
  if (idx < 0) return STAGES[0];
  return STAGES[Math.min(idx + 1, STAGES.length - 1)];
}

export function status(wf) {
  return {
    paper_dir: wf.paper_dir,
    stage: wf.stage,
    stage_index: wf.stage_index,
    rounds: wf.rounds,
    gates: wf.gates,
    history: wf.history.slice(-10),
  };
}

function pushHistory(wf, message) {
  wf.history.push({ at: new Date().toISOString(), message });
  // cap history at 200 entries
  if (wf.history.length > 200) wf.history.splice(0, wf.history.length - 200);
}

/**
 * Decide whether the workflow can advance to the next stage.
 * Returns { canAdvance, requiresHumanGate, blocking, status }
 */
export function canAdvance(wf) {
  if (!wf.stage) return { canAdvance: false, blocking: ['no active stage'], status: status(wf) };
  const stage = wf.stage;
  const r = wf.rounds[stage];
  if (!r?.completed) return { canAdvance: false, blocking: [`stage ${stage} not completed`], status: status(wf) };
  if (HUMAN_GATE_STAGES.has(stage) && !isStageApproved(wf, stage)) {
    return { canAdvance: false, requiresHumanGate: stage, blocking: [`human gate for ${stage} not approved`], status: status(wf) };
  }
  const next = nextStage(wf);
  return { canAdvance: true, next, status: status(wf) };
}
