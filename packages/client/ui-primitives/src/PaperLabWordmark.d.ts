import type { IconProps } from './icons/props.ts';
/** Display options for the PaperLab wordmark. */
export interface PaperLabWordmarkProps extends IconProps {
    /** Whether to include the leading mark; defaults to false (sidebar pairs the mark slot). */
    includeMark?: boolean | undefined;
}
/**
 * Render the PaperLab wordmark: the navy name plus the navy rounded badge.
 * @param props.size - height in px (default 24; width follows the artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to prepend the leading mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export declare function PaperLabWordmark({ size, className, includeMark }: PaperLabWordmarkProps): import("react").JSX.Element;
//# sourceMappingURL=PaperLabWordmark.d.ts.map