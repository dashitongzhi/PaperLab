// paperlab/lib/tools/ledger-read.js
// Read rows from the ClaimEvidenceLedger.

import { ClaimEvidenceLedger } from '../integrity/ledger.js';

export const toolDefinition = {
  name: 'paperlab-ledger-read',
  description: 'Read rows from drafts/<paper_id>/evidence/claim_evidence_ledger.csv. Filters by section / status.',
  parameters: {
    ledgerPath: { type: 'string', description: 'Absolute path to the ledger.csv file.' },
    section:   { type: 'string', enum: ['abstract','intro','methods','results','discussion','conclusion','supplementary'] },
    status:    { type: 'string', enum: ['supported','unsupported','gap','draft'] },
    claimId:   { type: 'string' },
  },
  handler: async (args, _ctx) => {
    const ledger = new ClaimEvidenceLedger(args.ledgerPath);
    if (args.claimId) {
      const row = ledger.get(args.claimId);
      return { ok: !!row, row, summary: ledger.summary() };
    }
    let rows = ledger.rows;
    if (args.section) rows = rows.filter(r => r.section === args.section);
    if (args.status)  rows = rows.filter(r => r.evidence_status === args.status);
    return { ok: true, rows, summary: ledger.summary() };
  },
};
