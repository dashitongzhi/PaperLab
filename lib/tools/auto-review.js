// paperlab/lib/tools/auto-review.js
// LLM-as-judge: ask a model to score the paper against a venue's review form.
// Cheap, single call, returns { score, weaknesses, strengths, conditional_pass }.

import fs from 'node:fs';
import path from 'path';

const LLM_ENDPOINT = process.env.PAPERLAB_LLM_ENDPOINT
  || 'http://127.0.0.1:8317/v1/chat/completions';
const LLM_MODEL = process.env.PAPERLAB_LLM_MODEL || 'gpt-5.6-sol';

const REVIEW_FORMS = {
  methodsx:  { criteria: ['reproducibility', 'protocol clarity', 'novelty', 'presentation'], passing: 6.5 },
  joss:      { criteria: ['installation', 'usage', 'code quality', 'tests'], passing: 7.0 },
  arxiv:     { criteria: ['novelty', 'soundness', 'clarity', 'impact'], passing: 5.0 },
  default:   { criteria: ['clarity', 'novelty', 'soundness', 'reproducibility'], passing: 6.5 },
};

export const toolDefinition = {
  name: 'paperlab-auto-review',
  description: [
    'LLM-as-judge review against the target venue. Reads the manuscript,',
    'ledger, and audit report. Returns { score, weaknesses, strengths,',
    'conditional_pass, threshold }. Score < threshold → conditional_pass=false.',
  ].join(' '),
  parameters: {
    paperDir: { type: 'string', required: true },
    venue:    { type: 'string', default: 'default' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  async handler(args, _ctx) {
    const form = REVIEW_FORMS[args.venue] || REVIEW_FORMS.default;
    const manuscript = readMaybe(path.join(args.paperDir, 'manuscript', 'main.tex'))
                    || readMaybe(path.join(args.paperDir, 'drafts', '04_draft.md'))
                    || '';
    const ledger = readMaybe(path.join(args.paperDir, 'evidence', 'claim_evidence_ledger.csv')) || '';
    const audit  = readMaybe(path.join(args.paperDir, 'checks', 'audit_report.md')) || '';
    const body = {
      model: LLM_MODEL,
      messages: [{
        role: 'user',
        content: [
          `You are a peer reviewer for ${args.venue}. Score the paper 1-10 on:`,
          ...form.criteria.map(c => `  - ${c}`),
          '',
          'Respond ONLY with JSON: {"score": number, "weaknesses": [string],',
          '  "strengths": [string]}. No prose.',
          '',
          '--- manuscript (first 4000 chars) ---',
          manuscript.slice(0, 4000),
          '',
          '--- ledger summary ---',
          ledger.slice(0, 1500),
          '',
          '--- audit ---',
          audit.slice(0, 1500),
        ].join('\n'),
      }],
      temperature: 0,
      max_tokens: 800,
    };
    try {
      const r = await fetch(LLM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false, error: `llm_${r.status}` };
      const j = await r.json();
      const txt = j.choices?.[0]?.message?.content || '';
      const parsed = parseJson(txt);
      const score = Number(parsed.score || 0);
      return {
        ok: true,
        venue: args.venue,
        score,
        threshold: form.passing,
        conditional_pass: score >= form.passing,
        weaknesses: parsed.weaknesses || [],
        strengths: parsed.strengths || [],
        raw: txt,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

function readMaybe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}
function parseJson(txt) {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}
