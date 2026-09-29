/**
 * PaperLab client plugin: the Skills surface. Registers a sidebar rail entry
 * plus a keyed `main` panel listing the installed skill library with an
 * inline creation form — the paper pipeline is driven by skills, so skills
 * are the product surface.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createElement } from 'react'
import { SkillsPanel } from './SkillsPanel.tsx'

/** Required client services: slot registry, remote face, session projection. */
export const inject = ['slots']

/** Glyph for the left-rail Skills entry: a stacked-layers skill glyph. */
function SkillsGlyph(): React.ReactElement {
  return createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    // diamond stack (the skills mark)
    createElement('path', { d: 'M12 3 21 8l-9 5-9-5 9-5Z', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }),
    createElement('path', { d: 'M4.5 12.2 12 16.4l7.5-4.2', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    createElement('path', { d: 'M4.5 16.4 12 20.6l7.5-4.2', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

/**
 * Register the Skills panel. The rail entry switches the main panel to key
 * `paperlab-skills`; the panel lists the workspace skill library and creates
 * new skills.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: 'paperlab-skills', order: 1, label: () => 'Skills 技能库' },
    SkillsGlyph,
  )), 'ui-paperlab: rail entry')

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: 'paperlab-skills' },
    function SkillsSurface(): React.ReactElement {
      return createElement(SkillsPanel, {})
    },
  )), 'ui-paperlab: skills panel')
}
