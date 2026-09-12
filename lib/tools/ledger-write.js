// paperlab/lib/tools/ledger-write.js
// Append / update a row in the ClaimEvidenceLedger.

import { ClaimEvidenceLedger } from '../integrity/ledger.js';
import { IntegrityChecker } from '../integrity/checker.js';

export const toolDefinition = {
  name: 'paperlab-ledger-write',
  description: 'Add or update a claim-evidence-row in the ledger. Auto-validates against the v1 JSON Schema before saving.',
  parameters: {
    ledgerPath: { type: 'string', required: true },
    row: {
      type: 'object',
      required: true,
      additionalProperties: true,
      description: 'A claim-evidence-row object. Required: claim_id, section, claim_text, evidence_status.',
      properties: {
        claim_id:    { type: 'string', required: true },
        section:     { type: 'string', required: true, enum: ['abstract','intro','methods','results','discussion','conclusion','supplementary'] },
        claim_text:  { type: 'string', required: true },
        evidence_status: { type: 'string', required: true, enum: ['supported','unsupported','gap','draft'] },
        evidence_artifact_type: { type: 'string', enum: ['table','figure','code_output','literature','human_review','external_url'] },
        evidence_artifact_pointer: { type: 'string' },
        reviewer:   { type: 'string' },
        notes:      { type: 'string' },
      },
    },
  },
  handler: async (args, _ctx) => {
    const checker = await IntegrityChecker.create();
    const dataObj = {
      claim_id: args.row.claim_id,
      section:  args.row.section,
      claim_text: args.row.claim_text,
      evidence_status: args.row.evidence_status,
      evidence_artifact: args.row.evidence_artifact_type
        ? { type: args.row.evidence_artifact_type, pointer: args.row.evidence_artifact_pointer }
        : undefined,
      reviewer: args.row.reviewer,
      notes: args.row.notes,
    };
    const validation = checker.validate('claim-evidence-row', dataObj);
    if (!validation.ok) {
      return { ok: false, error: 'schema_validation_failed', errors: validation.errors };
    }
    const ledger = new ClaimEvidenceLedger(args.ledgerPath);
    ledger.add(args.row);
    return { ok: true, saved: args.row, summary: ledger.summary() };
  },
};
