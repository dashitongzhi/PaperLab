#!/usr/bin/env node
// paperlab-citation — citation verification CLI (B-line hard gate).
// Port of old plugin lib/tools/citation-check.js, batch mode over a .bib file.
//
// Commands:
//   paperlab-citation check --paper-dir <dir> [--bib manuscript/references.bib]
//     Parse every bib entry's DOI → CrossRef reverse lookup → arXiv fallback → unverified.
//     Appends one JSON line per entry to <dir>/evidence/citation-verification.jsonl
//   paperlab-citation gap --paper-dir <dir>
//     Compare \cite{} keys in main.tex vs bib entries; report missing / unused.
//
// Pure stdlib (Node 20+ global fetch). No npm deps.

import fs from 'node:fs';
import path from 'node:path';

const CROSSREF = 'https://api.crossref.org/works';
const ARXIV = 'https://export.arxiv.org/api/query';
const UA = 'PaperLab/0.8 citation-check (+https://paperlab.local)';
const TIMEOUT_MS = 15000;

function usage(exitCode = 1) {
  const lines = [
    'paperlab-citation — citation verification CLI',
    '',
    '  paperlab-citation check --paper-dir <dir> [--bib manuscript/references.bib]',
    '  paperlab-citation gap --paper-dir <dir> [--tex manuscript/main.tex] [--bib manuscript/references.bib]',
  ];
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const cmd = argv[0];
  if (cmd !== 'check' && cmd !== 'gap') usage(1);
  const out = { cmd };
  for (let i = 1; i < argv.length; i += 2) {
    const key = String(argv[i]).replace(/^--/, '');
    const val = argv[i + 1];
    if (val === undefined || String(val).startsWith('--')) usage(1);
    out[key] = val;
  }
  return out;
}

// ---- minimal bibtex parsing (regex state machine, no deps) ----

function parseBib(text) {
  const entries = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|\n*\Z|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, type, key, body] = m;
    if (type.toLowerCase() === 'comment' || type.toLowerCase() === 'string') continue;
    const fields = {};
    // match field = {balanced} or field = "..." or field = bare
    let i = 0;
    while (i < body.length) {
      const fm = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/.exec(body.slice(i));
      if (!fm) break;
      const fieldName = fm[1].toLowerCase();
      i += fm.index + fm[0].length;
      let value = '';
      if (body[i] === '{') {
        let depth = 1; i += 1; const start = i;
        while (i < body.length && depth > 0) {
          if (body[i] === '{') depth += 1;
          else if (body[i] === '}') depth -= 1;
          if (depth > 0) i += 1;
        }
        value = body.slice(start, i);
        i += 1; // closing brace
      } else if (body[i] === '"') {
        i += 1; const start = i;
        while (i < body.length && body[i] !== '"') i += 1;
        value = body.slice(start, i);
        i += 1;
      } else {
        const start = i;
        while (i < body.length && body[i] !== ',' && body[i] !== '\n') i += 1;
        value = body.slice(start, i).trim();
      }
      fields[fieldName] = cleanBibValue(value);
      // advance to next field separator
      while (i < body.length && (body[i] === ',' || body[i] === ' ' || body[i] === '\n' || body[i] === '\r' || body[i] === '\t')) i += 1;
    }
    entries.push({ type, key, fields });
  }
  return entries;
}

function cleanBibValue(v) {
  return String(v)
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArxivId(entry) {
  const fromFields = entry.fields.eprint || entry.fields.arxivid || entry.fields.id;
  if (fromFields && /^\d{4}\.\d{4,5}(v\d+)?$/i.test(fromFields.trim())) return fromFields.trim();
  const fromUrl = (entry.fields.url || '').match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/i);
  if (fromUrl) return fromUrl[1];
  const fromNote = (entry.fields.note || '').match(/arxiv[:\s]*(\d{4}\.\d{4,5})/i);
  if (fromNote) return fromNote[1];
  return null;
}

// ---- network with timeout ----

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

async function checkCrossref(doi) {
  const url = `${CROSSREF}/${encodeURIComponent(doi)}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`crossref ${r.status}`);
  const j = await r.json();
  const m = j.message;
  if (!m || !m.DOI) throw new Error('crossref: no message.DOI');
  return {
    title: (m.title && m.title[0] || '').trim(),
    container: (m['container-title'] && m['container-title'][0]) || null,
    year: (m.issued && m.issued['date-parts'] && m.issued['date-parts'][0] && m.issued['date-parts'][0][0]) || null,
  };
}

async function checkArxiv(arxivId) {
  const url = `${ARXIV}?id_list=${encodeURIComponent(arxivId)}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`arxiv ${r.status}`);
  const xml = await r.text();
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entry) throw new Error('arxiv: no entry');
  const e = entry[1];
  const title = ((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/\s+/g, ' ').trim();
  if (!title || /^error/i.test(title)) throw new Error('arxiv: empty entry');
  return { title, container: 'arXiv', year: null };
}

