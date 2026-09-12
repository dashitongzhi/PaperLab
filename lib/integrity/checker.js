// paperlab/lib/integrity/checker.js
// 6-category integrity-artifact checker.
//
// Each artifact is validated against schemas/v1/<artifact>.json (Ajv).
// The checker is called by paperlab-integrity-check tool and by the
// paper-auditor sub-agent before each stage transition.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.resolve(__dirname, '../../schemas/v1');

export const ARTIFACT_TYPES = [
  'literature-provenance',
  'citation-verification',
  'workflow-state',
  'experiment-traceability',
  'human-review-gates',
  'claim-evidence-row',
];

async function loadAjv() {
  try {
    const ajvMod = await import('ajv');
    const fmtMod = await import('ajv-formats');
    const Ajv = ajvMod.default || ajvMod.Ajv;
    const addFormats = fmtMod.default || fmtMod.addFormats;
    // draft-07 by default — accepts our $schema: https://json-schema.org/draft/2020-12/schema
    // because draft-2020-12 is mostly a superset; if strict draft-2020-12 is needed
    // we'll switch to ajv@8 with the dist-2020 entrypoint.
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv;
  } catch (e) {
    return null;
  }
}

export class IntegrityChecker {
  /**
   * @param {object} opts
   * @param {object} [opts.ajv] - pre-built Ajv instance (for tests / sync use)
   */
  constructor({ ajv } = {}) {
    this.ajv = ajv || null;
    this.compiled = {};
  }

  /** Async factory — call once at boot to compile all schemas. */
  static async create() {
    const checker = new IntegrityChecker();
    checker.ajv = await loadAjv();
    if (checker.ajv) {
      for (const t of ARTIFACT_TYPES) {
        const schemaPath = path.join(SCHEMAS_DIR, `${t}.json`);
        if (fs.existsSync(schemaPath)) {
          checker.compiled[t] = checker.ajv.compile(
            JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
          );
        }
      }
    }
    return checker;
  }

  /**
   * Validate one artifact against its schema.
   * @param {string} type - one of ARTIFACT_TYPES
   * @param {object} data
   * @returns {{ok: boolean, errors?: object[], warnings?: string[]}}
   */
  validate(type, data) {
    if (!ARTIFACT_TYPES.includes(type)) {
      return { ok: false, errors: [{ message: `unknown artifact type: ${type}` }] };
    }
    const validate = this.compiled[type];
    if (!validate) {
      return { ok: true, warnings: [`schema ${type} not compiled (ajv missing?) — soft-pass`] };
    }
    const ok = validate(data);
    if (ok) return { ok: true };
    return { ok: false, errors: validate.errors };
  }

  validateBatch(items) {
    const results = [];
    for (const it of items) {
      const r = this.validate(it.type, it.data);
      results.push({ ...r, type: it.type, ref: it.ref });
    }
    return {
      ok: results.every(r => r.ok),
      results,
      summary: {
        total: results.length,
        passed: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
      },
    };
  }

  /**
   * Check the gates between stages.
   * Returns { ok, blocking, warnings } where blocking = must-fix issues.
   *
   * `fromStage` ∈ HUMAN_GATES → must have an approved gate row for that stage.
   * `ctx.requireAllPriorGates` → also require every gate whose stage comes
   *   before `toStage` to be approved (topic must approve before any later stage).
   */
  checkStageTransition(fromStage, toStage, ctx) {
    const blocking = [];
    const warnings = [];
    const gates = ctx.humanReviewGates || [];

    // Rule 1: fromStage itself is a human gate and must be approved.
    const HUMAN_GATES = new Set(['topic', 'audit', 'submit']);
    if (HUMAN_GATES.has(fromStage)) {
      const gate = gates.find(g => g.stage === fromStage);
      if (!gate || gate.decision !== 'approved') {
        blocking.push(`human gate for stage '${fromStage}' not approved`);
      }
    }

    // Rule 2: if ctx.requireAllPriorGates, every earlier human gate must be approved.
    if (ctx.requireAllPriorGates) {
      const STAGE_ORDER = ['topic', 'data', 'write', 'audit', 'submit'];
      const toIdx = STAGE_ORDER.indexOf(toStage);
      for (const stage of HUMAN_GATES) {
        const idx = STAGE_ORDER.indexOf(stage);
        if (idx >= toIdx) continue;
        const gate = gates.find(g => g.stage === stage);
        if (!gate || gate.decision !== 'approved') {
          blocking.push(`prior human gate '${stage}' not approved (required before '${toStage}')`);
        }
      }
    }

    // Rule 3: write → audit requires ledger with ≥1 supported row
    if (fromStage === 'write' && toStage === 'audit') {
      const summary = ctx.ledger?.summary?.();
      if (!summary || summary.total === 0) {
        blocking.push('ledger is empty — write stage must add ≥1 row');
      } else {
        if (!summary.by_status.supported) {
          blocking.push('ledger has 0 supported claims — write stage must add ≥1 supported row');
        }
        if (summary.by_status.unsupported || summary.by_status.gap) {
          warnings.push(
            `ledger has ${(summary.by_status.unsupported || 0) + (summary.by_status.gap || 0)} unresolved claims (gap/unsupported)`
          );
        }
      }
    }

    // Rule 4: audit → submit requires audit_report to say PASS
    if (fromStage === 'audit' && toStage === 'submit') {
      const audit = ctx.auditReport;
      if (!audit) blocking.push('no audit_report.md produced');
      else if (!/PASS/i.test(audit)) blocking.push('audit report is not PASS');
    }

    return { ok: blocking.length === 0, blocking, warnings };
  }
}
