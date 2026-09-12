// paperlab/lib/tools/run-branch.js
// Best-First Tree Search over experiment branches (Sakana v2 pattern).
//
// Spawns a sub-process to run an experiment variant, scores novelty +
// pass-rate, persists to evidence/branch_tree.json, returns the branch
// id so the orchestrator can keep iterating on the best arm.
//
// For v0.6 the "run" is just a shell command; future versions can hook
// into paper-audit + dataset-manifest to compute real scoring.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const toolDefinition = {
  name: 'paperlab-run-branch',
  description: [
    'Run a new experiment branch from a parent. Persists branch into',
    'evidence/branch_tree.json with { score, results, hypothesis }.',
    'Returns { branch_id, parent_id, score, results, history }.',
  ].join(' '),
  parameters: {
    paperDir:    { type: 'string', required: true },
    parentId:    { type: 'string', description: 'Parent branch id (null for root).' },
    hypothesis:  { type: 'string', required: true },
    runCommand:  { type: 'string', required: true, description: 'Shell command to run.' },
    novelty:     { type: 'number', default: 0.5, description: 'Prior novelty score 0..1.' },
    timeoutMs:   { type: 'integer', default: 600000 },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  async handler(args, _ctx) {
    const treePath = path.join(args.paperDir, 'evidence', 'branch_tree.json');
    fs.mkdirSync(path.dirname(treePath), { recursive: true });
    const tree = fs.existsSync(treePath)
      ? JSON.parse(fs.readFileSync(treePath, 'utf8'))
      : { branches: [] };

    const r = spawnSync('bash', ['-lc', args.runCommand], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: args.timeoutMs ?? 600_000,
    });
    const pass = r.status === 0;
    // Crude score: pass-rate × novelty. v0.7+ should compute via paper-audit.
    const score = pass ? Math.max(0, Math.min(1, args.novelty)) : 0;

    const branch = {
      branch_id: `B${tree.branches.length + 1}`.padStart(4, '0'),
      parent_id: args.parentId || null,
      hypothesis: args.hypothesis,
      run_command: args.runCommand,
      novelty_prior: args.novelty,
      pass,
      score,
      exit_code: r.status,
      stdout_tail: (r.stdout || '').slice(-2000),
      stderr_tail: (r.stderr || '').slice(-2000),
      ran_at: new Date().toISOString(),
    };
    tree.branches.push(branch);
    fs.writeFileSync(treePath, JSON.stringify(tree, null, 2));

    // Best-first: pick the highest-score leaf for next iteration.
    const best = tree.branches.reduce((a, b) => (a == null || b.score > a.score ? b : a), null);
    return { ok: true, branch, best_so_far: best, total_branches: tree.branches.length };
  },
};
