---
name: enrichment-consistency
description: |
  Compare ORA and preranked GSEA results across gseapy, enrichr, and
  g:Profiler on a user-provided DE input. Used by paper4 in the
  PaperLab example. Wraps the paperlab CLI tools:
  paperlab topic-search, paperlab dataset-manifest, paperlab ledger-write.
metadata:
  paperlab:
    stage: data
    risk_level: medium
    inputs_schema:
      de_table:
        type: string
        required: true
        description: Path to a TSV with columns gene, log2fc, padj
      tools:
        type: array
        enum: [gseapy_ora, gseapy_prerank, gprofiler]
        default: [gseapy_ora, gseapy_prerank, gprofiler]
    outputs_schema:
      concordance_matrix:
        type: string
        description: Path to outputs/concordance.csv
      disagreement_drivers:
        type: string
        description: Path to outputs/drivers.json
---

# enrichment-consistency

Compare pathway-enrichment results across three GSEA tools on the same DE
input. Writes one row to the claim-evidence ledger per cross-tool
comparison.

## Procedure

1. Validate `de_table` via `paperlab dataset-manifest --datasetId D<n> ...`.
2. For each tool in `tools`, run its ORA + (where supported) preranked GSEA.
3. Compare top-K pathways pairwise; write concordance matrix.
4. For each pair of tools that disagree, write a ledger row classifying the
   driver (gene-set size filter, multiple-testing correction, ranking metric,
   background gene set).

## Risk

`risk_level: medium` — runs Python that touches user-provided files. The
manifest's `tests/` should include a smoke run on the bundled synthetic
DE input.
