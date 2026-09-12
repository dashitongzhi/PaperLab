---
name: venue-templates
description: Look up the submission template, cover-letter template, and pre-submission checklist for a target venue (MethodsX, JOSS, SoftwareX, Software Impacts, PeerJ CS, arXiv).
metadata:
  paperlab:
    stage: submit
    risk_level: low
    inputs_schema:
      venue:
        type: string
        enum: [methodsx, joss, softwarex, software-impacts, peerj-cs, arxiv]
    outputs_schema:
      template_path: { type: string }
      checklist_path: { type: string }
      cover_letter_template: { type: string }
      submission_url: { type: string }
    depends_on:
      dsh_tools: [tool-fs]
---

# venue-templates

Map a venue to its submission template + checklist + cover-letter template.
The mapping is in `lib/tools/venue-match.js` (in code) plus the static
templates in `skills/submit/venue-template/<venue>/`.

## Bundled venues

| Code | Full name | Template | Checklist |
|---|---|---|---|
| `methodsx`         | MethodsX (Elsevier)               | `methodsx/main.tex`        | `methodsx/checklist.md` |
| `joss`             | Journal of Open Source Software    | `joss/paper.md`            | `joss/checklist.md` |
| `softwarex`        | SoftwareX (Elsevier)               | `softwarex/main.tex`       | `softwarex/checklist.md` |
| `software-impacts` | Software Impacts (Elsevier)        | `software-impacts/main.tex`| `software-impacts/checklist.md` |
| `peerj-cs`         | PeerJ Computer Science             | `peerj-cs/main.tex`        | `peerj-cs/checklist.md` |
| `arxiv`            | arXiv preprint                     | `arxiv/main.tex`           | `arxiv/checklist.md` |

## Adding a new venue

1. Create `skills/submit/venue-template/<code>/SKILL.md` (with same frontmatter shape).
2. Drop `main.tex` + `checklist.md` + `cover_letter.md` into the same dir.
3. Add the code to `lib/tools/venue-match.js`'s `KNOWN` map.
4. Add a row to `KNOWN` in `lib/tools/venue-match.js`.
5. Send a PR.

## Why template, not auto-generate

Journals reject submissions that don't follow their exact preamble,
bibliography style, and metadata fields. Inventing these is a hard block.
This skill exists precisely so PaperLab never has to.
