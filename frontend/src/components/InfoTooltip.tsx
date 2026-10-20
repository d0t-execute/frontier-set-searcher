import type { ReactNode } from 'react'

export interface InfoTooltipProps {
  readonly children: ReactNode
  /** Accessible label for the icon itself (not the tooltip content) -- give
   * something specific when a page has several of these at once (e.g. "About
   * pinning armor"), since "More info" alone wouldn't tell them apart. */
  readonly label: string
}

/**
 * A small "i" icon that reveals explanatory text in a floating tooltip on
 * hover or keyboard focus, instead of that text sitting inline as its own
 * permanent paragraph (2026-10-20, per the project owner: "clean up the
 * UI... move the explaining text over to hoverable info icons" -- several of
 * this app's Disclosure sections opened with 2-4 lines of `form-text` before
 * their actual controls).
 *
 * Pure CSS show/hide (`:hover`/`:focus-within` in index.css), not JS state --
 * nothing here needs to track open/closed, and `:focus-within` means the
 * tooltip also appears on keyboard Tab focus (not just mouse hover) and on
 * tap-then-focus for touch/screen-reader users, for free. `children` can be
 * arbitrary JSX (bold text, line breaks via `<br />`), unlike a plain `title`
 * attribute, which only renders plain text.
 */
export function InfoTooltip({ children, label }: InfoTooltipProps) {
  return (
    <span className="info-tooltip">
      <button type="button" className="info-tooltip-icon" aria-label={label}>
        i
      </button>
      <span className="info-tooltip-content" role="tooltip">
        {children}
      </span>
    </span>
  )
}
