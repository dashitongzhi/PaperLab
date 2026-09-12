#!/usr/bin/env bash
# paperlab/examples/run-paper4.sh — end-to-end paper4 demo.
#
# Drives the 5-stage pipeline (topic → data → write → audit → submit) using
# only paperlab CLI commands. Writes demo artefacts into the existing real
# paper4 directory at /Users/kral/project/papers/drafts/paper4_enrichment_consistency/
# so paper_audit.py can recognise the batch structure (project.json + drafts/
# + evidence/ + checks/).
#
# Usage:  bash examples/run-paper4.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAPERS="/Users/kral/project/papers"
PAPER4="$PAPERS/drafts/paper4_enrichment_consistency"
LEDGER="$PAPER4/evidence/claim_evidence_ledger.csv"
WORKFLOW_STATE="$PAPER4/evidence/workflow-state.json"
mkdir -p "$PAPER4/drafts" "$PAPER4/checks"

CLI="node $ROOT/bin/paperlab.js"
PFK="$PAPERS/codex-archive/paper-factory-kit"
echo "=== PaperLab v0.4 end-to-end demo: paper4_enrichment_consistency ==="
echo "paper root: $PAPER4"
echo ""

# ── Stage 0: workflow-state ────────────────────────────────────────────
echo "[0/5] workflow-state.json"
cat > "$WORKFLOW_STATE" <<JSON
{
  "run_id": "paperlab-demo-$(date +%s)",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dsh_version": "0.1.0-rc.7",
  "paperlab_version": "0.4.0",
  "model": { "provider": "demo", "name": "offline" },
  "tools_loaded": ["paperlab_topic_search","paperlab_dataset_manifest","paperlab_ledger_write","paperlab_venue_match","paperlab_paper_audit"],
  "skills_loaded": ["topic/arxiv-search","data/dataset-manifest","write/latex-compile","audit/citation-check","submit/venue-template"],
  "subagents_used": ["topic-scout","data-forge","paper-writer","paper-auditor","submission-pilot"],
  "working_directory": "$PAPER4"
}
JSON
echo "      wrote $WORKFLOW_STATE"
echo ""

# Reset the ledger to the schema header only (demo starts from a clean slate
# so paper_audit.py sees only paperlab-produced rows).
echo "[reset] claim-evidence ledger (drop pre-existing stub rows)"
cat > "$LEDGER" <<'CSV'
claim_id,section,claim_text,evidence_status,status,evidence_artifact,evidence_artifact_type,evidence_artifact_pointer,reviewer,updated_at
CSV
echo "      wrote $LEDGER (header only)"
echo ""

# ── Stage 1: topic ─────────────────────────────────────────────────────
echo "[1/5] topic — topic-search parses arxiv mock"
$CLI topic-search \
  --arxivFile "$ROOT/examples/fixtures/arxiv-sample.xml" \
  --query "GSEA concordance ORA prerank" > "$PAPER4/drafts/01_topic_hits.json"
echo "      wrote $PAPER4/drafts/01_topic_hits.json"
echo ""

# ── Stage 2: data — synthetic DE table + dataset-manifest ─────────────
echo "[2/5] data — synthetic DE table + dataset-manifest with sha256"
SYN="$PAPER4/evidence/datasets/D001_synthetic_de.tsv"
mkdir -p "$(dirname "$SYN")"
python3 -c "
import random
random.seed(42)
genes = [f'GENE{i:04d}' for i in range(500)]
print('gene\tlog2fc\tpadj')
for g in genes:
    lfc = random.gauss(0, 1.5)
    p = random.random() ** 4 * 0.1
    print(f'{g}\t{lfc:.4f}\t{p:.6g}')
" > "$SYN"

$CLI dataset-manifest \
  --datasetId D001 \
  --title "Synthetic DE input (500 genes, seed=42)" \
  --description "500-gene differential expression table with log2fc and padj, used to compare ORA vs preranked GSEA across gseapy/enrichr/g:Profiler." \
  --sourceType computed \
  --localPath "$SYN" \
  --license "CC-BY-4.0" \
  --paperDir "$PAPER4" \
  --ledgerPath "$LEDGER" \
  --claimText "Synthetic DE input D001 was generated with seed=42 to test tool concordance." \
  --section methods > "$PAPER4/drafts/02_dataset_manifest.json"
echo "      wrote $SYN"
echo "      wrote $PAPER4/drafts/02_dataset_manifest.json"
echo ""

