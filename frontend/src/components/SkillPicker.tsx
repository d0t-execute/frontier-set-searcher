/**
 * "Add a skill" is a live-filtered, always-grouped list rather than a plain
 * `<select>` (2026-10-15, per the project owner: finding a skill in a flat
 * ~194-entry dropdown was hard enough to need its own search field). Unlike
 * `FilterableOptions` (ArmorPicker/CuffPicker's own type-to-filter list, built
 * for catalogs in the tens of thousands), this catalog is small enough to
 * render in full by default -- there's no `MIN_SEARCH_LENGTH` gate, and
 * `groupByCategory`'s existing grouping stays intact (now as visible
 * `role="group"` headings) so browsing by category still works exactly as it
 * did through the old dropdown's `<optgroup>`s, with typing narrowing it
 * further on top. */

import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { SkillRequirement } from '../search-engine/types'

export interface SkillTierOption {
  readonly label: string
  readonly minPoints: number
  readonly description: string | null
}

export interface SkillOption {
  readonly id: number
  readonly name: string
  readonly category: string | null
  readonly tiers: readonly SkillTierOption[]
}

export interface SkillPickerProps {
  readonly skills: readonly SkillOption[]
  readonly requirements: readonly SkillRequirement[]
  readonly onChange: (next: SkillRequirement[]) => void
  /** Accessible name (and placeholder text) for the "add a skill" control --
   * distinguishes multiple `SkillPicker` instances on the same page (e.g.
   * normal vs. Zenith skills in App.tsx), since otherwise both would render
   * an identically-labeled "Add a skill…" control. */
  readonly addLabel?: string
}

const DEFAULT_MIN_POINTS = 1

const UNCATEGORIZED = 'Other'

/** The level to default a newly-added skill to: its strongest non-penalty
 * tier (docs/skill-system-roadmap.md TODO #22, 2026-10-18 per the project
 * owner -- reversing TODO #15's original "weakest commitment that still
 * turns the skill on" default) -- falling back to the first tier if every
 * tier is a penalty. `tiers` comes pre-sorted highest-threshold-first
 * (confirmed against the real `skills.json`, e.g. Attack's `[80, 50, 25, 15,
 * 10]`), so the strongest positive tier is simply the first non-negative
 * entry encountered. */
function defaultMinPoints(tiers: readonly SkillTierOption[]): number {
  if (tiers.length === 0) return DEFAULT_MIN_POINTS
  const strongestPositive = tiers.find((t) => t.minPoints >= 0)
  return (strongestPositive ?? tiers[0]).minPoints
}

/** The category display order, fixed once from the *full* skill catalog
 * (first-seen order, which mirrors the source site's own curated section
 * order, e.g. "Health and Stamina" before "Attack Skills") -- uncategorized
 * skills are grouped under "Other", placed last regardless of where they were
 * first seen. Computed separately from `groupByCategory` below (see
 * docs/skill-system-roadmap.md TODO #36) so a category's position stays fixed
 * even as picking skills shrinks the *filtered* list it buckets -- otherwise
 * a category would jump around (or vanish and reappear) depending on which of
 * its skills are still unpicked/matching. */
function categoryOrder(skills: readonly SkillOption[]): readonly string[] {
  const seen: string[] = []
  for (const skill of skills) {
    const category = skill.category ?? UNCATEGORIZED
    if (!seen.includes(category)) seen.push(category)
  }
  return [
    ...seen.filter((c) => c !== UNCATEGORIZED),
    ...(seen.includes(UNCATEGORIZED) ? [UNCATEGORIZED] : []),
  ]
}

/** Buckets `skills` into the given, already-fixed category `order`, dropping
 * any category with nothing left in this (filtered) list -- a category still
 * disappears once nothing in it is left to pick/match, but the *relative*
 * order of whatever remains never changes. */
function groupByCategory(
  skills: readonly SkillOption[],
  order: readonly string[],
): readonly (readonly [string, SkillOption[]])[] {
  const groups = new Map<string, SkillOption[]>()
  for (const skill of skills) {
    const category = skill.category ?? UNCATEGORIZED
    const existing = groups.get(category)
    if (existing) existing.push(skill)
    else groups.set(category, [skill])
  }
  return order.flatMap((category) => {
    const items = groups.get(category)
    return items ? [[category, items] as const] : []
  })
}

