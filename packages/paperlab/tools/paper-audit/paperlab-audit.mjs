#!/usr/bin/env node
// paperlab-audit — deterministic paper audit CLI (B-line hard gate).
// Wraps the vendored paper_audit.py engine and structures its output into
// <dir>/evidence/audit-report.json. Falls back to a Node-side minimal audit
// when python3 or the engine is unavailable.
//
// Commands:
//   paperlab-audit --paper-dir <dir>
//
// Verdict rules (fallback path):
//   - a claim in gap status  → BLOCKED
//   - an unverified citation → BLOCKED

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const ENGINE = path.join(HERE, 'paper_audit.py');

function usage(exitCode = 1) {
  process.stderr.write('usage: paperlab-audit --paper-dir <dir>\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = String(argv[i]).replace(/^--/, '');
    const val = argv[i + 1];
    if (val === undefined || String(val).startsWith('--')) usage(1);
    out[key] = val;
  }
  return out;
}

// ---- suggestion mapping (from the old plugin's audit_run) ----

function fixSuggestionFor(message) {
  const msg = String(message || '').toLowerCase();
  if (msg.includes('placeholder')) {
    return [
      'paperlab-ledger add --status draft --claim "<placeholder claim>" --evidence "todo: replace placeholder"',
      'then edit manuscript to remove TODO/TBD/INSERT markers',
    ].join(' && ');
  }
  if (msg.includes('missing required section')) {
    return 'edit manuscript/main.tex: add the missing \\section{...} via paper-write skill';
  }
  if (msg.includes('citation keys missing from bibtex')) {
    return 'paperlab-citation check --paper-dir <dir>  # then fix bib entries for missing keys';
  }
  if (msg.includes('claim-evidence ledger')) {
    return 'paperlab-ledger add --paper-dir <dir> --claim "..." --status supported --evidence "<artifact>"';
  }
  if (msg.includes('no claims are marked supported')) {
    return 'paperlab-ledger add --paper-dir <dir> --claim "..." --status supported --evidence "<artifact>"';
  }
  if (msg.includes('unresolved claim rows')) {
    return 'paperlab-ledger add --status supported --evidence "<artifact>" for each unresolved claim_id (or revise the claim text)';
  }
  if (msg.includes('evidence artifact')) {
    return 'paperlab-ledger: attach an evidence_artifact_pointer to the supported claim (figure/table/code_output/literature path)';
  }
  if (msg.includes('not verified') || msg.includes('lacks an identifier')) {
    return 'paperlab-citation check --paper-dir <dir>  # re-verify sources; update sources.csv identifier/url';
  }
  if (msg.includes('author') && msg.includes('incomplete')) {
    return 'edit manuscript/main.tex: complete \\author{} and affiliation metadata';
  }
  return 'inspect the finding in manuscript/ or evidence/ and fix it, then re-run paperlab-audit';
}

let suggestionSeq = 0;
function finding(message, severity) {
  suggestionSeq += 1;
  return {
    id: `F${String(suggestionSeq).padStart(3, '0')}`,
    severity,
    message: String(message).replace(/\.$/, ''),
    fix_suggestion: fixSuggestionFor(message),
  };
}

// ---- python engine path ----