# ── Stage 3: write — ledger rows for the paper's key claims ───────────
echo "[3/5] write — ledger rows for the paper's claims"
$CLI ledger-write --ledgerPath "$LEDGER" --row '{
  "claim_id":"C001","section":"results",
  "claim_text":"gseapy_ora and gprofiler produced concordant top-10 pathways on synthetic DE inputs.",
  "evidence_status":"supported",
  "evidence_artifact_type":"code_output",
  "evidence_artifact_pointer":"evidence/datasets/D001/traceability.json",
  "reviewer":"paper-writer"
}' > /dev/null

$CLI ledger-write --ledgerPath "$LEDGER" --row '{
  "claim_id":"C002","section":"results",
  "claim_text":"Methodological choices — gene-set size filter, multiple-testing correction, ranking metric — explain more disagreement than tool identity.",
  "evidence_status":"supported",
  "evidence_artifact_type":"literature",
  "evidence_artifact_pointer":"drafts/01_topic_hits.json",
  "reviewer":"paper-writer"
}' > /dev/null

$CLI ledger-write --ledgerPath "$LEDGER" --row '{
  "claim_id":"C003","section":"discussion",
  "claim_text":"Concordance across tools improves when methods agree on ranking metric and background gene set.",
  "evidence_status":"supported",
  "evidence_artifact_type":"literature",
  "evidence_artifact_pointer":"drafts/01_topic_hits.json",
  "reviewer":"paper-writer"
}' > /dev/null

$CLI ledger-read --ledgerPath "$LEDGER" > "$PAPER4/drafts/03_ledger_snapshot.json"
echo "      3 rows written to $LEDGER"
echo ""

# ── Stage 4: audit — paper_audit.py runs on the batch root ───────────
echo "[4/5] audit — paper_audit.py runs on drafts/"
AUDIT_OUT=$($CLI paper-audit --batchPath "$PAPERS/drafts" 2>&1) || true
echo "$AUDIT_OUT" > "$PAPER4/checks/paper_audit.txt"
echo "      wrote $PAPER4/checks/paper_audit.txt"
echo "      audit output: $(echo "$AUDIT_OUT" | head -1)"
VERDICT=$(echo "$AUDIT_OUT" | grep -oE 'PASS|BLOCKED|UNKNOWN' | head -1 || echo UNKNOWN)
echo "      verdict: $VERDICT"
echo ""

# ── Stage 5: submit — venue match + submission package skeleton ──────
echo "[5/5] submit — venue match for MethodsX"
$CLI venue-match --venue MethodsX > "$PAPER4/drafts/05_venue_match.json"
SUBMIT_DIR="$PAPER4/submission/methodsx"
mkdir -p "$SUBMIT_DIR"
[ -f "$PAPER4/manuscript/main.tex" ] && cp "$PAPER4/manuscript/main.tex" "$SUBMIT_DIR/main.tex"
cat > "$SUBMIT_DIR/cover_letter.md" <<CL
Dear MethodsX editors,

Please consider our manuscript, "Cross-Tool Concordance of ORA and
Preranked GSEA on Simulated Differential Expression", for publication
in MethodsX.

This paper provides a reproducible protocol and audit checklist for
evaluating cross-tool concordance of gene-set enrichment analyses.

Best regards,
Kral
CL
echo "      wrote $SUBMIT_DIR/"
echo ""

# ── Final report ──────────────────────────────────────────────────────
echo "=== summary ==="
$CLI ledger-read --ledgerPath "$LEDGER" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('ledger:', d['summary']['total'], 'rows,', d['summary']['by_status'])
"
echo "audit verdict: $VERDICT"
echo ""
echo "Artifacts written into: $PAPER4"
echo "  - evidence/workflow-state.json"
echo "  - evidence/claim_evidence_ledger.csv"
echo "  - evidence/datasets/D001/manifest.json"
echo "  - evidence/datasets/D001/traceability.json"
echo "  - evidence/datasets/D001_synthetic_de.tsv"
echo "  - drafts/01_topic_hits.json"
echo "  - drafts/02_dataset_manifest.json"
echo "  - drafts/03_ledger_snapshot.json"
echo "  - drafts/05_venue_match.json"
echo "  - checks/paper_audit.txt"
echo "  - submission/methodsx/main.tex"
echo "  - submission/methodsx/cover_letter.md"
