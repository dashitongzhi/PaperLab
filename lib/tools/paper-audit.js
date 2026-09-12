// paperlab/lib/tools/paper-audit.js
// Wraps paper-factory-kit's paper_audit.py.
//
// In dsh, this tool is registered as `paperlab-paper-audit` and called by
// the paper-auditor sub-agent. It shells out to Python because
// paper_audit.py is the single source of truth for audit logic.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PYTHON = process.env.PAPERLAB_PYTHON || 'python3';

const PAPER_FACTORY_KIT = process.env.PAPERLAB_PFK_PATH
  || path.resolve(
      process.env.HOME || '/Users/kral',
      'project/papers/codex-archive/paper-factory-kit/paper_audit.py'
    );

/**
 * Run paper_audit.py against a batch directory.
 *
 * @param {object} args
 * @param {string} args.batchPath - absolute path to a paper-factory-kit batch
 *                                   (or a single paper dir under drafts/)
 * @returns {{ok: boolean, stdout: string, stderr: string, exitCode: number, verdict?: string}}
 */
export function runPaperAudit({ batchPath }) {
  if (!fs.existsSync(PAPER_FACTORY_KIT)) {
    return {
      ok: false,
      stdout: '',
      stderr: `paper_audit.py not found at ${PAPER_FACTORY_KIT}. Set PAPERLAB_PFK_PATH.`,
      exitCode: -1,
    };
  }
  if (!fs.existsSync(batchPath)) {
    return {
      ok: false,
      stdout: '',
      stderr: `batch path does not exist: ${batchPath}`,
      exitCode: -1,
    };
  }

  const result = spawnSync(PYTHON, [PAPER_FACTORY_KIT, '--batch', batchPath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const verdict = result.stdout && /PASS/.test(result.stdout)
    ? 'PASS'
    : (result.stdout && /BLOCKED/.test(result.stdout) ? 'BLOCKED' : 'UNKNOWN');

  return {
    ok: result.status === 0,
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