function runPythonAudit(paperDir) {
  // The engine takes --batch <root> and audits every child containing project.json.
  // Point a temp batch root at a symlink of the single paper dir.
  if (!fs.existsSync(paperDir + '/project.json')) return { ran: false, reason: 'no project.json' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlab-audit-'));
  const link = path.join(tmp, path.basename(paperDir));
  try { fs.symlinkSync(paperDir, link, 'dir'); } catch { fs.cpSync(paperDir, link, { recursive: true }); }
  const res = spawnSync('python3', [ENGINE, '--batch', tmp], { encoding: 'utf8', timeout: 120000 });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (res.error || res.status === null) return { ran: false, reason: `engine failed: ${res.error || 'no exit'}` };
  const lines = String(res.stdout || '').split('\n').filter((l) => l.includes('\t'));
  const row = lines.find((l) => l.startsWith(path.basename(paperDir) + '\t'));
  if (!row) return { ran: false, reason: 'engine produced no row for paper dir' };
  const [, verdict, reportPath] = row.split('\t');
  if (!verdict || !reportPath) return { ran: false, reason: 'engine row unparseable' };
  const realReport = path.join(paperDir, 'checks', 'audit_report.md');
  const report = fs.existsSync(realReport) ? fs.readFileSync(realReport, 'utf8') : '';
  const findings = [];
  let section = null;
  for (const line of report.split('\n')) {
    if (/^## Blocking findings/.test(line)) { section = 'blocking'; continue; }
    if (/^## Warnings/.test(line)) { section = 'warning'; continue; }
    if (/^This audit checks/.test(line)) { section = null; continue; }
    if (section && line.startsWith('- ') && line !== '- None.') {
      findings.push(finding(line.slice(2), section === 'blocking' ? 'BLOCKED' : 'warning'));
    }
  }
  return { ran: true, verdict, findings, engine: 'paper_audit.py', engineExit: res.status };
}

// ---- node fallback audit ----

function parseCsvSimple(text) {
  // minimal RFC4180 parse for the ledger
  const rows = [];
  let cur = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cur.push(field); field = '';
      if (cur.length > 1 || cur[0] !== '') rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  return rows;
}

function runFallbackAudit(paperDir, reason) {
  const findings = [];
  const ledgerPath = path.join(paperDir, 'evidence', 'claim_evidence_ledger.csv');
  let rows = [];
  if (fs.existsSync(ledgerPath)) {
    const parsed = parseCsvSimple(fs.readFileSync(ledgerPath, 'utf8'));
    if (parsed.length) {
      const header = parsed[0];
      rows = parsed.slice(1).map((r) => {
        const o = {}; header.forEach((h, i) => { o[h] = r[i] ?? ''; }); return o;
      });
    }
  } else {
    findings.push(finding('claim-evidence ledger missing', 'BLOCKED'));
  }
  if (fs.existsSync(ledgerPath) && !rows.length) {
    findings.push(finding('claim-evidence ledger is empty', 'BLOCKED'));
  }
  const statusOf = (r) => String(r.evidence_status || r.status || '').toLowerCase();
  const gapRows = rows.filter((r) => statusOf(r) === 'gap');
  for (const r of gapRows) {
    findings.push(finding(`claim ${r.claim_id} is in gap status`, 'BLOCKED'));
  }
  const draftCount = rows.filter((r) => statusOf(r) === 'draft').length;
  if (draftCount) findings.push(finding(`${draftCount} claim(s) in draft status`, 'warning'));
  const supported = rows.filter((r) => statusOf(r) === 'supported');
  if (rows.length && !supported.length) {
    findings.push(finding('no claims are marked supported', 'BLOCKED'));
  }
  for (const r of supported) {
    if (!String(r.evidence_artifact_pointer || r.evidence_artifact || '').trim()) {
      findings.push(finding(`supported claim ${r.claim_id} has no evidence artifact pointer`, 'BLOCKED'));
    }
  }
  const jsonlPath = path.join(paperDir, 'evidence', 'citation-verification.jsonl');
  if (fs.existsSync(jsonlPath)) {
    const latest = new Map();
    for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        latest.set(rec.bib_key, rec);
      } catch { /* skip malformed */ }
    }
    for (const [key, rec] of latest) {
      if (rec.status === 'unverified') {
        findings.push(finding(`citation ${key} is unverified`, 'BLOCKED'));
      }
    }
    let unverifiedCount = 0;
    for (const rec of latest.values()) if (rec.status === 'unverified') unverifiedCount += 1;
    if (!latest.size) findings.push(finding('citation-verification.jsonl exists but has no records', 'warning'));
  } else {
    findings.push(finding('citation-verification.jsonl missing (run paperlab-citation check)', 'warning'));
  }
  const verdict = findings.some((f) => f.severity === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  return { ran: true, verdict, findings, engine: `node-fallback (${reason})`, engineExit: null };
}

// ---- main ----

const args = parseArgs(process.argv.slice(2));
if (!args['paper-dir']) usage(2);
const paperDir = path.resolve(args['paper-dir']);
if (!fs.existsSync(paperDir) || !fs.statSync(paperDir).isDirectory()) {
  process.stderr.write(`paper-dir not found: ${paperDir}\n`);
  process.exit(2);
}

let result = runPythonAudit(paperDir);
let degraded = false;
if (!result.ran) {
  degraded = true;
  result = runFallbackAudit(paperDir, result.reason);
}

const report = {
  verdict: result.verdict,
  engine: result.engine,
  degraded_path_used: degraded,
  findings: result.findings,
  run_at: new Date().toISOString(),
};
const outPath = path.join(paperDir, 'evidence', 'audit-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

const blocked = report.findings.filter((f) => f.severity === 'BLOCKED').length;
process.stdout.write(`verdict: ${report.verdict} (engine: ${report.engine}, degraded: ${degraded})\n`);
process.stdout.write(`findings: ${report.findings.length} (${blocked} blocking) → ${outPath}\n`);
for (const f of report.findings) {
  process.stdout.write(`  [${f.severity === 'BLOCKED' ? '✗' : '!'}] ${f.id} ${f.message}\n`);
  process.stdout.write(`      fix → ${f.fix_suggestion}\n`);
}
process.exit(report.verdict === 'BLOCKED' ? 1 : 0);
