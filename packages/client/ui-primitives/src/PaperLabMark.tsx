import type { IconProps } from './icons/props.ts'

/** Display options for the PaperLab brand mark. */
export interface PaperLabMarkProps extends IconProps {
  /** 'paper' renders the cream folded sheet; 'flat' is the navy glyph only. */
  variant?: 'paper' | 'flat'
}

/** Brand palette extracted from the PaperLab logo. */
export const PAPERLAB_COLORS = {
  navy: '#1e3a5f',
  navyDeep: '#16293f',
  paper: '#f5f2e9',
  fold: '#c9c0ab',
} as const

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
export function PaperLabMark({ size = 24, className, variant = 'paper' }: PaperLabMarkProps) {
  const uid = `plm${Math.round(Math.random() * 1e6)}`
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={uid} x1="3" y1="5" x2="13" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fdfcf7" />
          <stop offset="100%" stopColor="#ece6d6" />
        </linearGradient>
      </defs>

      {/* navy P — stem, then bowl; counters cut to cradle the sheet */}
      <path
        d="M6.1 23V8.9c0-1.9 1.1-3.1 3-3.1h7.2c4 0 6.5 2.5 6.5 6.1 0 3.6-2.5 6.1-6.5 6.1h-5.9V23H6.1Zm4.3-8.3h5.4c1.8 0 2.9-1 2.9-2.7 0-1.6-1.1-2.7-2.9-2.7h-5.4v5.4Z"
        fill={PAPERLAB_COLORS.navy}
      />

      {variant === 'paper' && (
        <g>
          {/* sheet: flows from the upper counter down through the lower bowl */}
          <path
            d="M3.2 9.9c0-1.6.8-2.6 2.3-3.1l5.1-1.9c1.6-.6 2.9-.2 3.7 1.1l2.2 3.5c.8 1.3.5 2.8-.8 3.6l-6.3 3.8c-1.4.9-3 .5-3.8-.9L3.5 11.6c-.2-.5-.3-1.1-.3-1.7Z"
            fill={`url(#${uid})`}
          />
          {/* folded corner: triangle folding toward the viewer (warm gray shade) */}
          <path d="M3.6 9.4 10.5 4l.5 4.6-7.4 4.1V9.4Z" fill={PAPERLAB_COLORS.fold} />
          {/* fold face: the turned corner in paper white */}
          <path d="M3.6 9.4 10.5 4l.5 4.6-7.4 4.1V9.4Z" fill={PAPERLAB_COLORS.paper} opacity="0.92" transform="translate(0.4 -0.3)" />
        </g>
      )}
    </svg>
  )
}
