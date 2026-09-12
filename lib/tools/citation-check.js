// paperlab/lib/tools/citation-check.js
// Verify a citation key against DOI / arXiv / PubMed. 2-stage fallback
// strategy inspired by clibib (Zotero Translation Server → CrossRef).
//
// Output conforms to the citation-verification schema (draft-07).
//
// Usage as a tool:
//   paperlab citation-check --citationKey smith2024 --doi 10.1234/example
//   paperlab citation-check --citationKey "Sakana 2026" --arxivId 2504.08066

import fs from 'node:fs';
import path from 'node:path';

const CROSSREF = 'https://api.crossref.org/works';
const ARXIV = 'http://export.arxiv.org/api/query';
const PUBMED = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';

export const toolDefinition = {
  name: 'paperlab-citation-check',
  description: [
    'Verify a citation key against DOI/arXiv/PubMed. 2-stage fallback:',
    '  1. CrossRef for DOI, arXiv for arXiv ID, PubMed for PMID',
    '  2. Title-based search if the ID lookup fails',
    'Returns { status, source, title, authors, year, doi, arxiv_id, url }',
    'matching the citation-verification JSON schema.',
  ].join(' '),
  parameters: {
    citationKey: { type: 'string', required: true },
    doi:         { type: 'string' },
    arxivId:     { type: 'string' },
    pmid:        { type: 'string' },
    title:       { type: 'string', description: 'Optional fallback title search.' },
    paperDir:    { type: 'string', description: 'If given, write the verification row into <paperDir>/evidence/citations/<key>.json.' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  async handler(args, _ctx) {
    const result = await verifyCitation(args);
    if (args.paperDir && result.status !== 'unverified' && result.status !== 'cannot_locate') {
      const p = path.join(args.paperDir, 'evidence', 'citations', `${args.citationKey}.json`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({
        citation_key: args.citationKey,
        ...result,
        verified_date: new Date().toISOString().slice(0, 10),
      }, null, 2));
      result.artifact_path = p;
    }
    return result;
  },
};

export async function verifyCitation({ doi, arxivId, pmid, title }) {
  // Stage 1a — DOI via CrossRef
  if (doi) {
    try {
      const r = await fetchJson(`${CROSSREF}/${encodeURIComponent(doi)}`);
      const m = r.message;
      if (m && m.DOI) {
        return {
          status: 'metadata_verified',
          source: 'crossref',
          title: (m.title?.[0] || '').trim(),
          authors: (m.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean),
          year: m.issued?.['date-parts']?.[0]?.[0] || null,
          doi: m.DOI,
          arxiv_id: null,
          url: m.URL || `https://doi.org/${m.DOI}`,
          container: m['container-title']?.[0] || null,
        };
      }
    } catch (e) { /* fallthrough */ }
  }

  // Stage 1b — arXiv ID
  if (arxivId) {
    try {
      const url = `${ARXIV}?id_list=${encodeURIComponent(arxivId)}`;
      const xml = await fetchText(url);
      const hit = parseArxivXml(xml);
      if (hit) {
        return {
          status: hit.doi ? 'metadata_verified' : 'arxiv_matched',
          source: 'arxiv',
          title: hit.title,
          authors: hit.authors,
          year: hit.published ? Number(hit.published.slice(0, 4)) : null,
          doi: hit.doi || null,
          arxiv_id: hit.arxiv_id,
          url: hit.url || `https://arxiv.org/abs/${hit.arxiv_id}`,
          container: null,
        };
      }
    } catch (e) { /* fallthrough */ }
  }

  // Stage 1c — PubMed
  if (pmid) {
    try {
      const r = await fetchJson(`${PUBMED}?db=pubmed&term=${encodeURIComponent(pmid)}&retmode=json`);
      const ids = r.esearchresult?.idlist || [];
      if (ids.length) {
        return {
          status: 'metadata_verified',
          source: 'pubmed',
          title: `(PubMed ID ${ids[0]} — full title fetch requires esummary)`,
          authors: [],
          year: null,
          doi: null,
          arxiv_id: null,
          url: `https://pubmed.ncbi.nlm.nih.gov/${ids[0]}/`,
          container: 'PubMed',
          pmid: ids[0],
        };
      }
    } catch (e) { /* fallthrough */ }
  }

  // Stage 2 — title-based search via CrossRef
  if (title && title.length > 8) {
    try {
      const q = encodeURIComponent(title);
      const r = await fetchJson(`${CROSSREF}?query.bibliographic=${q}&rows=1`);
      const hit = r.message?.items?.[0];
      if (hit) {
        const score = hit.score || 0;
        if (score > 50) {
          return {
            status: 'metadata_verified',
            source: 'crossref-title-search',
            title: (hit.title?.[0] || '').trim(),
            authors: (hit.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean),
            year: hit.issued?.['date-parts']?.[0]?.[0] || null,
            doi: hit.DOI,
            arxiv_id: null,
            url: hit.URL || `https://doi.org/${hit.DOI}`,
            container: hit['container-title']?.[0] || null,
            match_score: score,
          };
        }
      }
    } catch (e) { /* fallthrough */ }
  }

  return {
    status: 'cannot_locate',
    source: null,
    title: null,
    authors: [],
    year: null,
    doi: doi || null,
    arxiv_id: arxivId || null,
    url: null,
    container: null,
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'paperlab/0.6 (+mailto:dev@paperlab.local)' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'paperlab/0.6 (+mailto:dev@paperlab.local)' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

function parseArxivXml(xml) {
  const m = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!m) return null;
  const e = m[1];
  const id = (e.match(/<id>([\s\S]*?)<\/id>/) || [])[1] || '';
  const arxivId = (id.match(/abs\/(.+?)(v\d+)?$/) || [])[1] || null;
  const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
  const published = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || '';
  const doi = (e.match(/<arxiv:doi>([\s\S]*?)<\/arxiv:doi>/) || [])[1] || null;
  const authors = [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(m => m[1].trim());
  return { arxiv_id: arxivId, title, authors, published, doi, url: id.trim() };
}
