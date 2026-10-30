# Vendored: Claude Science skill methodology (4 skills)

Source: Claude Science runtime skill catalog (`~/.claude-science/skills/`),
accessed locally on 2026-09-29. Each SKILL.md carries `license: Apache-2.0`
in its frontmatter (verified across 29 skill files in that catalog).

Skills vendored here:

| Skill | Role in the paper pipeline | PaperLab integration |
|---|---|---|
| `paper-narrative` | Whole-paper figure STORY: derive brief → handling-editor review → arc / figure_moves / missing_panels / kill_list → converge until `would_send_for_review=="yes"` | audit-stage narrative gate; pairs with our Review Swarm |
| `figure-composer` | ONE multi-panel figure: outline (12-col grid) → fan-out one sub-agent per panel → tile → adversarial composite review ≤3 rounds | data/write-stage figure production, feeds `paperlab_figure_audit` |
| `figure-style` | Inner tier: publication-grade correctness rules (data fidelity §1, claim-titles-tested §1.4) + `apply_figure_style()` helpers | loaded by every panel sub-agent; rules extracted into our figure audit rubric |
| `literature-review` | Retrieve-first synthesis: CrossRef/OpenAlex (`kernel.py`, stdlib-only), backward/forward citation-graph expansion (`expand_citations`), retraction checks, prose-not-bullets | backs `paperlab_topic_search` + `citation_check` multi-source upgrade (Plan P1) |

Compliance:
- Apache-2.0 requires preserving license/copyright notices — kept verbatim in
  every SKILL.md frontmatter; this directory and NOTICE record provenance.
- Upstream: Anthropic Claude Science product skill catalog (Apache-2.0 files).
  NOT from github.com/Haleclipse/cscience (that repo is a BYOK patcher for the
  closed product bundle and contributed no code here).
- Red line (PLAN_v2.1): no patched-bundle artifacts are redistributed; these
  are individually licensed skill files copied from the locally-installed
  runtime catalog.
