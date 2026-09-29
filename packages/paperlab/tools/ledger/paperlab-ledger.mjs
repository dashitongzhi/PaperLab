#!/usr/bin/env node
// paperlab-ledger — Claim-Evidence Ledger CLI (B-line hard gate).
// Merged port of old plugin lib/tools/ledger-read.js + ledger-write.js.
//
// Commands:
//   paperlab-ledger add --paper-dir <dir> --claim "..." --status supported|draft|gap \
//                       --evidence "pointer" [--section results] [--claim-id auto]
//   paperlab-ledger list --paper-dir <dir> [--status supported]
//
// Ledger lives at <dir>/evidence/claim_evidence_ledger.csv (RFC 4180).
// Validation is fail-closed: invalid rows refuse to write and exit 2.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LEDGER_FIELDS = [
  'claim_id', 'claim_text', 'section', 'evidence_status',
  'evidence_artifact_pointer', 'evidence_artifact', 'created_at',
];
const SECTIONS = ['abstract', 'intro', 'methods', 'results', 'discussion', 'conclusion', 'supplementary'];
const STATUSES = ['supported', 'draft', 'gap'];
const CLAIM_ID_RE = /^C\d{3,}$/;

function usage(exitCode = 1) {
  const lines = [
    'paperlab-ledger — claim-evidence ledger CLI',
    '',
    '  paperlab-ledger add --paper-dir <dir> --claim "..." --status supported|draft|gap \\',
    '                      --evidence "pointer" [--section results] [--claim-id auto|C001]',
    '  paperlab-ledger list --paper-dir <dir> [--status supported] [--section results]',
  ];
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const cmd = argv[0];
  if (cmd !== 'add' && cmd !== 'list') usage(1);
  const out = { cmd };
  for (let i = 1; i < argv.length; i += 2) {
    const key = String(argv[i]).replace(/^--/, '');
    const val = argv[i + 1];
    if (val === undefined || String(val).startsWith('--')) usage(1);
    out[key] = val;
  }
  return out;
}

function requireArgs(args, names) {
  const missing = names.filter((n) => args[n] === undefined);
  if (missing.length) {
    process.stderr.write(`missing required argument(s): ${missing.map((m) => '--' + m).join(', ')}\n`);
    usage(2);
  }
}

// ---- Ajv-backed validation with hand-written fallback (fail-closed) ----

function validateRowAjv(row, schema) {
  // Returns { ok, errors[] } via ajv from the repo root node_modules; null if ajv unavailable.
  const code = `
    const out = { unavailable: true, ok: false, errors: [] };
    try {
      const Ajv = require('ajv');
      const ajv = new Ajv({ allErrors: true });
      try { require('ajv-formats')(ajv); } catch { ajv.addFormat('date-time', () => true); }
      const validate = ajv.compile(${JSON.stringify(schema)});
      const ok = validate(${JSON.stringify(row)});
      out.unavailable = false;
      out.ok = ok;
      out.errors = (validate.errors || []).map(e => (e.instancePath || '') + ' ' + (e.message || ''));
    } catch (e) { out.errors = ['ajv-unavailable: ' + e.message]; }
    process.stdout.write(JSON.stringify(out));
  `;
  const res = spawnSync(process.execPath, ['-e', code], { cwd: '/Users/kral/project/paperlab-app', encoding: 'utf8' });
  if (res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed.unavailable) return null;
    return { ok: parsed.ok, errors: parsed.errors };
  } catch {
    return null;
  }
}

function validateRowFallback(row) {
  const errors = [];
  if (!row.claim_id || !CLAIM_ID_RE.test(row.claim_id)) errors.push('/claim_id must match ^C[0-9]{3,}$');
  if (!row.claim_text || row.claim_text.length < 10) errors.push('/claim_text minLength 10 (and required)');
  if (!SECTIONS.includes(row.section)) errors.push(`/section must be one of ${SECTIONS.join('|')}`);
  if (!STATUSES.includes(row.evidence_status)) errors.push(`/evidence_status must be one of ${STATUSES.join('|')}`);
  if (row.evidence_status === 'supported' && (!row.evidence_artifact_pointer || !row.evidence_artifact_pointer.trim())) {
    errors.push('/evidence_artifact_pointer required (non-empty) when evidence_status=supported');
  }
  return { ok: errors.length === 0, errors };
}

async function validateRow(row, schemaDir) {
  const schemaPath = path.join(schemaDir, 'claim-evidence-row.json');
  let schema = null;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch {
    schema = null;
  }
  if (schema) {
    const ajvResult = validateRowAjv(row, schema);
    if (ajvResult) return ajvResult;
  }
  return validateRowFallback(row);
}

