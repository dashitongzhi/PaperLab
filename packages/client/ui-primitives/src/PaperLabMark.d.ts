import type { IconProps } from './icons/props.ts';
/** Display options for the PaperLab brand mark. */
export interface PaperLabMarkProps extends IconProps {
    /** 'paper' renders the cream folded sheet; 'flat' is the navy glyph only. */
    variant?: 'paper' | 'flat';
}
/** Brand palette extracted from the PaperLab logo. */
export declare const PAPERLAB_COLORS: {
    readonly navy: "#1e3a5f";
    readonly navyDeep: "#16293f";
    readonly paper: "#f5f2e9";
    readonly fold: "#c9c0ab";
};
/**
 * Render the PaperLab mark: the navy "P" whose counter holds a cream sheet
 * of paper with a folded corner — paper meets lab.
 *
 * Geometry mirrors the logo: a bold navy P built from a left stem and a
 * large bowl; tucked into the P's aperture, a warm-white sheet with a
 * top-left fold shaded in warm gray.
 * @param props.size - width in px (default 24; square aspect).
 * @param props.className - extra class for layout placement.
 * @param props.variant - 'paper' (default) includes the sheet; 'flat' is navy-only.
 * @returns the mark svg (aria-hidden decorative brand art).
 */
export declare function PaperLabMark({ size, className, variant }: PaperLabMarkProps): import("react").JSX.Element;
//# sourceMappingURL=PaperLabMark.d.ts.map