// paperlab/lib/tools/integrity-check.js
// Run the IntegrityChecker over one artifact or a batch.

import { IntegrityChecker, ARTIFACT_TYPES } from '../integrity/checker.js';

export const toolDefinition = {
  name: 'paperlab-integrity-check',
  description: `Validate artifacts against PaperLab v1 schemas. Types: ${ARTIFACT_TYPES.join(', ')}. Returns ok + errors.`,
  parameters: {
    mode: {
      type: 'object',
      required: true,
      additionalProperties: true,
      description: 'Either { single: { type, data } } or { batch: [{ type, data, ref }] } or { stage: { fromStage, toStage, ctx } }.',
    },
  },
  handler: async (args, _ctx) => {
    const checker = await IntegrityChecker.create();
    const m = args.mode;

    if (m.single) {
      return { ok: true, ...checker.validate(m.single.type, m.single.data) };
    }
    if (m.batch) {
      return { ok: true, ...checker.validateBatch(m.batch) };
    }
    if (m.stage) {
      return { ok: true, ...checker.checkStageTransition(m.stage.fromStage, m.stage.toStage, m.stage.ctx || {}) };
    }

    return { ok: false, error: 'mode must be single | batch | stage' };
  },
};
