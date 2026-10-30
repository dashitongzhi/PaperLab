// paperlab/lib/tools/paper-audit.js
// Wraps paper-factory-kit's paper_audit.py.
//
// In dsh, this tool is registered as `paperlab-paper-audit` and called by
// the paper-auditor sub-agent. It shells out to Python because
// paper_audit.py is the single source of truth for audit logic.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON = process.env.PAPERLAB_PYTHON || 'python3';

const PAPER_FACTORY_KIT = process.env.PAPERLAB_PFK_PATH
  || path.resolve(dirname(fileURLToPath(import.meta.url)), '../../vendor/paper-factory-kit/paper_audit.py');

/**
 * Robust, structured parser for audit output to eliminate false PASS positives.
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {'PASS' | 'BLOCKED' | 'UNKNOWN'}
 */
export function parseAuditVerdict(stdout, exitCode) {
  if (exitCode !== 0) {
    return 'BLOCKED';
  }

  const text = stdout || '';

  // 1. Check for explicit summary line: e.g. "blocked=0 passed=1"
  const summaryMatch = text.match(/blocked=(\d+)\s+passed=(\d+)/i);
  if (summaryMatch) {
    const blocked = parseInt(summaryMatch[1], 10);
    const passed = parseInt(summaryMatch[2], 10);
    if (blocked > 0) return 'BLOCKED';
    if (passed > 0) return 'PASS';
  }

  // 2. Check tab-separated output line: "<project_name>\t<VERDICT>\t<report_path>"
  const projectVerdictMatch = text.match(/\t(BLOCKED|PASS)\t/);
  if (projectVerdictMatch) {
    return projectVerdictMatch[1];
  }

  // 3. Check report markdown style: "- Verdict: **PASS**" vs "**BLOCKED**"
  if (/-\s*Verdict:\s*\*\*BLOCKED\*\*/i.test(text)) return 'BLOCKED';
  if (/-\s*Verdict:\s*\*\*PASS\*\*/i.test(text)) return 'PASS';

  // 4. Fail-safe: if BLOCKED appears anywhere, treat as BLOCKED
  if (/\bBLOCKED\b/i.test(text)) return 'BLOCKED';

  // 5. Explicit word match
  if (/\bPASS\b/.test(text)) return 'PASS';

  return 'UNKNOWN';
}

/**
 * Run paper_audit.py against a batch directory.
 *
 * @param {object} args
 * @param {string} args.batchPath - absolute path to a paper-factory-kit batch
 *                                   (or a single paper dir under drafts/)
 * @returns {{ok: boolean, stdout: string, stderr: string, exitCode: number, verdict: string}}
 */
export function runPaperAudit({ batchPath }) {
  if (!fs.existsSync(PAPER_FACTORY_KIT)) {
    return {
      ok: false,
      stdout: '',
      stderr: `paper_audit.py not found at ${PAPER_FACTORY_KIT}. Set PAPERLAB_PFK_PATH.`,
      exitCode: -1,
      verdict: 'BLOCKED',
    };
  }
  if (!fs.existsSync(batchPath)) {
    return {
      ok: false,
      stdout: '',
      stderr: `batch path does not exist: ${batchPath}`,
      exitCode: -1,
      verdict: 'BLOCKED',
    };
  }

  const result = spawnSync(PYTHON, [PAPER_FACTORY_KIT, '--batch', batchPath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const verdict = parseAuditVerdict(result.stdout || '', result.status ?? -1);

  return {
    ok: result.status === 0 && verdict === 'PASS',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? -1,
    verdict,
  };
}

/**
 * dsh tool definition (consumed by the plugin manifest).
 */
export const toolDefinition = {
  name: 'paperlab-paper-audit',
  description: 'Run paper_audit.py from paper-factory-kit. Returns JSON verdict (PASS / BLOCKED) plus stdout/stderr.',
  parameters: {
    batchPath: { type: 'string', required: true, description: 'Absolute path to a drafts/ subdirectory or a paper-factory-kit batch root.' },
  },
  handler: async (args, _ctx) => runPaperAudit(args),
};
