---
name: biorxiv-fetch
description: |
  Fetch a preprint's metadata from bioRxiv by DOI, return title / authors /
  abstract / version history / license. Used during the topic stage of a
  PaperLab run when the source is a bioRxiv preprint rather than an
  arXiv paper.
metadata:
  paperlab:
    stage: topic
    risk_level: low
    inputs_schema:
      doi:
        type: string
        required: true
    outputs_schema:
      preprint:
        type: string
        description: Path to outputs/<doi-sanitized>.json
---

# biorxiv-fetch

Read-only metadata fetcher for bioRxiv preprints. Complements
`paperlab_topic_search` which only handles arXiv. Use when the candidate
paper is a life-science preprint on bioRxiv.

## Procedure

1. GET `https://api.biorxiv.org/pubs/{doi}` (no API key required).
2. Cache the JSON response under `<paper_dir>/outputs/biorxiv/<doi-sanitized>.json`.
3. Return parsed title / authors / abstract / license.

## Risk

`risk_level: low`. Network GET only; cached on disk for reproducibility.
