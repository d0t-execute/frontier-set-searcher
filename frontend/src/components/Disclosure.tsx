import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export interface DisclosureProps {
  readonly title: string
  /** One-line description of the section's current state, shown next to the
   * title (e.g. "2 skills required", "3 categories excluded") -- lets a
   * collapsed section still communicate what's active without having to open
   * it. Stays visible once open too (2026-10-17, per the project owner: a
   * section's own body shouldn't need to duplicate this as a separate line --
   * see docs/skill-system-roadmap.md TODO #34), so a caller with content that
   * already restates this once expanded (e.g. `SkillPicker`'s picked-count
   * line) should drop its own copy rather than show the same count twice. */
  readonly summary?: string
  /** An `InfoTooltip` (or any other node) shown next to the title, outside
   * the toggle button itself -- a nested `<button>` inside this component's
   * own toggle `<button>` would be invalid HTML and unreachable by keyboard
   * independently of the toggle, so it renders as a sibling instead
   * (2026-10-20, per the project owner: "move the explaining text over to
   * hoverable info icons" -- see `InfoTooltip.tsx`). Visible whether the
   * section is open or closed, same as `summary`. */
  readonly info?: ReactNode
  readonly defaultOpen?: boolean
  readonly children: ReactNode
}

/** A collapsible section (see docs/skill-system-roadmap.md TODO #10) --
 * this app's own fifteen-odd filter controls each get one of these instead
 * of being permanently expanded, so the page reads as a short list of named,
 * closed panels rather than one long wall of form controls.
 *
 * Deliberately doesn't unmount or `display:none` its content while closed
 * (just animates it to zero height via the CSS grid-rows trick, see
 * App.css) -- keeps every control inside reachable by both this project's
 * existing tests (which query controls directly, with no "open the section
 * first" step) and assistive tech that tabs through the page, at the minor
 * cost of a collapsed section's controls still being keyboard-reachable.
 * Acceptable trade-off for this pass -- see the roadmap doc. */
export function Disclosure({
  title,
  summary,
  info,
  defaultOpen = false,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <section className="disclosure">
      <div className="disclosure-header-row">
        <button
          type="button"
          className="disclosure-header"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="disclosure-chevron" aria-hidden="true">
            ▸
          </span>
          <span className="disclosure-title">{title}</span>
          {summary && <span className="disclosure-summary">{summary}</span>}
        </button>
        {info && <span className="disclosure-info">{info}</span>}
      </div>
      <div className="disclosure-body" data-open={open} id={contentId}>
        <div className="disclosure-body-inner">{children}</div>
      </div>
    </section>
  )
}