export function SkillPicker({
  skills,
  requirements,
  onChange,
  addLabel = 'Add a skill',
}: SkillPickerProps) {
  const [search, setSearch] = useState('')
  // Refocused after every `addSkill` (docs/skill-system-roadmap.md TODO #23)
  // so clicking a suggestion doesn't lose focus to that button -- adding
  // several skills in a row (via Enter *or* a click) never needs reaching
  // for the mouse in between. Enter itself never loses focus in the first
  // place (the keydown fires on this same input), but a click does, so this
  // covers both paths uniformly.
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Which of `flatMatches` below is the keyboard/mouse-highlighted one --
  // lets Enter add a skill without the mouse (2026-10-17, per the project
  // owner: "type a skill name, enter... rather than having to... click on
  // the result"). Reset to the first match on every search change (and after
  // adding one) so the common type-then-Enter flow always lands on what's
  // on top, the same way a browser address bar's own autocomplete does.
  const [activeIndex, setActiveIndex] = useState(0)
  const skillOf = (skillId: number) => skills.find((s) => s.id === skillId)
  const nameOf = (skillId: number) => skillOf(skillId)?.name ?? `Skill ${skillId}`
  const pickedIds = new Set(requirements.map((r) => r.skillId))
  const available = skills.filter((s) => !pickedIds.has(s.id))
  const query = search.trim().toLowerCase()
  // Matches a skill's own name OR any of its tier labels (docs/feedback.md
  // Round 2 #8, 2026-10-19 per the project owner) -- e.g. typing "BBQ
  // Master" surfaces "Cooking", since that's one of its tier names, not its
  // own. Confirmed against the real catalog (skills.json) that tier labels
  // are frequently distinct, more specific names than the skill itself.
  const matching = query
    ? available.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.tiers.some((t) => t.label.toLowerCase().includes(query)),
      )
    : available
  const groupedMatches = groupByCategory(matching, categoryOrder(skills))
  const flatMatches = groupedMatches.flatMap(([, categorySkills]) => categorySkills)
  const clampedActiveIndex =
    flatMatches.length === 0 ? -1 : Math.min(activeIndex, flatMatches.length - 1)

  function addSkill(skillId: number): void {
    const tiers = skillOf(skillId)?.tiers ?? []
    onChange([...requirements, { skillId, minPoints: defaultMinPoints(tiers) }])
    setSearch('')
    setActiveIndex(0)
    searchInputRef.current?.focus()
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (flatMatches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % flatMatches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + flatMatches.length) % flatMatches.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      addSkill(flatMatches[clampedActiveIndex].id)
    }
  }

  function setMinPoints(skillId: number, minPoints: number): void {
    onChange(requirements.map((r) => (r.skillId === skillId ? { ...r, minPoints } : r)))
  }

  function remove(skillId: number): void {
    onChange(requirements.filter((r) => r.skillId !== skillId))
  }

  return (
    <div>
      <ul className="list-unstyled d-flex flex-column gap-2">
        {requirements.map((requirement, index) => {
          const tiers = skillOf(requirement.skillId)?.tiers ?? []
          return (
            <li key={requirement.skillId} className="d-flex align-items-center gap-2">
              <span className="flex-grow-1">
                {index + 1}. <span>{nameOf(requirement.skillId)}</span>
              </span>
              {tiers.length > 0 ? (
                <select
                  className="form-select"
                  style={{ width: 'auto' }}
                  aria-label={`${nameOf(requirement.skillId)} level`}
                  value={requirement.minPoints}
                  onChange={(e) => setMinPoints(requirement.skillId, Number(e.target.value))}
                >
                  {tiers.map((tier) => (
                    <option key={tier.label} value={tier.minPoints}>
                      {tier.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  className="form-control"
                  style={{ width: '6rem' }}
                  min={0}
                  value={requirement.minPoints}
                  onChange={(e) => setMinPoints(requirement.skillId, Number(e.target.value))}
                />
              )}
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                aria-label={`Remove ${nameOf(requirement.skillId)}`}
                onClick={() => remove(requirement.skillId)}
              >
                Remove
              </button>
            </li>
          )
        })}
      </ul>

      <div className="skill-add mt-2">
        <input
          ref={searchInputRef}
          type="text"
          className="form-control"
          aria-label={addLabel}
          placeholder={`${addLabel}…`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleSearchKeyDown}
        />
        <div className="skill-add-results">
          {matching.length === 0 && <div className="skill-add-empty">No matches.</div>}
          {groupedMatches.map(([category, categorySkills]) => (
            <div key={category} className="skill-add-group" role="group" aria-label={category}>
              <div className="skill-add-group-label">{category}</div>
              {categorySkills.map((skill) => {
                const flatIndex = flatMatches.indexOf(skill)
                const active = flatIndex === clampedActiveIndex
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={
                      active ? 'skill-add-option skill-add-option-active' : 'skill-add-option'
                    }
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() => addSkill(skill.id)}
                  >
                    {skill.name}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
