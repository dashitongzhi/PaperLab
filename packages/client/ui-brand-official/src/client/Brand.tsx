import { PaperLabWordmark, PaperLabMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the PaperLab mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the PaperLab lab-document mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <PaperLabMark size={size} />
}

/**
 * Render the PaperLab name artwork without its independently slotted mark.
 * @returns the PaperLab wordmark.
 */
export function OfficialBrandName() {
  return <PaperLabWordmark includeMark={false} />
}
