---
name: dataset-manifest
description: Write a manifest.json + traceability.json for a dataset. Validates against PaperLab v1 schemas. Use this skill when DataForge acquires or computes a dataset.
metadata:
  paperlab:
    stage: data
    risk_level: medium
    inputs_schema:
      dataset_id: { type: string, required: true, pattern: "^D[0-9]{3,}$" }
      source_path: { type: string, required: true }
      source_type: { enum: [public_download, user_provided, computed] }
      license: { type: string }
    outputs_schema:
      manifest_path: { type: string }
      traceability_path: { type: string }
    depends_on:
      dsh_tools: [tool-bash, tool-fs]
---

# dataset-manifest

Create the two files every empirical PaperLab dataset must have:

1. `evidence/datasets/<dataset_id>/manifest.json` — human-readable dataset card.
2. `evidence/datasets/<dataset_id>/traceability.json` — machine-validated
   against `schemas/v1/experiment-traceability.json`.

## Procedure

1. `sha256sum <source_path>` via `tool-bash` to compute the input checksum.
2. Write `manifest.json` with:
   ```json
   {
     "id": "<dataset_id>",
     "title": "...",
     "description": "...",
     "source_type": "...",
     "source_url": "..." | null,
     "local_path": "...",
     "license": "...",
     "checksum": "sha256:<hex>",
     "bytes": <int>,
     "created_at": "<iso>"
   }
   ```
3. Write `traceability.json` conforming to
   `schemas/v1/experiment-traceability.json`. At minimum: `experiment_id`,
   `inputs[0].pointer`, `inputs[0].checksum`, `code.commit`, `output.pointer`,
   `output.checksum`.
4. Call `paperlab-integrity-check` on both files before declaring done.
5. Append a `claim-evidence-row` to the ledger with
   `evidence_status=supported` and `evidence_artifact.pointer=evidence/datasets/<id>/traceability.json`.

## Risk

- `risk_level: medium` — DataForge must log the run, not silently fail.
- Public-download scripts must declare license before download.
