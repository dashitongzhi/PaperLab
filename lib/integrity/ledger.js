// paperlab/lib/integrity/ledger.js
// ClaimEvidenceLedger — single source of truth for paper claims.
//
// Mirrors paper-factory-kit/evidence/claim_evidence_ledger.csv but
// validates each row against schemas/v1/claim-evidence-row.json.

import fs from 'node:fs';
import path from 'node:path';

export class ClaimEvidenceLedger {
  /**
   * @param {string} ledgerPath - absolute or cwd-relative path to ledger.csv
   */
  constructor(ledgerPath) {
    this.path = ledgerPath;
    this.rows = [];
    this.load();
  }

  load() {
    if (!fs.existsSync(this.path)) {
      this.rows = [];
      return;
    }
    const raw = fs.readFileSync(this.path, 'utf8');
    if (!raw.trim()) { this.rows = []; return; }
    const records = parseCsv(raw);
    if (records.length === 0) { this.rows = []; return; }
    const header = records[0].map(s => s.trim());
    this.rows = records.slice(1)
      // Drop empty rows (paper4 had pre-existing stub rows).
      .filter(cells => cells.some(c => (c ?? '').trim() !== ''))
      .map((cells, i) => {
        const row = {};
        header.forEach((h, j) => { row[h] = cells[j] ?? ''; });
        row.__line = i + 2;
        return row;
      });
  }

  save() {
    const dir = path.dirname(this.path);
    fs.mkdirSync(dir, { recursive: true });
    if (this.rows.length === 0) {
      fs.writeFileSync(this.path, 'claim_id,section,claim_text,evidence_status,status,evidence_artifact,evidence_artifact_type,evidence_artifact_pointer,reviewer,updated_at\n');
      return;
    }
    const header = ['claim_id', 'section', 'claim_text', 'evidence_status', 'status',
                    'evidence_artifact', 'evidence_artifact_type', 'evidence_artifact_pointer',
                    'reviewer', 'updated_at'];
    const lines = [header.join(',')];
    for (const r of this.rows) {
      // Mirror paperlab's structured claim-evidence columns into the flat
      // shapes downstream audit tooling expects:
      //   status              ← evidence_status  (paper_audit.py)
      //   evidence_artifact   ← "<type>:<pointer>"  (paper_audit.py)
      const statusMirror = r.status ?? r.evidence_status ?? '';
      const artifactMirror = r.evidence_artifact
        ?? (r.evidence_artifact_type && r.evidence_artifact_pointer
              ? `${r.evidence_artifact_type}:${r.evidence_artifact_pointer}`
              : '');
      const row = { ...r, status: statusMirror, evidence_artifact: artifactMirror };
      lines.push(header.map(h => csvEscape(row[h] ?? '')).join(','));
    }
    fs.writeFileSync(this.path, lines.join('\n') + '\n');
  }

  add(row) {
    // Minimal validation — full schema check happens in IntegrityChecker
    if (!row.claim_id || !/^C\d{3,}$/.test(row.claim_id)) {
      throw new Error(`claim_id invalid: ${row.claim_id} (must match /^C\\d{3,}$/)`);
    }
    if (!['supported', 'unsupported', 'gap', 'draft'].includes(row.evidence_status)) {
      throw new Error(`evidence_status invalid: ${row.evidence_status}`);
    }
    if (row.evidence_status === 'supported' && !row.evidence_artifact_pointer) {
      throw new Error(`claim ${row.claim_id} is supported but has no evidence_artifact_pointer`);
    }
    row.updated_at = new Date().toISOString();
    const existing = this.rows.findIndex(r => r.claim_id === row.claim_id);
    if (existing >= 0) this.rows[existing] = { ...this.rows[existing], ...row };
    else this.rows.push(row);
    this.save();
  }

  get(claimId) {
    return this.rows.find(r => r.claim_id === claimId);
  }

  bySection(section) {
    return this.rows.filter(r => r.section === section);
  }

  supported() {
    return this.rows.filter(r => r.evidence_status === 'supported');
  }

  unresolved() {
    return this.rows.filter(r => ['unsupported', 'gap'].includes(r.evidence_status));
  }

  summary() {
    const by = {};
    for (const r of this.rows) {
      by[r.evidence_status] = (by[r.evidence_status] || 0) + 1;
    }
    return { total: this.rows.length, by_status: by };
  }
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// RFC 4180 CSV parser — handles quoted fields with embedded commas, quotes,
// and newlines. Returns an array of records, each a string[].
function parseCsv(text) {
  const records = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') records.push(row);
        row = [];
      } else cur += c;
    }
  }
  if (cur !== '' || row.length > 0) { row.push(cur); records.push(row); }
  return records;
}
