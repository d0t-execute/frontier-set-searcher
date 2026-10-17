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

import { useState } from 'react'
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

/** The level to default a newly-added skill to: its weakest non-penalty
 * tier, since that's the smallest commitment that still turns the skill on
 * -- falling back to the first tier only if every tier is a penalty. */
function defaultMinPoints(tiers: readonly SkillTierOption[]): number {
  if (tiers.length === 0) return DEFAULT_MIN_POINTS
  const weakestPositive = [...tiers].reverse().find((t) => t.minPoints >= 0)
  return (weakestPositive ?? tiers[0]).minPoints
}

/** Groups skills by category, preserving each category's first-seen order
 * (which mirrors the source site's own curated section order, e.g. "Health
 * and Stamina" before "Attack Skills") rather than resorting alphabetically.
 * Uncategorized skills are grouped under "Other", placed last regardless of
 * where they were first seen, so stragglers don't interrupt that order. */
function groupByCategory(
  skills: readonly SkillOption[],
): readonly (readonly [string, SkillOption[]])[] {
  const groups = new Map<string, SkillOption[]>()
  for (const skill of skills) {
    const category = skill.category ?? UNCATEGORIZED
    const existing = groups.get(category)
    if (existing) existing.push(skill)
    else groups.set(category, [skill])
  }
  const uncategorized = groups.get(UNCATEGORIZED)
  groups.delete(UNCATEGORIZED)
  const ordered = [...groups.entries()]
  if (uncategorized) ordered.push([UNCATEGORIZED, uncategorized])
  return ordered
}

export function SkillPicker({
  skills,
  requirements,
  onChange,
  addLabel = 'Add a skill',
}: SkillPickerProps) {
  const [search, setSearch] = useState('')
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
  const matching = query ? available.filter((s) => s.name.toLowerCase().includes(query)) : available
  const groupedMatches = groupByCategory(matching)
  const flatMatches = groupedMatches.flatMap(([, categorySkills]) => categorySkills)
  const clampedActiveIndex = flatMatches.length === 0 ? -1 : Math.min(activeIndex, flatMatches.length - 1)

  function addSkill(skillId: number): void {
    const tiers = skillOf(skillId)?.tiers ?? []
    onChange([...requirements, { skillId, minPoints: defaultMinPoints(tiers) }])
    setSearch('')
    setActiveIndex(0)
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
                    className={active ? 'skill-add-option skill-add-option-active' : 'skill-add-option'}
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
