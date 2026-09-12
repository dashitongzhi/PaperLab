// paperlab/lib/tools/bib-manage.js
// BibTeX management: list / add / dedupe / format / gap_analysis.
// Uses citecheck-style 2-stage resolution (CrossRef → arXiv) for `add`.

import fs from 'node:fs';
import path from 'node:path';
import { verifyCitation } from './citation-check.js';

export const toolDefinition = {
  name: 'paperlab-bib-manage',
  description: [
    'BibTeX management over refs/refs.bib.',
    'Actions:',
    '  list          — return every @entry with key, type, title, year.',
    '  add           — resolve a citation via CrossRef/arXiv, append to refs.bib.',
    '  dedupe        — remove duplicate @entry (same DOI / arXiv ID).',
    '  format        — re-format every entry (collapse whitespace, normalize authors).',
    '  gap_analysis  — return \\\\cite{} keys in manuscript missing from refs.bib.',
  ].join(' '),
  parameters: {
    paperDir: { type: 'string', required: true },
    action:   { type: 'string', enum: ['list', 'add', 'dedupe', 'format', 'gap_analysis'], required: true },
    citationKey: { type: 'string', description: 'For action=add: new BibTeX key.' },
    doi:         { type: 'string' },
    arxivId:     { type: 'string' },
    title:       { type: 'string' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  async handler(args, _ctx) {
    const refsPath = path.join(args.paperDir, 'refs', 'refs.bib');
    fs.mkdirSync(path.dirname(refsPath), { recursive: true });

    switch (args.action) {
      case 'list':     return { ok: true, entries: listEntries(refsPath) };
      case 'add':      return addEntry(refsPath, args);
      case 'dedupe':   return dedupeEntries(refsPath);
      case 'format':   return { ok: true, formatted: formatBib(refsPath) };
      case 'gap_analysis': {
        const used = new Set(citeKeysInManuscript(args.paperDir));
        const have = new Set(listEntries(refsPath).map(e => e.key));
        const missing = [...used].filter(k => !have.has(k));
        return { ok: true, used_keys: [...used], known_keys: [...have], missing };
      }
      default: throw new Error(`unknown action: ${args.action}`);
    }
  },
};

// ─── entry parsing ───────────────────────────────────────────────────────

function parseBib(text) {
  const entries = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const type = m[1].toLowerCase();
    const key = m[2];
    const body = m[3];
    const fields = {};
    for (const fm of body.matchAll(/(\w+)\s*=\s*\{([^{}]*)\}/g)) {
      fields[fm[1].toLowerCase()] = fm[2].trim().replace(/\s+/g, ' ');
    }
    entries.push({ type, key, fields, raw: m[0] });
  }
  return entries;
}

function serializeEntry(entry) {
  const fields = Object.entries(entry.fields)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(',\n');
  return `@${entry.type}{${entry.key},\n${fields}\n}`;
}

function listEntries(refsPath) {
  if (!fs.existsSync(refsPath)) return [];
  return parseBib(fs.readFileSync(refsPath, 'utf8'))
    .map(e => ({
      key: e.key,
      type: e.type,
      title: e.fields.title || null,
      year:  e.fields.year  || null,
      doi:   e.fields.doi   || null,
    }));
}

async function addEntry(refsPath, { citationKey, doi, arxivId, title }) {
  if (!citationKey) throw new Error('citationKey required for action=add');
  const v = await verifyCitation({ doi, arxivId, title });
  if (v.status === 'cannot_locate' || v.status === 'unverified') {
    return { ok: false, error: 'verification_failed', verification: v };
  }
  const entry = {
    type: v.source === 'arxiv' || v.source === 'arxiv-title-search' ? 'article' : 'article',
    key: citationKey,
    fields: {
      title: v.title || '',
      author: (v.authors || []).join(' and '),
      year:  v.year ? String(v.year) : '',
      doi:   v.doi || '',
      ...(v.arxiv_id ? { eprint: v.arxiv_id, archivePrefix: 'arXiv' } : {}),
      url: v.url || '',
    },
  };
  const existing = fs.existsSync(refsPath) ? fs.readFileSync(refsPath, 'utf8') : '';
  const newEntry = serializeEntry(entry) + '\n\n';
  fs.writeFileSync(refsPath, existing + newEntry);
  return { ok: true, entry, verification: v };
}

function dedupeEntries(refsPath) {
  if (!fs.existsSync(refsPath)) return { ok: true, removed: 0 };
  const text = fs.readFileSync(refsPath, 'utf8');
  const entries = parseBib(text);
  const seen = new Map();
  const kept = [];
  let removed = 0;
  for (const e of entries) {
    const sig = e.fields.doi || e.fields.eprint || e.key;
    if (seen.has(sig)) { removed++; continue; }
    seen.set(sig, true);
    kept.push(e);
  }
  const out = kept.map(serializeEntry).join('\n\n') + '\n';
  fs.writeFileSync(refsPath, out);
  return { ok: true, total_before: entries.length, total_after: kept.length, removed };
}

function formatBib(refsPath) {
  if (!fs.existsSync(refsPath)) return '';
  const entries = parseBib(fs.readFileSync(refsPath, 'utf8'));
  return entries.map(serializeEntry).join('\n\n') + '\n';
}

// ─── \cite{} scanner ─────────────────────────────────────────────────────

function citeKeysInManuscript(paperDir) {
  const keys = new Set();
  const candidates = ['manuscript/main.tex', 'manuscript/main.md', 'manuscript/paper.md', 'drafts/04_draft.md'];
  for (const rel of candidates) {
    const p = path.join(paperDir, rel);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/\\cite(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
      for (const k of m[1].split(/,\s*/)) keys.add(k.trim());
    }
  }
  return [...keys];
}
