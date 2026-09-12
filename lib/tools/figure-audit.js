// paperlab/lib/tools/figure-audit.js
// Send a figure (PNG/JPEG/PDF) to a vision model (default GPT-4o via
// CLIProxyAPI on 127.0.0.1:8317) and ask it to spot missing axis labels,
// illegible legends, or placeholder content.

import fs from 'node:fs';
import path from 'node:path';

const VISION_ENDPOINT = process.env.PAPERLAB_VISION_ENDPOINT
  || 'http://127.0.0.1:8317/v1/chat/completions';
const VISION_MODEL = process.env.PAPERLAB_VISION_MODEL || 'gpt-4o';

export const toolDefinition = {
  name: 'paperlab-figure-audit',
  description: [
    'Audit a figure with a vision model. Returns {ok, missing, suggestions}.',
    'Default model: gpt-4o via local CLIPROXY at :8317.',
    'Override with PAPERLAB_VISION_MODEL / PAPERLAB_VISION_ENDPOINT.',
  ].join(' '),
  parameters: {
    figurePath: { type: 'string', required: true },
    paperDir:   { type: 'string', description: 'Optional; writes audit_report.md alongside figure.' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  async handler(args, _ctx) {
    if (!fs.existsSync(args.figurePath)) return { ok: false, error: 'figure_not_found' };
    const buf = fs.readFileSync(args.figurePath);
    const b64 = buf.toString('base64');
    const mime = args.figurePath.endsWith('.png') ? 'image/png'
              : args.figurePath.endsWith('.jpg') || args.figurePath.endsWith('.jpeg') ? 'image/jpeg'
              : args.figurePath.endsWith('.pdf') ? 'application/pdf'
              : 'application/octet-stream';

    const body = {
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: [
            'You are auditing a figure from a scientific paper. Respond',
            'ONLY with JSON: {"ok": bool, "missing": [strings], "suggestions": [strings]}.',
            'Look for: (1) missing axis labels, (2) illegible legend,',
            '(3) placeholder text like "TODO" / "Conclusions Here",',
            '(4) blank panels, (5) inconsistent units. Be terse.',
          ].join(' ') },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      }],
      temperature: 0,
      max_tokens: 600,
    };
    try {
      const r = await fetch(VISION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false, error: `vision_endpoint_${r.status}` };
      const j = await r.json();
      const txt = j.choices?.[0]?.message?.content || '';
      const parsed = parseJsonFromModel(txt);
      const result = {
        ok: parsed.ok ?? false,
        missing: parsed.missing || [],
        suggestions: parsed.suggestions || [],
        raw_response: txt,
      };
      if (args.paperDir) {
        const out = path.join(path.dirname(args.figurePath), 'figure_audit.json');
        fs.writeFileSync(out, JSON.stringify(result, null, 2));
        result.audit_path = out;
      }
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

function parseJsonFromModel(txt) {
  // Tolerate ```json fences.
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false };
  try { return JSON.parse(m[0]); } catch { return { ok: false }; }
}
