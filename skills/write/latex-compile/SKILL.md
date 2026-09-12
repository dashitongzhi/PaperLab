---
name: latex-compile
description: Compile drafts/<paper_id>/manuscript/main.tex to PDF. Used by PaperWriter after each section is added. Bounded by sandbox; never pollutes the working directory.
metadata:
  paperlab:
    stage: write
    risk_level: low
    inputs_schema:
      tex_path: { type: string, required: true }
      engine: { enum: [pdflatex, xelatex, lualatex], default: pdflatex }
      bibtex: { type: boolean, default: true }
    outputs_schema:
      pdf_path: { type: string }
      log_path: { type: string }
      warnings: { type: array, items: string }
    depends_on:
      system: [pdflatex, bibtex]
      dsh_tools: [tool-bash]
---

# latex-compile

Compile a LaTeX manuscript to PDF in a sandboxed temp dir, then copy the PDF
back next to the source `.tex` file. Used by PaperWriter after every section
edit so the author sees a current PDF.

## Procedure

1. Read `<tex_path>` via `tool-fs`. Extract `\bibliography{...}`.
2. Make a temp dir (e.g. `mktemp -d` under the project's `.paperlab/cache/`).
3. Copy `<tex_path>` + `figures/` + `*.bib` into the temp dir.
4. Run `pdflatex -interaction=nonstopmode -halt-on-error main.tex`.
5. If bibtex is requested and there is a bibliography, run `bibtex main`
   then `pdflatex` twice more.
6. Capture the log; extract any `Warning` / `! Error` lines.
7. Copy `main.pdf` to `<tex_path>.pdf` (alongside the .tex).
8. Return `{ pdf_path, log_path, warnings }`.

## Sandboxing

- Run inside dsh's `dsh-bash-sandbox` with `mode=workspace-write`.
- Never let the compile reach outside `evidence/datasets/<id>/` or `drafts/<id>/`.

## Common failures

- `! LaTeX Error: File 'foo.sty' not found` → missing TeX package, ask user
  to install via `tlmgr install foo` or use the bundled `texlive-full` image.
- `Undefined control sequence` → typo in the draft, surface the line.
- Bibtex errors → missing citation key, surface which entry.
