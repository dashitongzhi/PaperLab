---
name: citation-check
description: Verify a citation key against DOI / arXiv / Crossref. Used by PaperAuditor to confirm every \cite{...} in the draft resolves to a real work.
metadata:
  paperlab:
    stage: audit
    risk_level: low
    inputs_schema:
      citation_key: { type: string, required: true }
      doi: { type: string }
      arxiv_id: { type: string }
      bibtex_entry: { type: string }
    outputs_schema:
      status:
        enum: [unverified, doi_matched, arxiv_matched, metadata_verified,
               full_text_verified, retracted, cannot_locate]
      verified_at: { type: string, format: date-time }
      resolved_url: { type: string }
      notes: { type: string }
    depends_on:
      dsh_tools: [tool-web, tool-bash]
---

# citation-check

Resolve one citation key to a real, retrievable work and write one
`citation-verification` artifact.

## Procedure

1. Look up the key in `refs/refs.bib`. Extract DOI / arXiv ID / URL.
2. If DOI present: call `https://api.crossref.org/works/<doi>`. On 200, status
   = `doi_matched`. On 404, status = `cannot_locate`. If the work has
   `is-update: true` or matches Retraction Watch data, status = `retracted`.
3. If arXiv ID present: call `http://export.arxiv.org/api/query?id_list=<id>`.
   On 200, status = `arxiv_matched`.
4. If both: status = `metadata_verified` once Crossref returns title + author
   matching the bibtex entry. `full_text_verified` requires the user to
   confirm reading the PDF (this skill cannot read PDFs).
5. Write `<paper_id>/evidence/citations/<key>.json` with the result.
6. Append a `claim-evidence-row` to the ledger with
   `evidence_status=supported` and `evidence_artifact.type=literature`.

## Hard rule

A citation with status `unverified` / `cannot_locate` / `retracted` MUST NOT
be cited as supporting evidence. The PaperAuditor sub-agent will treat any
such citation in the draft as a hard block.
