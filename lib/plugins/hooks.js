// paperlab/lib/plugins/hooks.js
// Claude Code-style hook system (lightweight): after every paper-audit
// invocation, run paperlab_audit_run to translate BLOCKED findings into
// actionable next-step tool calls. Mirrors Claude Code's PostToolUse
// semantics but only for the paperlab-audit tool.

import fs from 'node:fs';
import path from 'node:path';
import { parseAuditSuggestions } from '../tools/orchestrator.js';

const TRIGGER_TOOLS = new Set(['paperlab_paper_audit', 'paperlab-audit', 'paperlab_audit_run', 'paperlab-paper-audit']);

export function installAuditFixupHook(ctx) {
  if (!ctx.tools || typeof ctx.tools.observe !== 'function') return;
  ctx.tools.observe(async (toolName, args, result) => {
    if (!TRIGGER_TOOLS.has(toolName)) return result;
    if (!result || typeof result !== 'object') return result;
    const verdict = result.verdict || (result.stdout && /PASS/.test(result.stdout) ? 'PASS' : null);
    if (verdict === 'PASS') return result;

    // Find the latest audit_report.md in checks/ for the audited project.
    const batchPath = args?.batchPath;
    const auditReport = batchPath
      ? findLatestAuditReport(batchPath)
      : null;
    if (!auditReport) return result;

    const md = fs.readFileSync(auditReport, 'utf8');
    const suggestions = mdToSuggestions(md);
    if (suggestions.length === 0) return result;

    return {
      ...result,
      suggestions,
      hook_hint: `Audit returned ${verdict || 'BLOCKED'}. ${suggestions.length} actionable fix(es) detected — call the corresponding paperlab_ledger_write / paperlab_venue_match / paperlab_audit_run tools to address them, then re-run paperlab_paper_audit.`,
    };
  });
}

function findLatestAuditReport(batchPath) {
  // paper_audit.py writes checks/audit_report.md in the paper dir. Batch
  // root is the parent; the report lives inside one of its subdirs.
  if (!fs.existsSync(batchPath)) return null;
  const stat = fs.statSync(batchPath);
  if (stat.isFile()) return batchPath;
  const dirs = fs.readdirSync(batchPath).filter(d => {
    try { return fs.statSync(path.join(batchPath, d)).isDirectory(); } catch { return false; }
  });
  const candidates = [];
  for (const d of dirs) {
    const p = path.join(batchPath, d, 'checks', 'audit_report.md');
    if (fs.existsSync(p)) candidates.push({ p, m: fs.statSync(p).mtimeMs });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.m - a.m);
  return candidates[0].p;
}

function mdToSuggestions(md) {
  // Reuse the orchestrator's parser via dynamic import path. The function
  // takes the raw audit stdout and parses the report_path it printed.
  const reportMatch = md.match(/(.+audit_report\.md)/);
  if (!reportMatch) return [];
  // The orchestrator parser expects stdout shape. Build a fake one.
  const fakeStdout = `Verdict copy at ${reportMatch[1]}\n` + md;
  try {
    return parseAuditSuggestions(fakeStdout);
  } catch { return []; }
}
