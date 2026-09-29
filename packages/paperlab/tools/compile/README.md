# paperlab-compile — manuscript → PDF with a structured build report

Part of PaperLab's **A-line (成稿编译闭环)**: the write/submit stages call this
tool after every section edit so a current PDF always exists, and compile
warnings flow back into audit as structured findings — not console noise.

## Usage

```sh
node paperlab-compile.mjs --paper-dir <dir> [--engine auto|tectonic|pdflatex] \
                          [--tex <path>] [--keep-cache]
```

- Discovers `<dir>/manuscript/main.tex` (override with `--tex`).
- Builds in an isolated temp dir under `<dir>/.paperlab/build/<stamp>/` — the
  manuscript directory is never polluted with `.aux`/`.log` litter.
- Copies `main.tex` + every sibling `*.bib` + `figures/` (paper root or
  manuscript dir, whichever exists) into the build dir.
- PDF lands at `<dir>/manuscript/main.pdf`.
- Structured report lands at `<dir>/evidence/build-report.json`.

## Build report schema

```json
{
  "ok": true,
  "engine": "tectonic",
  "tex_sha256": "…",
  "pdf_path": "<dir>/manuscript/main.pdf",
  "pages": 7,
  "duration_ms": 8123,
  "warnings": [{ "severity": "warning", "line": 88, "message": "…" }],
  "errors":   [{ "severity": "error",   "line": 12, "message": "…" }],
  "infos":    [{ "severity": "info",    "line": 40, "message": "Overfull \\hbox …" }],
  "built_at": "2026-09-29T…"
}
```

Warnings/errors are parsed from the engine log: `! ` error lines (with `l.NNN`
line numbers), `LaTeX/Package/Class/pdfTeX Warning:` lines, and
`Overfull/Underfull \hbox/\vbox` lines. The audit stage consumes
`warnings[] + errors[]` directly as `suggestions[]` fuel.

## Engines

| Engine | Detection | Bibtex handling |
|---|---|---|
| `tectonic` (preferred) | `which tectonic` | internal — single command does the full loop |
| `pdflatex` | `which pdflatex` | explicit `pdflatex → bibtex → pdflatex → pdflatex` |

`--engine auto` (default) prefers tectonic, falls back to pdflatex, and if
neither exists prints install instructions and exits with code 2:

```sh
brew install tectonic          # ~20 MB single binary — recommended
brew install --cask basictex   # alternative
```

## Idempotence

The tex file's sha256 is recorded in the report. If the hash is unchanged and
the last build was `ok` with the PDF still on disk, the tool skips compilation
and returns the cached report with `"skipped": true`. Delete
`evidence/build-report.json` to force a rebuild.

## Known limitations

- Single-entry-point compilation: `\input`/`\include` of files **outside** the
  manuscript directory are not staged (copy them in, or keep the paper
  self-contained under `manuscript/`).
- `luaLaTeX`-only documents (`fontspec`, etc.) are not yet wired; tectonic's
  XeTeX base covers most article-class papers.
- Page count uses `pdfinfo` when present; otherwise `pages: null`.
- Bibtex diagnostics are parsed only from the pdflatex path; tectonic folds
  them into its own log.
- The Overfull box message normalization is lossy (keeps magnitude + location,
  not the full context lines).
