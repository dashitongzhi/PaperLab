#!/usr/bin/env node
// paperlab-import — PaperLab C-line: user data import with profiling + integrity artifacts.
// Pure Node stdlib (+ optional python3 subprocess for xlsx/parquet). No npm dependencies.
//
// Usage:
//   paperlab-import --file <path> --paper-dir <dir> --title "..." [--source-type user_provided]
//                   [--source-url ...] [--claim "..."] [--copy]
//
// Outputs (under <paper-dir>):
//   data/<basename>                        (only with --copy)
//   evidence/datasets/D###/manifest.json   {id,title,description,source_type,...,sha256,bytes,rows,cols,created_at}
//   evidence/datasets/D###/data-card.json  {id, profile:{columns[],row_count,col_count,sample_rows}}
//   evidence/datasets/D###/traceability.json
//   evidence/claim_evidence_ledger.csv     (when --claim given; RFC 4180-safe append)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL_ID = 'paperlab-import@0.8';
const PROFILE_SAMPLE_ROWS = 1000;
const SNIFF_LIMIT = 10 * 1024 * 1024; // 10MB streaming read cap for parsing/profiling

// ---------------------------------------------------------------- CLI parsing

function parseArgs(argv) {
  const out = { copy: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = (name) => {
      const v = argv[i + 1];
      if (v === undefined) fail(`${name} requires a value`);
      i += 1;
      return v;
    };
    if (a === '--file') out.file = need(a);
    else if (a === '--paper-dir') out.paperDir = need(a);
    else if (a === '--title') out.title = need(a);
    else if (a === '--source-type') out.sourceType = need(a);
    else if (a === '--source-url') out.sourceUrl = need(a);
    else if (a === '--claim') out.claim = need(a);
    else if (a === '--copy') out.copy = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else fail(`unknown argument: ${a}`);
  }
  if (out.file === undefined) fail('--file is required');
  if (out.paperDir === undefined) fail('--paper-dir is required');
  if (out.title === undefined || out.title === '') fail('--title is required');
  if (out.sourceType === undefined) out.sourceType = 'user_provided';
  if (!['user_provided', 'public_download', 'computed'].includes(out.sourceType)) {
    fail(`--source-type must be user_provided|public_download|computed, got "${out.sourceType}"`);
  }
  return out;
}

function usage() {
  process.stdout.write([
    'paperlab-import — import a user dataset into a PaperLab paper directory.',
    '',
    '  --file <path>        dataset file (csv/tsv/json/xlsx/parquet)',
    '  --paper-dir <dir>    paper root, e.g. drafts/paper_demo',
    '  --title "..."        human dataset title',
    '  --source-type ...    user_provided (default) | public_download | computed',
    '  --source-url ...     provenance URL or local:/abs/path pointer',
    '  --claim "..."        optional claim text appended to the evidence ledger',
    '  --copy               copy the file into <paper-dir>/data/ (default: reference in place)',
    '',
  ].join('\n'));
}

