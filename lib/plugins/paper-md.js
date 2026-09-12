// paperlab/lib/plugins/paper-md.js
// Load PAPERLAB.md from a paper directory at session start.
// Convention: PAPERLAB.md in the paper root has:
//
//   ## research_question
//   ...
//
//   ## target_venue
//   methodsx
//
//   ## hard_constraints
//   - ...
//
//   ## related_work
//   - ...
//
//   ## methodology_choice
//   ...
//
// The first 4 KB is appended to the paperlab-pipeline system prompt section.

import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 4096;

export function loadPaperLabMd(paperDir) {
  if (!paperDir) return null;
  const p = path.join(paperDir, 'PAPERLAB.md');
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8').slice(0, MAX_BYTES);
  return { path: p, text, truncated: fs.statSync(p).size > MAX_BYTES };
}

/**
 * Format the PAPERLAB.md as a system prompt section.
 * Returns null if no PAPERLAB.md present.
 */
export function paperLabMdAsPromptSection(paperDir) {
  const md = loadPaperLabMd(paperDir);
  if (!md) return null;
  return [
    '---',
    'PAPERLAB.md (user-provided project memory):',
    '',
    md.text,
    '',
    '(End of PAPERLAB.md. Treat the research_question / target_venue /',
    'hard_constraints / methodology_choice fields as authoritative for',
    'this paper; do not pick a conflicting topic.)',
  ].join('\n');
}
