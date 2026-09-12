// paperlab/lib/tools/venue-match.js
// Match a venue name to its template + submission checklist.

import fs from 'node:fs';
import path from 'node:path';

const TEMPLATES_DIR = path.resolve(process.cwd(), 'skills/submit/venue-templates');

const KNOWN = {
  'methodsx':     { template: 'methodsx',     url: 'https://www.sciencedirect.com/journal/methodsx' },
  'joss':         { template: 'joss',         url: 'https://joss.theoj.org/' },
  'softwarex':    { template: 'softwarex',    url: 'https://www.sciencedirect.com/journal/softwarex' },
  'software-impacts': { template: 'software-impacts', url: 'https://www.sciencedirect.com/journal/software-impacts' },
  'peerj-cs':     { template: 'peerj-cs',     url: 'https://peerj.com/computer-science/' },
  'arxiv':        { template: 'arxiv',        url: 'https://arxiv.org/submit' },
};

export const toolDefinition = {
  name: 'paperlab-venue-match',
  description: 'Map a venue name (case-insensitive) to a template path + checklist + submission URL.',
  parameters: {
    venue: { type: 'string', required: true, description: 'Venue name or short code, e.g. "MethodsX", "joss", "arxiv".' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  handler: async (args, _ctx) => {
    const key = String(args.venue || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const match = KNOWN[key];
    if (!match) {
      return {
        ok: false,
        error: 'venue_not_in_registry',
        message: `venue '${args.venue}' is not in PaperLab's registry. Add it under skills/submit/venue-templates/<name>/SKILL.md`,
        known_venues: Object.keys(KNOWN),
      };
    }
    const templatePath = path.join(TEMPLATES_DIR, match.template);
    return {
      ok: true,
      venue: args.venue,
      templatePath,
      templateExists: fs.existsSync(templatePath),
      submissionUrl: match.url,
    };
  },
};
