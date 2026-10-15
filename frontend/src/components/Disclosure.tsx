import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export interface DisclosureProps {
  readonly title: string
  /** One-line description of the section's current state, shown next to the
   * title while collapsed (e.g. "2 skills required", "3 categories
   * excluded") -- lets a collapsed section still communicate what's active
   * without having to open it. Hidden once the section is open, since the
   * full content already shows that. */
  readonly summary?: string
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
export function Disclosure({ title, summary, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <section className="disclosure">
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
        {!open && summary && <span className="disclosure-summary">{summary}</span>}
      </button>
      <div className="disclosure-body" data-open={open} id={contentId}>
        <div className="disclosure-body-inner">{children}</div>
      </div>
    </section>
  )
}
