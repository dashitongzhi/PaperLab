// paperlab/lib/orchestrator/state.js
// Workflow state machine for the 5-stage paper-writing pipeline.
//
// Enforces:
//   - Strict forward progression (no skipping stages).
//   - Human gate approval before advancing past gate stages.
//   - Explicit rollback / revision mechanism (allows moving back when audit/gates reject).
//   - Local persistence surviving agent restarts and working in headless/CLI mode.

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
    last_completed_stage: null,
    completed_stages: [],
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

export function checkCanStartStage(wf, stage) {
  if (!STAGES.includes(stage)) {
    return { canStart: false, reason: `unknown stage: '${stage}'. Valid stages: ${STAGES.join(', ')}` };
  }
  // Cannot switch to another stage if a stage is currently active and in-progress
  if (wf.stage && wf.stage !== stage) {
    return {
      canStart: false,
      reason: `workflow already in active stage '${wf.stage}'; complete stage or rollback before starting '${stage}'`,
    };
  }

  const targetIdx = STAGES.indexOf(stage);
  // Stage 0 (topic) can always start if not already in another stage
  if (targetIdx === 0) {
    return { canStart: true };
  }

  // All prior stages must be completed
  for (let i = 0; i < targetIdx; i++) {
    const priorStage = STAGES[i];
    if (!wf.rounds[priorStage]?.completed) {
      return {
        canStart: false,
        reason: `cannot start stage '${stage}': prior stage '${priorStage}' is not completed`,
      };
    }
    // Any prior human gate must be approved and not invalidated
    if (HUMAN_GATE_STAGES.has(priorStage) && !isStageApproved(wf, priorStage)) {
      return {
        canStart: false,
        reason: `cannot start stage '${stage}': prior human gate for '${priorStage}' is not approved`,
      };
    }
  }

  return { canStart: true };
}

export function startStage(wf, stage) {
  const check = checkCanStartStage(wf, stage);
  if (!check.canStart) {
    throw new Error(check.reason);
  }

  const nextIdx = STAGES.indexOf(stage);
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
  wf.last_completed_stage = stage;
  if (!wf.completed_stages) wf.completed_stages = [];
  if (!wf.completed_stages.includes(stage)) wf.completed_stages.push(stage);
  pushHistory(wf, `stage-complete: ${stage}`);

  // Close active stage without erasing history
  wf.stage = null;
  saveWorkflow(wf);
  return wf;
}

export function rollbackStage(wf, targetStage, reason) {
  if (!STAGES.includes(targetStage)) {
    throw new Error(`unknown rollback target stage: '${targetStage}'. Valid stages: ${STAGES.join(', ')}`);
  }
  const targetIdx = STAGES.indexOf(targetStage);
  const activeIdx = wf.stage ? STAGES.indexOf(wf.stage) : -1;
  const lastIdx = wf.last_completed_stage ? STAGES.indexOf(wf.last_completed_stage) : -1;
  const highestIdx = Math.max(activeIdx, lastIdx);

  if (targetIdx >= highestIdx && highestIdx !== -1) {
    throw new Error(
      `cannot rollback to '${targetStage}': target must be strictly earlier than current/latest stage ('${wf.stage || wf.last_completed_stage}')`
    );
  }

  // Invalidate any stages from targetIdx onwards
  for (let i = targetIdx; i < STAGES.length; i++) {
    const s = STAGES[i];
    if (wf.rounds[s]) {
      wf.rounds[s].completed = false;
      wf.rounds[s].rolled_back_at = new Date().toISOString();
      wf.rounds[s].rollback_reason = reason || 'unspecified';
    }
    if (wf.gates[s]) {
      wf.gates[s].invalidated = true;
      wf.gates[s].invalidated_at = new Date().toISOString();
      wf.gates[s].invalidated_reason = reason || 'unspecified';
      wf.gates[s].decision = 'needs_revision';
    }
  }

  if (Array.isArray(wf.completed_stages)) {
    wf.completed_stages = wf.completed_stages.filter(s => STAGES.indexOf(s) < targetIdx);
  }
  wf.last_completed_stage = targetIdx > 0 ? STAGES[targetIdx - 1] : null;

  wf.stage = targetStage;
  wf.stage_index = targetIdx;
  wf.rounds[targetStage] = wf.rounds[targetStage] || { attempted: 0, completed: false };
  wf.rounds[targetStage].attempted += 1;
  wf.rounds[targetStage].started_at = new Date().toISOString();

  pushHistory(wf, `stage-rollback to ${targetStage}: ${reason || 'unspecified'}`);
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
    invalidated: false,
    conditions: conditions || [],
    notes: notes || '',
  };
  pushHistory(wf, `gate ${stage}: ${decision}`);
  saveWorkflow(wf);
  return wf.gates[stage];
}

export function isStageApproved(wf, stage) {
  const gate = wf.gates?.[stage];
  return gate?.decision === 'approved' && !gate?.invalidated;
}

export function nextStage(wf) {
  const current = wf.stage || wf.last_completed_stage;
  if (!current) return STAGES[0];
  const idx = STAGES.indexOf(current);
  if (idx < 0) return STAGES[0];
  return STAGES[Math.min(idx + 1, STAGES.length - 1)];
}

export function status(wf) {
  return {
    paper_dir: wf.paper_dir,
    stage: wf.stage,
    stage_index: wf.stage_index,
    last_completed_stage: wf.last_completed_stage || null,
    completed_stages: wf.completed_stages || [],
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
  if (wf.stage) {
    const stage = wf.stage;
    const r = wf.rounds[stage];
    if (!r?.completed) {
      return { canAdvance: false, blocking: [`stage '${stage}' not completed`], status: status(wf) };
    }
    if (HUMAN_GATE_STAGES.has(stage) && !isStageApproved(wf, stage)) {
      return {
        canAdvance: false,
        requiresHumanGate: stage,
        blocking: [`human gate for '${stage}' not approved`],
        status: status(wf),
      };
    }
    const next = nextStage(wf);
    return { canAdvance: true, next, status: status(wf) };
  }

  const last = wf.last_completed_stage;
  if (!last) {
    return { canAdvance: true, next: STAGES[0], status: status(wf) };
  }
  if (HUMAN_GATE_STAGES.has(last) && !isStageApproved(wf, last)) {
    return {
      canAdvance: false,
      requiresHumanGate: last,
      blocking: [`human gate for '${last}' not approved`],
      status: status(wf),
    };
  }
  const lastIdx = STAGES.indexOf(last);
  if (lastIdx >= STAGES.length - 1) {
    return { canAdvance: false, blocking: ['pipeline finished'], status: status(wf) };
  }
  return { canAdvance: true, next: STAGES[lastIdx + 1], status: status(wf) };
}
