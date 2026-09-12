// paperlab/lib/tools/index.js
// Re-export all tool definitions for the plugin manifest to enumerate.

export { toolDefinition as paperAudit }      from './paper-audit.js';
export { toolDefinition as ledgerRead }      from './ledger-read.js';
export { toolDefinition as ledgerWrite }     from './ledger-write.js';
export { toolDefinition as integrityCheck }  from './integrity-check.js';
export { toolDefinition as venueMatch }      from './venue-match.js';
export { toolDefinition as topicSearch }     from './topic-search.js';
export { toolDefinition as datasetManifest } from './dataset-manifest.js';
export {
  ORCHESTRATOR_TOOLS,
  driveStageTool, completeStageTool, humanGateTool,
  auditRunTool, todoTool, sessionStatusTool,
} from './orchestrator.js';

export const TOOLS = [
  { name: 'paperlab-paper-audit',        from: './paper-audit.js' },
  { name: 'paperlab-ledger-read',        from: './ledger-read.js' },
  { name: 'paperlab-ledger-write',       from: './ledger-write.js' },
  { name: 'paperlab-integrity-check',    from: './integrity-check.js' },
  { name: 'paperlab-venue-match',        from: './venue-match.js' },
  { name: 'paperlab-topic-search',       from: './topic-search.js' },
  { name: 'paperlab-dataset-manifest',   from: './dataset-manifest.js' },
  { name: 'paperlab-drive-stage',        from: './orchestrator.js', tool: 'driveStageTool' },
  { name: 'paperlab-complete-stage',     from: './orchestrator.js', tool: 'completeStageTool' },
  { name: 'paperlab-human-gate',         from: './orchestrator.js', tool: 'humanGateTool' },
  { name: 'paperlab-audit-run',          from: './orchestrator.js', tool: 'auditRunTool' },
  { name: 'paperlab-todo',               from: './orchestrator.js', tool: 'todoTool' },
  { name: 'paperlab-session-status',     from: './orchestrator.js', tool: 'sessionStatusTool' },
];
