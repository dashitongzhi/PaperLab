/**
 * PaperLab workflow center: the rail entry and the main panel. The panel
 * presents the built-in evidence-first paper pipeline (stages, tools, and
 * human gates) and lets the author edit every part of it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createElement } from 'react'
import { WorkflowPanel } from './WorkflowPanel.tsx'

export const inject = ['slots']

/** Glyph for the rail entry: three connected flow nodes. */
function WorkflowGlyph(): React.ReactElement {
  return createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    createElement('rect', { x: '8.5', y: '2.8', width: '7', height: '5', rx: '1.4', stroke: 'currentColor', strokeWidth: 1.8 }),
    createElement('rect', { x: '2.5', y: '16.2', width: '7', height: '5', rx: '1.4', stroke: 'currentColor', strokeWidth: 1.8 }),
    createElement('rect', { x: '14.5', y: '16.2', width: '7', height: '5', rx: '1.4', stroke: 'currentColor', strokeWidth: 1.8 }),
    createElement('path', { d: 'M12 7.8v4.4M6 16.2v-2.1a1.8 1.8 0 0 1 1.8-1.8h8.4a1.8 1.8 0 0 1 1.8 1.8v2.1',
      stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
  )
}

/**
 * Register the workflow panel: the rail entry switches the main panel to key
 * `paperlab-workflows`; the panel presents and edits the paper pipeline.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: 'paperlab-workflows', order: 2, label: () => '工作流' },
    WorkflowGlyph,
  )), 'ui-workflow: rail entry')

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: 'paperlab-workflows' },
    function WorkflowSurface(): React.ReactElement {
      return createElement(WorkflowPanel, {})
    },
  )), 'ui-workflow: panel')
}