function titleMatchScore(bibTitle, remoteTitle) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const a = norm(bibTitle);
  const b = norm(remoteTitle);
  if (!a.length || !b.length) return false;
  const setB = new Set(b);
  const overlap = a.filter((w) => setB.has(w)).length / a.length;
  return overlap >= 0.6;
}

async function verifyEntry(entry) {
  const doi = entry.fields.doi ? entry.fields.doi.trim() : null;
  const arxivId = extractArxivId(entry);
  const bibTitle = entry.fields.title || null;
  const rec = {
    bib_key: entry.key,
    doi: doi,
    arxiv_id: arxivId,
    status: 'unverified',
    source: null,
    checked_at: new Date().toISOString(),
    title_matched: null,
    remote_title: null,
  };
  if (doi) {
    try {
      const hit = await checkCrossref(doi);
      rec.status = 'verified';
      rec.source = 'crossref';
      rec.remote_title = hit.title;
      rec.title_matched = bibTitle ? titleMatchScore(bibTitle, hit.title) : null;
      return rec;
    } catch { /* fallthrough to arxiv */ }
  }
  if (arxivId) {
    try {
      const hit = await checkArxiv(arxivId);
      rec.status = 'verified';
      rec.source = 'arxiv';
      rec.remote_title = hit.title;
      rec.title_matched = bibTitle ? titleMatchScore(bibTitle, hit.title) : null;
      return rec;
    } catch { /* fallthrough */ }
  }
  if (!doi && !arxivId) {
    rec.status = 'no_identifier';
  }
  return rec;
}

// ---- commands ----

async function cmdCheck(args) {
  if (!args['paper-dir']) usage(2);
  const paperDir = path.resolve(args['paper-dir']);
  const bibRel = args.bib || path.join('manuscript', 'references.bib');
  const bibPath = path.resolve(paperDir, bibRel);
  if (!fs.existsSync(bibPath)) {
    process.stderr.write(`bib not found: ${bibPath}\n`);
    process.exit(2);
  }
  const entries = parseBib(fs.readFileSync(bibPath, 'utf8'));
  if (!entries.length) {
    process.stderr.write(`no bib entries parsed from ${bibPath}\n`);
    process.exit(2);
  }
  const outPath = path.join(paperDir, 'evidence', 'citation-verification.jsonl');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const results = [];
  for (const entry of entries) {
    const rec = await verifyEntry(entry);
    results.push(rec);
    fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
    const mark = rec.status === 'verified' ? '✓' : (rec.status === 'no_identifier' ? '-' : '✗');
    process.stderr.write(`${mark} ${entry.key.padEnd(24)} ${rec.status.padEnd(14)} ${rec.source || ''}\n`);
  }
  const verified = results.filter((r) => r.status === 'verified').length;
  const summary = {
    ok: true,
    bib: bibRel,
    entries: results.length,
    verified,
    unverified: results.filter((r) => r.status === 'unverified').length,
    no_identifier: results.filter((r) => r.status === 'no_identifier').length,
    jsonl: outPath,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

function cmdGap(args) {
  if (!args['paper-dir']) usage(2);
  const paperDir = path.resolve(args['paper-dir']);
  const texRel = args.tex || path.join('manuscript', 'main.tex');
  const bibRel = args.bib || path.join('manuscript', 'references.bib');
  const texPath = path.resolve(paperDir, texRel);
  const bibPath = path.resolve(paperDir, bibRel);
  if (!fs.existsSync(texPath)) { process.stderr.write(`tex not found: ${texPath}\n`); process.exit(2); }
  if (!fs.existsSync(bibPath)) { process.stderr.write(`bib not found: ${bibPath}\n`); process.exit(2); }
  const tex = fs.readFileSync(texPath, 'utf8');
  const citeKeys = new Set();
  for (const m of tex.matchAll(/\\cite\w*\{([^}]+)\}/g)) {
    for (const k of m[1].split(',')) {
      const t = k.trim();
      if (t) citeKeys.add(t);
    }
  }
  const bibEntries = parseBib(fs.readFileSync(bibPath, 'utf8'));
  const bibKeys = new Set(bibEntries.map((e) => e.key));
  const missing = [...citeKeys].filter((k) => !bibKeys.has(k)).sort();
  const unused = [...bibKeys].filter((k) => !citeKeys.has(k)).sort();
  process.stdout.write(JSON.stringify({
    ok: true,
    tex: texRel,
    bib: bibRel,
    cited: citeKeys.size,
    bib_entries: bibKeys.size,
    missing_from_bib: missing,
    unused_in_bib: unused,
  }, null, 2) + '\n');
}

const args = parseArgs(process.argv.slice(2));
if (args.cmd === 'check') {
  await cmdCheck(args);
} else {
  cmdGap(args);
}