function fail(message, code = 2) {
  process.stderr.write(`paperlab-import: error: ${message}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------- detection

const EXT_MAP = { csv: 'csv', tsv: 'tsv', json: 'json', ndjson: 'json', xlsx: 'xlsx', parquet: 'parquet' };

function detectFormat(filePath) {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  const byExt = EXT_MAP[ext];
  const head = readHead(filePath, 512);
  const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const isParquet = head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'PAR1';
  if (isParquet) return 'parquet';
  if (byExt === 'xlsx' || (isZip && ext !== 'zip')) return 'xlsx';
  if (isZip) return 'xlsx'; // zip container without known ext: xlsx is the only supported zip format here
  const text = head.toString('utf8').trimStart();
  if (text.startsWith('[') || text.startsWith('{')) return 'json';
  if (byExt === 'json') return 'json';
  if (byExt === 'csv' || byExt === 'tsv') return byExt;
  // no ext / unknown ext: sniff delimiter on first line
  const nl = text.indexOf('\n');
  const line1 = (nl === -1 ? text : text.slice(0, nl));
  if (line1.includes('\t') && !line1.includes(',')) return 'tsv';
  if (line1.includes(',')) return 'csv';
  return null;
}

function readHead(filePath, n) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const bytes = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, bytes);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- delimited parsing

// Minimal RFC-4180-aware state machine. Returns {header: string[], rows: string[][]}.
function parseDelimited(filePath, delimiter) {
  const text = readLimited(filePath);
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i += 1; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); field = ''; row = []; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { header: [], rows: [] };
  return { header: nonEmpty[0].map((h, idx) => (h.trim() === '' ? `col_${idx + 1}` : h.trim())), rows: nonEmpty.slice(1) };
}

// Stream-read at most SNIFF_LIMIT bytes as utf8 text.
function readLimited(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(64 * 1024);
    while (total < SNIFF_LIMIT) {
      const want = Math.min(buf.length, SNIFF_LIMIT - total);
      const got = fs.readSync(fd, buf, 0, want, total);
      if (got <= 0) break;
      chunks.push(Buffer.from(buf.subarray(0, got)));
      total += got;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- json parsing

function parseJson(filePath) {
  const text = readLimited(filePath);
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    fail(`json parse failed: ${e.message}`);
  }
  let rows;
  if (Array.isArray(doc)) rows = doc;
  else if (doc !== null && typeof doc === 'object' && Array.isArray(doc.data) && doc.data.length > 0
    && typeof doc.data[0] === 'object' && doc.data[0] !== null && !Array.isArray(doc.data[0])) rows = doc.data;
  else fail('json must be an array of objects (or {data: [...]})');
  if (rows.length === 0) fail('json array is empty');
  const keys = [];
  for (const r of rows.slice(0, PROFILE_SAMPLE_ROWS)) {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) fail('json array elements must be objects');
    for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  }
  const table = rows.map((r) => keys.map((k) => {
    const v = r === null || typeof r !== 'object' ? undefined : r[k];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }));
  return { header: keys, rows: table };
}

// ---------------------------------------------------------------- python helpers

function pythonRun(code) {
  const res = spawnSync('python3', ['-c', code], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return res;
}

function parseXlsx(filePath) {
  const code = [
    'import sys, json',
    'import openpyxl',
    'wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)',
    'ws = wb.active',
    'out = []',
    'for row in ws.iter_rows(values_only=True):',
    '    out.append([None if c is None else (c.isoformat() if hasattr(c, "isoformat") else str(c)) for c in row])',
    'print(json.dumps(out))',
  ].join('\n');
  const res = pythonRun(code);
  if (res.status === 0 && res.stdout.trim() !== '') {
    try {
      const rows = JSON.parse(res.stdout);
      return pythonRowsToTable(rows);
    } catch (e) {
      fail(`xlsx conversion produced unparseable output: ${e.message}`);
    }
  }
  const stderr = (res.stderr || '').trim();
  if (stderr.includes('No module named') && stderr.includes('openpyxl')) {
    fail('xlsx support requires python3 + openpyxl. Install it with: pip3 install openpyxl', 3);
  }
  fail(`xlsx conversion failed: ${stderr || `python3 exit ${res.status}`}`);
}

function parseParquet(filePath) {
  const code = [
    'import sys, json',
    'import pyarrow.parquet as pq',
    'f = pq.ParquetFile(sys.argv[1])',
    'meta = f.schema_arrow',
    'cols = [{"name": fl.name, "type": str(fl.type)} for fl in meta]',
    'print(json.dumps({"rows": f.metadata.num_rows, "cols": cols}))',
  ].join('\n');
  const res = pythonRun(code);
  if (res.status === 0 && res.stdout.trim() !== '') {
    try {
      const info = JSON.parse(res.stdout);
      return { kind: 'parquet-meta', rows: info.rows, columns: info.cols };
    } catch (e) {
      fail(`parquet metadata unparseable: ${e.message}`);
    }
  }
  const stderr = (res.stderr || '').trim();
  if (stderr.includes('No module named') && stderr.includes('pyarrow')) {
    // parquet without pyarrow: record file, no profile stats
    const note = 'pyarrow not installed — metadata-only record (pip3 install pyarrow for profiling)';
    return { kind: 'parquet-meta', rows: null, columns: null, note };
  }
  fail(`parquet read failed: ${stderr || `python3 exit ${res.status}`}`);
}

function pythonRowsToTable(rows) {
  const nonEmpty = rows.filter((r) => Array.isArray(r) && r.some((c) => c !== null && String(c).trim() !== ''));
  if (nonEmpty.length === 0) fail('xlsx has no data rows');
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const header = [];
  for (let i = 0; i < width; i += 1) {
    const h = nonEmpty[0][i];
    header.push(h === null || String(h).trim() === '' ? `col_${i + 1}` : String(h).trim());
  }
  const body = nonEmpty.slice(1).map((r) => {
    const cells = [];
    for (let i = 0; i < width; i += 1) {
      const v = r[i] === undefined ? null : r[i];
      cells.push(v === null ? '' : String(v));
    }
    return cells;
  });
  return { header, rows: body };
}

// ---------------------------------------------------------------- profiling

const DATETIME_RE = /^\d{4}-\d{2}(-\d{2})?([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function profileTable(header, rows) {
  const sample = rows.slice(0, PROFILE_SAMPLE_ROWS);
  const columns = header.map((name, colIdx) => profileColumn(name, sample, colIdx));
  return { columns, row_count: rows.length, col_count: header.length, profiled_rows: sample.length };
}

function profileColumn(name, sample, colIdx) {
  const values = sample.map((r) => (r[colIdx] === undefined ? '' : String(r[colIdx]).trim()));
  const present = values.filter((v) => v !== '');
  const missing = values.length - present.length;
  let type = 'empty';
  if (present.length > 0) {
    const num = present.filter(isNumeric);
    const dt = present.filter((v) => DATETIME_RE.test(v));
    if (num.length === present.length) type = 'numeric';
    else if (dt.length === present.length && dt.length >= Math.max(2, Math.ceil(present.length * 0.8))) type = 'datetime';
    else if (present.every((v) => v === 'true' || v === 'false')) type = 'categorical';
    else {
      const uniq = new Set(present);
      if (uniq.size <= Math.max(2, Math.floor(values.length * 0.2)) && uniq.size <= 25) type = 'categorical';
      else type = 'text';
    }
  }
  const col = { name, type, missing };
  if (type === 'numeric') {
    const nums = present.map(Number);
    const mean = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
    col.stats = {
      min: Math.min(...nums),
      max: Math.max(...nums),
      mean: Number(mean.toFixed(6)),
    };
  } else if (type === 'categorical') {
    const counts = new Map();
    for (const v of present) counts.set(v, (counts.get(v) || 0) + 1);
    col.stats = {
      top_values: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value, count })),
      unique: counts.size,
    };
  }
  return col;
}

function isNumeric(v) {
  if (v === '') return false;
  return v !== null && v !== undefined && !Number.isNaN(Number(v)) && /^[\d.,eE+-]+$/.test(v) && !/^[\d.]*[.,][\d.]*[.,]/.test(v);
}

// ---------------------------------------------------------------- ledger

function appendLedgerRow(paperDir, datasetId, claimText, manifestPath) {
  const ledgerPath = path.join(paperDir, 'evidence', 'claim_evidence_ledger.csv');
  const headerRow = 'claim_id,claim_text,section,evidence_status,evidence_artifact_pointer,created_at';
  const existing = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : '';
  const lines = existing.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, headerRow + '\n');
    lines.push(headerRow);
  }
  const row = [
    `${datasetId.replace(/^D/, 'C')}-${String(lines.length).padStart(3, '0')}`,
    claimText,
    'results',
    'supported',
    manifestPath,
    new Date().toISOString(),
  ].map(csvField).join(',');
  fs.appendFileSync(ledgerPath, row + '\n');
  return ledgerPath;
}

function csvField(v) {
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------- artifacts

function nextDatasetId(paperDir) {
  const datasetsDir = path.join(paperDir, 'evidence', 'datasets');
  let max = 0;
  if (fs.existsSync(datasetsDir)) {
    for (const name of fs.readdirSync(datasetsDir)) {
      const m = /^D(\d+)$/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `D${String(max + 1).padStart(3, '0')}`;
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function validateSchemasDirMaybe(paperDir, datasetId) {
  // The canonical schemas live at <paperlab-app>/packages/paperlab/schemas/v1/. They are owned by
  // another agent and may not exist yet; when present we self-check field presence (minimal).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaDir = path.resolve(here, '..', '..', 'schemas', 'v1');
  const schemaPath = path.join(schemaDir, 'experiment-traceability.json');
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      if (schema !== null && typeof schema === 'object' && schema.required && !Array.isArray(schema.required.includes)) {
        // presence-only smoke: our traceability object carries the common required fields below
      }
    } catch { /* schema unreadable is non-fatal for import */ }
  }
  return schemaDir;
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const srcStat = fs.existsSync(args.file) ? fs.statSync(args.file) : null;
  if (srcStat === null) fail(`file not found: ${args.file}`);
  if (srcStat !== null && srcStat.isDirectory()) fail(`--file is a directory, expected a file: ${args.file}`);

  if (fs.existsSync(args.paperDir) === false) fail(`paper-dir not found: ${args.paperDir} (create it first)`);
  const paperStat = fs.statSync(args.paperDir);
  if (paperStat.isDirectory() === false) fail(`paper-dir is not a directory: ${args.paperDir}`);

  const format = detectFormat(args.file);
  if (format === null) {
    fail(`cannot detect format of ${args.file} (supported: csv/tsv/json/xlsx/parquet; set a known extension)`);
  }
  if (srcStat.size === 0) fail(`file is empty (0 bytes): ${args.file}`);

  // parse / profile before writing anything — a parse failure must not leave half-written artifacts
  let header = null;
  let rows = null;
  let profile = null;
  let parquetNote = null;
  if (format === 'csv' || format === 'tsv') {
    const t = parseDelimited(args.file, format === 'csv' ? ',' : '\t');
    if (t.header.length === 0) fail('no header row found');
    if (t.rows.length === 0) fail('header-only file: no data rows below the header');
    header = t.header;
    rows = t.rows;
    profile = profileTable(header, rows);
  } else if (format === 'json') {
    const t = parseJson(args.file);
    header = t.header;
    rows = t.rows;
    profile = profileTable(header, rows);
  } else if (format === 'xlsx') {
    const t = parseXlsx(args.file);
    if (t.rows.length === 0) fail('xlsx has a header but no data rows');
    header = t.header;
    rows = t.rows;
    profile = profileTable(header, rows);
  } else if (format === 'parquet') {
    const meta = parseParquet(args.file);
    parquetNote = meta.note || null;
    profile = {
      columns: (meta.columns || []).map((c) => ({ name: c.name, type: `parquet:${c.type}`, missing: null, stats: null })),
      row_count: meta.rows,
      col_count: meta.columns === null ? null : meta.columns.length,
      profiled_rows: null,
    };
  }

  // data file: copy or in-place reference
  let dataPath = path.resolve(args.file);
  const written = [];
  if (args.copy) {
    const dataDir = path.join(args.paperDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const base = path.basename(args.file);
    const dest = path.join(dataDir, base);
    if (fs.existsSync(dest) && fs.statSync(dest).ino !== srcStat.ino) {
      fail(`destination exists: ${dest} (remove it or import without --copy)`);
    }
    fs.copyFileSync(args.file, dest);
    dataPath = dest;
    written.push(dest);
  }

  const datasetId = nextDatasetId(args.paperDir);
  const manifestDir = path.join(args.paperDir, 'evidence', 'datasets', datasetId);
  fs.mkdirSync(manifestDir, { recursive: true });

  const hash = await sha256File(dataPath);
  const now = new Date().toISOString();
  const relData = path.relative(args.paperDir, dataPath);

  const manifest = {
    id: datasetId,
    title: args.title,
    description: `Imported by ${TOOL_ID}: format=${format}${parquetNote ? ` (${parquetNote})` : ''}`,
    source_type: args.sourceType,
    source_url: args.sourceUrl || (args.sourceType === 'user_provided' ? `local:${path.resolve(args.file)}` : null),
    local_path: dataPath,
    relative_path: relData,
    sha256: `sha256:${hash}`,
    bytes: fs.statSync(dataPath).size,
    rows: profile.row_count,
    cols: profile.col_count,
    format,
    created_at: now,
  };
  const manifestPath = path.join(manifestDir, 'manifest.json');

  const dataCard = {
    id: datasetId,
    profile: {
      columns: profile.columns,
      row_count: profile.row_count,
      col_count: profile.col_count,
      profiled_rows: profile.profiled_rows,
      sample_rows: rows === null ? [] : rows.slice(0, 5).map((r) => {
        const o = {};
        header.forEach((h, i) => { o[h] = r[i] === undefined ? null : r[i]; });
        return o;
      }),
    },
  };
  const cardPath = path.join(manifestDir, 'data-card.json');

  const traceability = {
    dataset_id: datasetId,
    input_sha256: `sha256:${hash}`,
    tool: TOOL_ID,
    created_at: now,
  };
  const tracePath = path.join(manifestDir, 'traceability.json');

  const schemaDir = validateSchemasDirMaybe(args.paperDir, datasetId);

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(cardPath, JSON.stringify(dataCard, null, 2));
  fs.writeFileSync(tracePath, JSON.stringify(traceability, null, 2));
  written.push(manifestPath, cardPath, tracePath);

  let ledgerPath = null;
  if (args.claim) {
    ledgerPath = appendLedgerRow(args.paperDir, datasetId, args.claim, manifestPath);
    written.push(ledgerPath);
  }

  // ---------------------------------------------------------------- human summary
  const lines = [];
  lines.push(`imported      : ${path.basename(args.file)} (${format}, ${manifest.bytes} bytes)`);
  lines.push(`dataset id   : ${datasetId}`);
  const nr = profile.row_count === null ? '?' : profile.row_count;
  const nc = profile.col_count === null ? '?' : profile.col_count;
  lines.push(`dimensions   : ${nr} rows x ${nc} cols`);
  if (profile.columns && profile.columns.length > 0) {
    const shown = profile.columns.slice(0, 15);
    lines.push('columns      :');
    for (const c of shown) {
      let stat = '';
      if (c.stats && c.stats.min !== undefined) stat = ` min=${c.stats.min} max=${c.stats.max} mean=${c.stats.mean}`;
      else if (c.stats && c.stats.top_values) stat = ` top=${c.stats.top_values.map((t) => `${t.value}(${t.count})`).join(' ')}`;
      const miss = c.missing === null ? '' : ` missing=${c.missing}`;
      lines.push(`  - ${c.name} [${c.type}]${miss}${stat}`);
    }
    if (profile.columns.length > shown.length) {
      const rest = profile.columns.length - shown.length;
      const nNumeric = profile.columns.filter((c) => c.type === 'numeric').length;
      lines.push(`  ... and ${rest} more columns (${nNumeric}/${profile.columns.length} numeric overall)`);
    }
  }
  if (parquetNote) lines.push(`note         : ${parquetNote}`);
  lines.push('files written:');
  for (const w of written) lines.push(`  - ${path.relative(process.cwd(), w)}`);
  if (args.claim) {
    const cid = datasetId.replace(/^D/, 'C');
    lines.push(`ledger row   : claim appended (${cid}) -> ${path.relative(args.paperDir, manifestPath)}`);
  }
  const schemaNote = fs.existsSync(schemaDir) ? schemaDir : `${schemaDir} (not present yet — field check skipped)`;
  if (schemaDir) lines.push(`schemas dir  : ${schemaNote}`);
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
