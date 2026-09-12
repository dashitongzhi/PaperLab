// paperlab/lib/tools/overlap-check.js
// Detect train/test overlap between two datasets via row-hash intersection.
// Reads dataset files line by line, sha256-hashes each row, computes Jaccard
// index between the two row-hash sets. Refuses if jaccard > threshold.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const toolDefinition = {
  name: 'paperlab-overlap-check',
  description: [
    'Detect overlap between two dataset files by row-hash intersection.',
    'Refuses if jaccard index > threshold (default 0.05 = 5%).',
    'Useful for catching train/test leakage before publication.',
  ].join(' '),
  parameters: {
    pathA:     { type: 'string', required: true },
    pathB:     { type: 'string', required: true },
    threshold: { type: 'number', default: 0.05 },
    sampleN:   { type: 'integer', default: 10000, description: 'Cap on rows per file (memory bound).' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  async handler(args, _ctx) {
    const [hashesA, hashesB] = await Promise.all([
      hashRows(args.pathA, args.sampleN ?? 10000),
      hashRows(args.pathB, args.sampleN ?? 10000),
    ]);
    const setB = new Set(hashesB);
    let inter = 0;
    for (const h of hashesA) if (setB.has(h)) inter++;
    const uni = hashesA.length + hashesB.length - inter;
    const jaccard = uni > 0 ? inter / uni : 0;
    return {
      ok: true,
      path_a: args.pathA, rows_a: hashesA.length,
      path_b: args.pathB, rows_b: hashesB.length,
      intersection: inter,
      union: uni,
      jaccard,
      threshold: args.threshold ?? 0.05,
      refuses: jaccard > (args.threshold ?? 0.05),
    };
  },
};

async function hashRows(p, max) {
  if (!fs.existsSync(p)) throw new Error(`file not found: ${p}`);
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0).slice(0, max);
  return lines.map(l => crypto.createHash('sha256').update(l).digest('hex'));
}
