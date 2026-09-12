// paperlab/lib/plugins/subagent-spawn.js
// Spawn a paperlab sub-agent (topic-scout / data-forge / paper-writer /
// paper-auditor / submission-pilot) via dsh's subagent registry.

const PRESETS = {
  'topic-scout':     'Search arXiv/PubMed, score topic feasibility, write topics.csv.',
  'data-forge':      'Acquire / hash datasets, write manifest + traceability.',
  'paper-writer':    'Drive the 5 paper sub-stages; every claim lands in the ledger.',
  'paper-auditor':   'Independent re-check of claims, citations, and audit report.',
  'submission-pilot':'Match venue template, generate cover letter, build submission package.',
};

const ROUTING = {
  topic:    'topic-scout',
  data:     'data-forge',
  write:    'paper-writer',
  audit:    'paper-auditor',
  submit:   'submission-pilot',
};

export function presetForStage(stage) {
  return ROUTING[stage] || null;
}

export function listPresets() {
  return Object.entries(PRESETS).map(([name, description]) => ({ name, description }));
}

/**
 * Spawn a paperlab sub-agent. The agent runs in-process; we return its
 * structured output. For real multi-agent isolation, swap this for
 * ctx.subagents.spawn(...) — paperlab provides the routing/preset metadata.
 */
export async function spawnSubagent(ctx, presetName, task, options = {}) {
  if (!PRESETS[presetName]) {
    throw new Error(`unknown paperlab preset: ${presetName}. valid: ${Object.keys(PRESETS).join(', ')}`);
  }

  // Preferred path: dsh subagent registry.
  if (ctx.subagents && typeof ctx.subagents.spawn === 'function') {
    return await ctx.subagents.spawn({
      provider: 'paperlab-spawn',
      agent: presetName,
      task,
      options,
    });
  }

  // Fallback: in-process. We document this as a degraded mode.
  return {
    ok: true,
    preset: presetName,
    description: PRESETS[presetName],
    task,
    fallback: true,
    note: 'ctx.subagents.spawn unavailable in this dsh build; the paperlab sub-agent metadata is returned for the parent agent to act on directly.',
  };
}
