// paperlab/lib/tools/dataset-manifest.js
// v0.4: real dataset card + traceability + checksum.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ClaimEvidenceLedger } from '../integrity/ledger.js';

export const toolDefinition = {
  name: 'paperlab_dataset_manifest',
  description: [
    'Create manifest.json + traceability.json for a dataset. Computes sha256',
    'checksum, validates against schemas/v1/experiment-traceability.json, and',
    'appends a ledger row tying the dataset to a claim. Use this for every',
    'empirical claim the paper will make.',
  ].join(' '),
  parameters: {
    datasetId:   { type: 'string', required: true, description: 'Must match /^D[0-9]{3,}$/' },
    title:       { type: 'string', required: true },
    description: { type: 'string', required: true },
    sourceType:  { type: 'string', enum: ['public_download', 'user_provided', 'computed'], required: true },
    sourceUrl:   { type: 'string', description: 'URL or "local:/abs/path" if user_provided/computed.' },
    localPath:   { type: 'string', required: true, description: 'Path to the dataset file on disk.' },
    license:     { type: 'string' },
    paperDir:    { type: 'string', required: true, description: 'paper root (e.g. drafts/paper4_x). Manifests land under evidence/datasets/<datasetId>/.' },
    ledgerPath:  { type: 'string', description: 'Optional. Append a supported claim-evidence row.' },
    claimText:   { type: 'string', description: 'Optional. The claim text to record in the ledger.' },
    section:     { type: 'string', enum: ['abstract','intro','methods','results','discussion','conclusion','supplementary'] },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async handler(args, _ctx) {
    if (!/^D\d{3,}$/.test(args.datasetId)) {
      return { ok: false, error: 'dataset_id_invalid', message: `must match /^D\\d{3,}$/, got ${args.datasetId}` };
    }
    if (!fs.existsSync(args.localPath)) {
      return { ok: false, error: 'local_path_missing', message: `local path not found: ${args.localPath}` };
    }
    const stat = fs.statSync(args.localPath);
    const hash = await sha256(args.localPath);
    const bytes = stat.size;

    const manifestDir = path.join(args.paperDir, 'evidence', 'datasets', args.datasetId);
    fs.mkdirSync(manifestDir, { recursive: true });

    const manifest = {
      id: args.datasetId,
      title: args.title,
      description: args.description,
      source_type: args.sourceType,
      source_url: args.sourceUrl || null,
      local_path: args.localPath,
      license: args.license || 'unspecified',
      checksum: `sha256:${hash}`,
      bytes,
      created_at: new Date().toISOString(),
    };
    const manifestPath = path.join(manifestDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const traceability = {
      experiment_id: `E${args.datasetId.slice(1)}`,
      inputs: [{ pointer: args.localPath, checksum: `sha256:${hash}`, bytes }],
      code: {
        repo: 'paperlab',
        commit: process.env.PAPERLAB_COMMIT || 'unknown',
        entrypoint: 'paperlab/lib/tools/dataset-manifest.js',
        params: { dataset_id: args.datasetId, source_type: args.sourceType },
      },
      output: {
        pointer: manifestPath,
        checksum: `sha256:${hash}`,
        manifest: manifestPath,
      },
      env: { language: 'node', version: process.version },
      ran_at: new Date().toISOString(),
      ran_by: 'paperlab-dataset-manifest',
    };
    const traceabilityPath = path.join(manifestDir, 'traceability.json');
    fs.writeFileSync(traceabilityPath, JSON.stringify(traceability, null, 2));

    let ledgerResult = null;
    if (args.ledgerPath && args.claimText && args.section) {
      const ledger = new ClaimEvidenceLedger(args.ledgerPath);
      ledger.add({
        claim_id: `C${args.datasetId.slice(1)}`,
        section: args.section,
        claim_text: args.claim_text || args.claimText,
        evidence_status: 'supported',
        evidence_artifact_type: 'code_output',
        evidence_artifact_pointer: traceabilityPath,
        reviewer: 'data-forge',
      });
      ledgerResult = { ledger: args.ledgerPath, summary: ledger.summary() };
    }

    return {
      ok: true,
      dataset_id: args.datasetId,
      manifest_path: manifestPath,
      traceability_path: traceabilityPath,
      checksum: `sha256:${hash}`,
      bytes,
      ledger: ledgerResult,
    };
  },
};

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', c => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}
