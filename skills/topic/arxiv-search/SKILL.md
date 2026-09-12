---
name: arxiv-search
description: Search arXiv by query, return title + authors + abstract + arXiv ID + DOI when available. Use this skill when TopicScout needs to find candidate papers.
metadata:
  paperlab:
    stage: topic
    risk_level: low
    inputs_schema:
      query: { type: string, required: true }
      max_results: { type: integer, default: 20 }
      categories: { type: array, items: string }
    outputs_schema:
      hits:
        type: array
        items:
          arxiv_id: string
          title: string
          authors: array
          abstract: string
          doi: string
          primary_category: string
    depends_on:
      dsh_tools: [tool-web]
---

# arxiv-search

Lightweight arXiv search for TopicScout. Uses dsh's built-in `tool-web` to query
`http://export.arxiv.org/api/query` and parses the Atom XML response into a
JSON array.

## Procedure

1. Build the query URL:
   ```
   http://export.arxiv.org/api/query?search_query=all:<query>&max_results=<n>
   ```
2. Call `tool-web` with that URL.
3. Parse `<entry>` blocks. For each, extract:
   - `<id>` (strip the arXiv prefix to get the bare ID)
   - `<title>` (collapse whitespace)
   - `<author><name>` (array)
   - `<summary>` (collapse whitespace)
   - `<arxiv:doi>` if present
   - `<arxiv:primary_category term="...">`
4. Return the JSON array.

## Notes

- arXiv's API has a rate limit (~1 req / 3s). Don't burst.
- `search_query` syntax supports `au:` (author), `ti:` (title), `abs:` (abstract),
  `cat:` (category). Default to `all:` for broad coverage.
- Do not modify the upstream entries; this skill is read-only.
