// paperlab/lib/tools/topic-search.js
// v0.4: real arXiv Atom XML parser. Reads a local file (fetched via dsh
// tool-web or curl) and returns structured hits.

import fs from 'node:fs';

export const toolDefinition = {
  name: 'paperlab_topic_search',
  description: [
    'Structured arXiv search. Reads a local Atom XML file (downloaded by the',
    'agent via dsh tool-web or curl) and returns hits with title, authors,',
    'abstract, arXiv ID, DOI. Use --arxiv-file to point at a saved arXiv query',
    'response. Example fetch:',
    '  curl -sL "https://export.arxiv.org/api/query?search_query=all:X&max_results=10" > /tmp/x.xml',
    '  paperlab topic-search --arxiv-file /tmp/x.xml',
    'In sandboxed environments the agent should download via dsh tool-web first.',
  ].join(' '),
  parameters: {
    arxivFile: { type: 'string', description: 'Path to a saved arXiv Atom XML response.' },
    query:     { type: 'string', description: 'Original query (recorded in literature-provenance).' },
    max:       { type: 'integer', default: 20 },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async handler(args, _ctx) {
    if (!args.arxivFile || !fs.existsSync(args.arxivFile)) {
      return {
        ok: false,
        error: 'arxiv_file_missing',
        message: `file not found: ${args.arxivFile}. Download arxiv XML first via dsh tool-web, then call again.`,
        hint: 'curl -sL "https://export.arxiv.org/api/query?search_query=all:GSEA&max_results=20" > /tmp/x.xml',
        hits: [],
        query: args.query,
      };
    }
    const xml = fs.readFileSync(args.arxivFile, 'utf8');
    const hits = parseArxivAtom(xml);
    return {
      ok: true,
      query: args.query,
      file: args.arxivFile,
      total_returned: hits.length,
      hits: hits.slice(0, args.max ?? 20),
    };
  },
};

function parseArxivAtom(xml) {
  const hits = [];
  // arXiv Atom XML uses <entry> per paper
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const id = pick(e, /<id>([\s\S]*?)<\/id>/);
    const title = collapse(pick(e, /<title>([\s\S]*?)<\/title>/));
    const summary = collapse(pick(e, /<summary>([\s\S]*?)<\/summary>/));
    const published = pick(e, /<published>([\s\S]*?)<\/published>/);
    const updated = pick(e, /<updated>([\s\S]*?)<\/updated>/);
    const doi = pick(e, /<arxiv:doi>([\s\S]*?)<\/arxiv:doi>/);
    const journalRef = pick(e, /<arxiv:journal_ref>([\s\S]*?)<\/arxiv:journal_ref>/);
    const primaryCat = (e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1];

    const authors = [];
    const aRe = /<author>\s*<name>([\s\S]*?)<\/name>/g;
    let am;
    while ((am = aRe.exec(e)) !== null) authors.push(collapse(am[1]));

    // arXiv ID is the trailing path of <id>: http://arxiv.org/abs/2401.01234v1
    const arxivId = (id.match(/abs\/(.+?)(v\d+)?$/) || [])[1] || null;
    const version = (id.match(/v(\d+)$/) || [])[1] || null;

    hits.push({
      arxiv_id: arxivId,
      version: version ? Number(version) : null,
      title,
      authors,
      abstract: summary,
      published,
      updated,
      doi: doi || null,
      journal_ref: journalRef || null,
      primary_category: primaryCat || null,
      url: id,
    });
  }
  return hits;
}

function pick(s, re) {
  const m = s.match(re);
  return m ? m[1].trim() : '';
}
function collapse(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}
