#!/usr/bin/env node
// paperlab/bin/paperlab.js — CLI front for all 6 PaperLab tools.
//
// Usage:
//   paperlab ledger-read   --ledger <path> [--section X] [--status Y] [--claim-id Z]
//   paperlab ledger-write  --ledger <path> --row '{claim_id:"C001",...}'
//   paperlab integrity-check --mode '<json>'
//   paperlab paper-audit   --batch <path>
//   paperlab venue-match   --venue <name>
//   paperlab topic-search  --source <arxiv|openalex|pubmed> --query <q>
//
// In dsh this script is exposed via the paperlab-cli-wrapper tool, which
// limits tool-bash to only the six subcommands. Outside dsh you can run
// `node bin/paperlab.js ...` directly from any cwd.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const libTools = path.join(ROOT, 'lib', 'tools');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1];
}

function parseRow(s) {
  if (!s) throw new Error('missing --row');
  return JSON.parse(s);
}

function parseMode(s) {
  if (!s) throw new Error('missing --mode');
  return JSON.parse(s);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(`paperlab — PaperLab CLI

commands:
  ledger-read        --ledgerPath <path> [--section S] [--status X] [--claimId C]
  ledger-write       --ledgerPath <path> --row '<json>'
  integrity-check    --mode '<json with single|batch|stage>'
  paper-audit        --batchPath <path>
  venue-match        --venue <name>
  topic-search       --arxivFile <path> [--query <q>] [--max <n>]
  dataset-manifest   --datasetId D001 --title <t> --description <d>
                     --sourceType <public_download|user_provided|computed>
                     --localPath <path> [--sourceUrl <url>]
                     [--license <l>] --paperDir <drafts/paper_x>
                     [--ledgerPath <csv> --claimText <t> --section <s>]
  citation-check     --citationKey <k> [--doi <d>] [--arxivId <a>] [--pmid <p>]
                     [--title <t>] [--paperDir <drafts/paper_x>]
  bib-manage         --paperDir <p> --action <list|add|dedupe|format|gap_analysis>
                     [--citationKey <k>] [--doi <d>] [--arxivId <a>] [--title <t>]
  overlap-check      --pathA <f1> --pathB <f2> [--threshold 0.05] [--sampleN 10000]
  figure-audit       --figurePath <png|jpg|pdf> [--paperDir <p>]
  run-branch         --paperDir <p> --hypothesis <h> --runCommand <bash -lc cmd>
                     [--parentId <B001>] [--novelty 0.5] [--timeoutMs 600000]
  auto-review        --paperDir <p> [--venue <methodsx>]
`);
    process.exit(cmd ? 0 : 1);
  }

  // Dynamic import of the matching tool module
  let mod;
  switch (cmd) {
    case 'ledger-read':
      mod = await import(path.join(libTools, 'ledger-read.js'));
      break;
    case 'ledger-write':
      mod = await import(path.join(libTools, 'ledger-write.js'));
      break;
    case 'integrity-check':
      mod = await import(path.join(libTools, 'integrity-check.js'));
      break;
    case 'paper-audit':
      mod = await import(path.join(libTools, 'paper-audit.js'));
      break;
    case 'venue-match':
      mod = await import(path.join(libTools, 'venue-match.js'));
      break;
    case 'topic-search':
      mod = await import(path.join(libTools, 'topic-search.js'));
      break;
    case 'dataset-manifest':
      mod = await import(path.join(libTools, 'dataset-manifest.js'));
      break;
    case 'citation-check':
      mod = await import(path.join(libTools, 'citation-check.js'));
      break;
    case 'bib-manage':
      mod = await import(path.join(libTools, 'bib-manage.js'));
      break;
    case 'overlap-check':
      mod = await import(path.join(libTools, 'overlap-check.js'));
      break;
    case 'figure-audit':
      mod = await import(path.join(libTools, 'figure-audit.js'));
      break;
    case 'run-branch':
      mod = await import(path.join(libTools, 'run-branch.js'));
      break;
    case 'auto-review':
      mod = await import(path.join(libTools, 'auto-review.js'));
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
  }

  const t = mod.toolDefinition;

  // Marshal argv into the tool's parameters.
  // Every --flag value is captured; aliases below remap a short form to the
  // tool's expected key. Other flags pass through under their own name.
  const ALIASES = {
    'ledger':      'ledgerPath',
    'batch':       'batchPath',
    'ledgerPath':  'ledgerPath',
    'batchPath':   'batchPath',
    'ledgerpath':  'ledgerPath',
    'batchpath':   'batchPath',
    'claim-id':    'claimId',
    'claimId':     'claimId',
    'claimid':     'claimId',
  };
  const aliasToKey = ALIASES;

  const params = {};
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const flag = a.slice(2);
    let key = aliasToKey[flag] || flag;
    // camelCase flag → camelCase key, kebab-case flag → camelCase key
    if (aliasToKey[flag] === undefined && flag.includes('-')) {
      key = flag.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    }
    let raw = process.argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) continue;
    if (key === 'row' || key === 'mode') {
      try { raw = JSON.parse(raw); } catch (e) { /* leave as string */ }
    }
    params[key] = raw;
  }

  // Special-case commands whose handler signatures are (args, ctx)
  const result = await t.handler(params, { cwd: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error('paperlab:', e.message);
  if (process.env.PAPERLAB_DEBUG) console.error(e.stack);
  process.exit(1);
});
