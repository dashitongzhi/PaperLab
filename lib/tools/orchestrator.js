// paperlab/lib/tools/orchestrator.js — 5 orchestration tools + audit-runner.
//
// Each tool maps to a single, well-defined action the agent takes while
// driving the 5-stage paper-writing pipeline. The agent calls them in
// sequence; the orchestrator state machine ensures they fire in order.

import {
  STAGES, HUMAN_GATE_STAGES,
  loadWorkflow, saveWorkflow,
  startStage, completeStage, recordGate,
  canAdvance, status,
} from '../orchestrator/state.js';
import { ClaimEvidenceLedger } from '../integrity/ledger.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PAPER_FACTORY_KIT = process.env.PAPERLAB_PFK_PATH
  || path.resolve(process.env.HOME || '/Users/kral', 'project/papers/codex-archive/paper-factory-kit/paper_audit.py');

function getWf(paperDir) { return loadWorkflow(paperDir); }

// ── 1. paperlab_drive_stage — start the named stage ────────────────────
export const driveStageTool = {
  name: 'paperlab_drive_stage',
  description: [
    'Start the named stage of the paper-writing pipeline. Valid stages:',
    'topic | data | write | audit | submit. Calling this advances the',
    'workflow state machine; you cannot skip stages. Returns the updated',
    'workflow status.',
  ].join(' '),
  parameters: {
    paperDir: { type: 'string', required: true },
    stage:    { type: 'string', enum: [...STAGES], required: true },
    plan:     { type: 'string', description: 'Optional. Brief plan for this stage (recorded in workflow history).' },
  },
  output: { schema: { type: 'object', additionalProperties: true },
           render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
  handler(args) {
    const wf = getWf(args.paperDir);
    startStage(wf, args.stage);
    if (args.plan) {
      wf.history.push({ at: new Date().toISOString(), message: `plan: ${args.plan.slice(0, 280)}` });
      saveWorkflow(wf);
    }
    return { ok: true, stage: args.stage, status: status(wf) };
  },
};

// ── 2. paperlab_complete_stage — mark the active stage done ───────────
export const completeStageTool = {
  name: 'paperlab_complete_stage',
  description: [
    'Mark the active stage complete. Optionally pass an `artifacts` object',
    'listing files written during this stage; they are recorded in the',
    'workflow history. Returns whether the workflow can advance (true if',
    'no human gate blocks).',
  ].join(' '),
  parameters: {
    paperDir:  { type: 'string', required: true },
    summary:   { type: 'string', description: 'One-line summary of what was done.' },
    artifacts: { type: 'object', additionalProperties: true,
                 description: '{ "<label>": "<absolute path>" } pairs.' },
  },
  output: { schema: { type: 'object', additionalProperties: true },
           render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
  handler(args) {
    const wf = getWf(args.paperDir);
    const stage = wf.stage;
    if (!stage) return { ok: false, error: 'no active stage; call paperlab_drive_stage first' };
    completeStage(wf, args.summary);
    if (args.artifacts) {
      for (const [label, pointer] of Object.entries(args.artifacts)) {
        wf.history.push({ at: new Date().toISOString(), message: `artifact: ${label} -> ${pointer}` });
      }
      saveWorkflow(wf);
    }
    const advance = canAdvance(wf);
    return { ok: true, completed: stage, summary: args.summary, canAdvance: advance.canAdvance,
             requiresHumanGate: advance.requiresHumanGate || null, next: advance.next || null,
             status: status(wf) };
  },
};

// ── 3. paperlab_human_gate — record user approval for a stage gate ─────
export const humanGateTool = {
  name: 'paperlab_human_gate',
  description: [
    'Record the user decision for a stage human gate. Valid stages: topic |',
    'audit | submit. Valid decisions: approved | rejected | needs_revision |',
    'deferred. Workflow cannot advance past a human gate until this records',
    'an "approved" decision.',
  ].join(' '),
  parameters: {
    paperDir:   { type: 'string', required: true },
    stage:      { type: 'string', enum: [...HUMAN_GATE_STAGES], required: true },
    decision:   { type: 'string', enum: ['approved', 'rejected', 'needs_revision', 'deferred'], required: true },
    reviewer:   { type: 'string', description: 'Who decided (e.g. "user", "kral").' },
    conditions: { type: 'array', items: { type: 'string' } },
    notes:      { type: 'string' },
  },
  output: { schema: { type: 'object', additionalProperties: true },
           render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
  handler(args) {
    const wf = getWf(args.paperDir);
    const gate = recordGate(wf, args.stage, args.decision, args.reviewer || 'user', args.conditions, args.notes);
    return { ok: true, gate, status: status(wf) };
  },
};

// ── 4. paperlab_audit_run — run paper_audit.py + parse actionable list ─
export const auditRunTool = {
  name: 'paperlab_audit_run',
  description: [
    'Run paper_audit.py against the paper batch and parse the markdown',
    'audit report into structured actionable suggestions. Each suggestion',
    'is one tool call the agent should make next.',
  ].join(' '),
  parameters: {
    batchPath: { type: 'string', required: true, description: 'Path to a paper-factory-kit batch root.' },
  },
  output: { schema: { type: 'object', additionalProperties: true },
           render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
  async handler(args) {
    const r = spawnSync('python3', [PAPER_FACTORY_KIT, '--batch', args.batchPath], { encoding: 'utf8' });
    const ok = r.status === 0;
    const verdict = /PASS/i.test(r.stdout || '') ? 'PASS'
                  : /BLOCKED/i.test(r.stdout || '') ? 'BLOCKED'
                  : 'UNKNOWN';
    const suggestions = parseAuditSuggestions(r.stdout || '');
    return { ok, verdict, exitCode: r.status, stdout: r.stdout, stderr: r.stderr, suggestions };
  },
};

function parseAuditSuggestions(out) {
  const suggestions = [];
  // Pull the audit_report.md path the runner prints.
  const reportMatch = out.match(/(\/[\w./-]+audit_report\.md)/);
  const reportPath = reportMatch ? reportMatch[1] : null;
  if (reportPath && fs.existsSync(reportPath)) {
    const md = fs.readFileSync(reportPath, 'utf8');
    // Extract blocking findings.
    const blockers = [...md.matchAll(/^- (.+)$/gm)].map(m => m[1]);
    for (const line of blockers) {
      if (/Unresolved claim rows?:\s*(.+)/i.test(line)) {
        const ids = line.split(':')[1].trim().split(/,\s*/);
        for (const id of ids) {
          suggestions.push({
            blocking: true,
            finding: line,
            next_tool: 'paperlab_ledger_write',
            args: { claim_id: id, claim_text: '(rewrite this claim with concrete evidence)',
                    evidence_status: 'supported' },
            reason: `claim ${id} is unresolved — re-add it with a real evidence_artifact_pointer`,
          });
        }
      } else if (/No claims are marked supported/i.test(line)) {
        suggestions.push({
          blocking: true, finding: line,
          next_tool: 'paperlab_ledger_write',
          args: { claim_id: 'C001', claim_text: '(rewrite with concrete evidence)',
                  evidence_status: 'supported' },
          reason: 'at least one claim must be supported with evidence_artifact_pointer',
        });
      } else if (/citation keys missing from BibTeX/i.test(line)) {
        const keys = line.split(':')[1].trim().split(/,\s*/);
        for (const k of keys) {
          suggestions.push({
            blocking: true, finding: line,
            next_tool: 'paperlab_venue_match',  // closest available: search venue template
            args: { venue: 'methodsx' },
            reason: `add \\cite{${k}} to refs.bib or remove from manuscript`,
          });
        }
      } else if (/Supported claim .+ has no evidence artifact/i.test(line)) {
        suggestions.push({
          blocking: true, finding: line,
          next_tool: 'paperlab_ledger_write',
          args: { claim_id: 'C001', evidence_artifact_type: 'code_output',
                  evidence_artifact_pointer: 'evidence/datasets/D001/traceability.json' },
          reason: 'add a concrete evidence_artifact_pointer to the supported claim',
        });
      } else {
        suggestions.push({ blocking: true, finding: line, next_tool: 'review', reason: 'manual fix' });
      }
    }
  }
  return suggestions;
}

// ── 5. paperlab_todo — record the paper-writing todo list ──────────────
export const todoTool = {
  name: 'paperlab_todo',
  description: [
    'Write the current paper-writing todo list to a paperlab-managed file',
    'so the user can see it across sessions. Use at the start of a session',
    'after paperlab_drive_stage to enumerate the sub-steps you plan to take.',
  ].join(' '),
  parameters: {
    paperDir: { type: 'string', required: true },
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content:  { type: 'string', required: true },
          status:   { type: 'string', enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
          active_form: { type: 'string' },
        },
      },
    },
  },
  output: { schema: { type: 'object', additionalProperties: true },
           render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
  handler(args) {
    const p = path.join(args.paperDir, 'evidence', 'todo.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const todo = { paper_dir: args.paperDir, items: args.items, updated_at: new Date().toISOString() };
    fs.writeFileSync(p, JSON.stringify(todo, null, 2));
    return { ok: true, todo_path: p, item_count: args.items.length };
  },
};

// ── 6. paperlab_session_status — read current workflow + ledger + audit ─
export const sessionStatusTool = {
  name: 'paperlab_session_status',
  description: [
    'Read the current paper-writing session status: workflow stage, ledger',
    'summary, latest audit verdict, pending human gates. Use as the FIRST',
    'call at the start of a session to orient yourself.',
  ].join(' '),
  parameters: {
    paperDir:    { type: 'string', required: true },
    batchPath:   { type: 'string', description: 'Optional. Batch root for paper_audit.py lookup.' },
  },
  output: { schema: { type: 'object', additionalProperties: true },
           render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
  handler(args) {
    const wf = getWf(args.paperDir);
    let ledger = null;
    const lp = path.join(args.paperDir, 'evidence', 'claim_evidence_ledger.csv');
    if (fs.existsSync(lp)) {
      try { ledger = new ClaimEvidenceLedger(lp).summary(); } catch (e) { ledger = { _error: e.message }; }
    }
    let audit = null;
    const ap = path.join(args.paperDir, 'checks', 'audit_report.md');
    if (fs.existsSync(ap)) {
      const md = fs.readFileSync(ap, 'utf8');
      const m = md.match(/Verdict:\s*\*?\*?(PASS|BLOCKED)/);
      audit = { path: ap, verdict: m ? m[1] : 'UNKNOWN' };
    }
    return { ok: true, workflow: status(wf), ledger, audit,
             next_stage: wf.stage_index < STAGES.length - 1 ? STAGES[wf.stage_index + 1] : null };
  },
};

export const ORCHESTRATOR_TOOLS = [
  driveStageTool,
  completeStageTool,
  humanGateTool,
  auditRunTool,
  todoTool,
  sessionStatusTool,
];