// ---- RFC 4180 CSV ----

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseCsv(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cur.push(field); field = '';
      if (cur.length > 1 || cur[0] !== '') rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

function ledgerPathFor(paperDir) {
  return path.join(paperDir, 'evidence', 'claim_evidence_ledger.csv');
}

function readLedger(paperDir) {
  const p = ledgerPathFor(paperDir);
  if (!fs.existsSync(p)) return { header: LEDGER_FIELDS, rows: [] };
  const text = fs.readFileSync(p, 'utf8');
  const firstLineEnd = text.indexOf('\n');
  const rawHeader = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const header = parseCsvLine(rawHeader).filter((h) => h && h.trim());
  const parsed = parseCsv(text);
  return { header: header.length ? header : LEDGER_FIELDS, rows: parsed };
}

function parseCsvLine(line) {
  // Parse ONE raw CSV line (which may be the header) and keep it — unlike
  // parseCsv(), which treats the first line as a header and returns only data rows.
  const rows = parseCsvKeepFirst(line);
  return rows[0] || [];
}

function parseCsvKeepFirst(text) {
  // Same state machine as parseCsv but returns every physical line as a row.
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cur.push(field); field = '';
      rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  rows.push(cur);
  return rows;
}

function nextClaimId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = String(r.claim_id || '').match(/^C(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'C' + String(max + 1).padStart(3, '0');
}

async function cmdAdd(args) {
  requireArgs(args, ['paper-dir', 'claim', 'status', 'evidence']);
  const paperDir = path.resolve(args['paper-dir']);
  if (!fs.existsSync(paperDir) || !fs.statSync(paperDir).isDirectory()) {
    process.stderr.write(`paper-dir not found: ${paperDir}\n`);
    process.exit(2);
  }
  const section = args.section || 'results';
  const { rows } = readLedger(paperDir);
  const claimId = !args['claim-id'] || args['claim-id'] === 'auto'
    ? nextClaimId(rows)
    : args['claim-id'];
  const row = {
    claim_id: claimId,
    claim_text: args.claim,
    section,
    evidence_status: args.status,
    evidence_artifact_pointer: args.evidence,
    evidence_artifact: args.evidence ? { type: 'code_output', pointer: args.evidence } : undefined,
    created_at: new Date().toISOString(),
  };
  const validation = await validateRow(row, SCHEMA_DIR);
  if (!validation.ok) {
    process.stderr.write(`schema_validation_failed:\n  - ${validation.errors.join('\n  - ')}\n`);
    process.exit(2);
  }
  const ledgerFile = ledgerPathFor(paperDir);
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  const headerNeeded = !fs.existsSync(ledgerFile);
  // Append using the existing file's header if present (write fields it knows,
  // in header order) so legacy 10-column ledgers stay valid RFC 4180.
  const { header: existingHeader } = readLedger(paperDir);
  const writeHeader = headerNeeded ? LEDGER_FIELDS : existingHeader;
  const rowForWrite = {};
  for (const field of writeHeader) {
    if (field === 'evidence_status' || field === 'status') rowForWrite[field] = row.evidence_status;
    else if (field === 'section') rowForWrite[field] = row.section;
    else if (field === 'claim_text') rowForWrite[field] = row.claim_text;
    else if (field === 'claim_id') rowForWrite[field] = row.claim_id;
    else if (field === 'created_at' || field === 'updated_at') rowForWrite[field] = row.created_at;
    else if (field === 'evidence_artifact') {
      const art = row.evidence_artifact
      rowForWrite[field] = art && typeof art === 'object'
        ? `${art.type}:${art.pointer}` : `code_output:${row.evidence_artifact_pointer}`
    }
    else if (field === 'evidence_artifact_type') rowForWrite[field] = 'code_output';
    else if (field === 'evidence_artifact_pointer') rowForWrite[field] = row.evidence_artifact_pointer;
    else if (field === 'reviewer') rowForWrite[field] = 'paperlab-ledger';
    else rowForWrite[field] = '';
  }
  const fd = fs.openSync(ledgerFile, 'a');
  if (headerNeeded) fs.writeSync(fd, writeHeader.join(',') + '\n');
  fs.writeSync(fd, writeHeader.map((f) => csvEscape(rowForWrite[f])).join(',') + '\n');
  fs.closeSync(fd);
  const all = readLedger(paperDir).rows;
  const counts = tally(all);
  process.stdout.write(JSON.stringify({ ok: true, saved: row, total_claims: all.length, counts }, null, 2) + '\n');
}

function tally(rows) {
  const counts = { supported: 0, draft: 0, gap: 0 };
  for (const r of rows) {
    const s = String(r.evidence_status || r.status || '').toLowerCase();
    if (s in counts) counts[s] += 1;
  }
  return counts;
}

function cmdList(args) {
  requireArgs(args, ['paper-dir']);
  const paperDir = path.resolve(args['paper-dir']);
  let { rows } = readLedger(paperDir);
  if (args.status) rows = rows.filter((r) => String(r.evidence_status || r.status).toLowerCase() === args.status);
  if (args.section) rows = rows.filter((r) => r.section === args.section);
  const counts = tally(readLedger(paperDir).rows);
  const width = (s, n) => String(s).padEnd(n);
  const out = [];
  out.push(`${width('claim_id', 9)}${width('status', 11)}${width('section', 13)}claim_text`);
  out.push('-'.repeat(72));
  for (const r of rows) {
    const text = String(r.claim_text || '').slice(0, 46).replace(/\s+/g, ' ');
    out.push(`${width(r.claim_id, 9)}${width(r.evidence_status || r.status, 11)}${width(r.section, 13)}${text}`);
  }
  out.push('-'.repeat(72));
  out.push(`total=${rows.length} shown | supported=${counts.supported} draft=${counts.draft} gap=${counts.gap}`);
  process.stdout.write(out.join('\n') + '\n');
}

const HERE = import.meta.dirname;
const SCHEMA_DIR = path.resolve(HERE, '..', '..', 'schemas', 'v1');

const args = parseArgs(process.argv.slice(2));
if (args.cmd === 'add') {
  await cmdAdd(args);
} else {
  cmdList(args);
}
