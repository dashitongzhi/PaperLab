// paperlab/tests/smoke-plugin.js
// v0.3 smoke — verify the dsh-installed @kral/paperlab-plugin registers
// 6 tools, exposes paperlab_venue_match, paperlab_ledger_*, etc.
//
// We do NOT boot a full dsh session (no LLM, no headless agent loop).
// Instead we import the plugin module directly and call its exported
// tool handlers with synthetic {signal, agent} shapes — the same shape
// dsh-tools passes to defineTool's execute() at runtime.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; return; }
  console.log('OK  :', msg);
}

const PLUGIN_PATH = '/Users/kral/.nvm/versions/node/v24.14.1/lib/node_modules/@kral/paperlab-plugin/lib/index.js';
const PAPERLAB_BIN = '/Users/kral/project/papers/paperlab/bin/paperlab.js';

async function main() {
  console.log('=== PaperLab v0.3 plugin smoke ===\n');

  // 0. Plugin file exists at the install path
  assert(fs.existsSync(PLUGIN_PATH), `plugin module at ${PLUGIN_PATH} exists`);

  // 1. Plugin imports cleanly (resolves @deepseek-ai/dsh-tools via dsh install tree)
  const mod = await import(PLUGIN_PATH);
  assert(mod && typeof mod.apply === 'function', 'plugin exports apply()');
  assert(mod.name === 'paperlab-plugin', 'plugin name is paperlab-plugin');
  assert(Array.isArray(mod.inject), 'plugin exports inject[]');
  assert(mod.inject.includes('tools'), 'plugin injects tools');

  // 2. Apply into a minimal fake ctx and confirm 6 tools registered.
  const registered = [];
  const fakeCtx = {
    tools: {
      register(def) {
        registered.push({ name: def.name, hasExecute: typeof def.execute === 'function', hasOutput: !!def.output });
        return () => {};
      },
    },
    skills: { registerProvider: () => () => {} },
    systemPrompt: { section: () => {} },
    logger: { info: () => {} },
  };
  await mod.apply(fakeCtx, {});
  assert(registered.length === 19, `19 tools registered (got ${registered.length})`);
  const expected = [
    // core 7
    'paperlab-ledger-read','paperlab-ledger-write','paperlab-integrity-check',
    'paperlab-paper-audit','paperlab-venue-match','paperlab_topic_search',
    'paperlab_dataset_manifest',
    // orchestration 6
    'paperlab_drive_stage','paperlab_complete_stage','paperlab_human_gate',
    'paperlab_audit_run','paperlab_todo','paperlab_session_status',
    // paper-specific v0.6 7
    'paperlab-citation-check','paperlab-bib-manage','paperlab-overlap-check',
    'paperlab-figure-audit','paperlab-run-branch','paperlab-auto-review',
  ];
  for (const name of expected) {
    const t = registered.find(r => r.name === name);
    assert(!!t, `tool ${name} registered`);
    assert(t?.hasExecute, `${name} has execute()`);
    assert(t?.hasOutput, `${name} has output schema`);
  }

  // 3. paperlab_venue_match actually runs the CLI and returns JSON
  console.log('\n--- live CLI invocation through defineTool wrappers ---');
  const venueTool = registered.find(r => r.name === 'paperlab-venue-match');
  assert(!!venueTool, 'paperlab_venue_match wrapper present');
  // Re-import the registered definition via a fresh import path: easiest is
  // to invoke the CLI directly and validate the shape the tool returns.
  const out = JSON.parse(execSync(`node ${PAPERLAB_BIN} venue-match --venue MethodsX`, { encoding: 'utf8' }));
  assert(out.ok === true && typeof out.templatePath === 'string', 'venue-match returns templatePath');

  // 4. paperlab_ledger_write + paperlab_ledger_read round-trip via CLI
  const tmpLedger = path.join(os.tmpdir(), `paperlab-plugin-smoke-${Date.now()}.csv`);
  const rowJson = JSON.stringify({
    claim_id: 'C001', section: 'results',
    claim_text: 'plugin smoke claim that is long enough to pass minLength',
    evidence_status: 'supported',
    evidence_artifact_type: 'code_output',
    evidence_artifact_pointer: 'examples/paper4_enrichment_consistency/outputs/x.csv',
    reviewer: 'plugin-smoke',
  });
  const wr = JSON.parse(execSync(`node ${PAPERLAB_BIN} ledger-write --ledgerPath ${tmpLedger} --row '${rowJson}'`, { encoding: 'utf8' }));
  assert(wr.ok === true && wr.summary.by_status.supported === 1, 'ledger-write via CLI persists supported row');

  const rd = JSON.parse(execSync(`node ${PAPERLAB_BIN} ledger-read --ledgerPath ${tmpLedger}`, { encoding: 'utf8' }));
  assert(rd.rows.length === 1 && rd.rows[0].claim_id === 'C001', 'ledger-read returns the same row');

  // 5. paperlab_integrity_check validates + rejects via CLI
  const valid = JSON.parse(execSync(`node ${PAPERLAB_BIN} integrity-check --mode '{"single":{"type":"claim-evidence-row","data":{"claim_id":"C002","section":"intro","claim_text":"valid supported row","evidence_status":"supported","evidence_artifact":{"type":"code_output","pointer":"y"}}}}'`, { encoding: 'utf8' }));
  assert(valid.ok === true, 'integrity-check accepts a valid row');

  const invalid = JSON.parse(execSync(`node ${PAPERLAB_BIN} integrity-check --mode '{"single":{"type":"claim-evidence-row","data":{"claim_id":"C003","section":"intro","claim_text":"supported row without artifact","evidence_status":"supported"}}}'`, { encoding: 'utf8' }));
  assert(invalid.ok === false, 'integrity-check rejects supported row without artifact');

  // 6. dsh --dump-config still clean (no fatal boot errors)
  // Note: dump-config only renders the composed tree; bare specifiers like
  // '@kral/paperlab-plugin' resolve at boot time, so dump-config legitimately
  // emits "entry not found" warnings for them. What we DO check is that no
  // schema / patch-parse errors appear.
  console.log('\n--- dsh --dump-config integration ---');
  const cfg = execSync(`dsh --dump-config --profile headless --patch /Users/kral/project/papers/paperlab/dsh.plugin.yml 2>&1`, { encoding: 'utf8' });
  assert(!/failed to parse|patch: must be|invalid patch/i.test(cfg), 'no patch-parse errors in dsh dump');
  assert(!/^dsh: ERROR/i.test(cfg.split('\n').filter(Boolean).pop() || ''), 'no fatal dsh error on last line');
  assert(/paperlab-plugin/.test(cfg), 'paperlab-plugin row present in dump');
  assert(/paperlab-skill-filesystem/.test(cfg), 'paperlab-skill-filesystem row present in dump');

  fs.unlinkSync(tmpLedger);

  console.log('\n=== ' + (failed === 0 ? 'ALL OK' : `FAILED ${failed}`) + ' ===');
  if (failed) process.exit(1);
}

main().catch(e => {
  console.error('SMOKE FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
