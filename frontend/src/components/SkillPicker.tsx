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
 * further on top.
 *
 * Each requirement also has a "Required / Prefer higher / Option N"
 * `<select>` (docs/feedback.md Round 3 #2, redesigned 2026-10-26 per the
 * project owner: the original checkbox-plus-conditional-priority-select
 * took up too much visual space and reads "big" per row -- a single compact
 * dropdown folds "is this optional," "which priority," and (2026-10-27)
 * "prefer a higher tier" into one control, at the cost of being a little
 * less self-explanatory than separate controls (that trade-off is why
 * `App.tsx`'s "About skills" info tooltip spells out what each choice
 * means -- "Option" is this UI's own label for what
 * `OptionalSkillRequirement.priority`/`MAX_OPTIONAL_SKILL_PRIORITY_TIERS`
 * call "priority" everywhere else, kept as-is at the data layer). Picking
 * "Required" flips `SkillRequirement.optional` to `false` and clears both
 * `priority` and `preferHigher`; picking "Prefer higher" keeps `optional`
 * false but sets `preferHigher` (still a hard requirement at the level
 * picked, plus a reward for every tier reached beyond it -- see
 * `ilp-model.ts`'s own docstring on `PREFER_HIGHER_TIER_WEIGHT` for exactly
 * how much, and where that ranks against an explicit "Option N"); picking an
 * "Option N" choice sets `optional`/`priority` and clears `preferHigher` --
 * the picked skill and its level don't change in any of the three cases.
 * Both "Required" and "Prefer higher" rows get a brighter accent outline
 * (see index.css's `.skill-requirement-select-required`) distinguishing
 * every hard requirement from a soft "Option N" preference at a glance, not
 * just by reading the text. See `OptionalSkillRequirement.priority`'s own
 * docstring for what happens when two requirements share a priority (here,
 * the same "Option N"). `App.tsx` splits the combined list on `optional`
 * right before calling `search()`.
 *
 * Hiden/Tech skills (e.g. GS Tech) are pinned to the top of the requirement
 * list, ahead of insertion order, and left out of the "1. 2. 3. ..." count
 * the rest of the list numbers through (2026-10-26, per the project owner --
 * they're a different kind of pick from the rest, so they shouldn't compete
 * for position in a ranked list or make later numbers look like they moved
 * for no reason). `active-skill-cap.ts`'s own exemption is cuff-sourced-only,
 * not a blanket exemption for the category, so the note shown above the
 * pinned group says exactly that rather than the simpler-but-wrong "Hiden
 * skills don't count toward the cap". */

import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { HIDEN_SKILL_CATEGORY } from '../search-engine/active-skill-cap'
import { MAX_OPTIONAL_SKILL_PRIORITY_TIERS } from '../search-engine/ilp-model'
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
  const isHiden = (skillId: number) => skillOf(skillId)?.category === HIDEN_SKILL_CATEGORY
  // Pinned (Hiden/Tech) requirements first, then the rest -- each group keeps
  // its own original relative order (`Array.prototype.sort` is a stable sort)
  // so pinning one to the top never reshuffles the others among themselves.
  const sortedRequirements = [...requirements].sort(
    (a, b) => Number(isHiden(b.skillId)) - Number(isHiden(a.skillId)),
  )
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

  // Single control for "is this optional (and if so, which priority), or
  // 'prefer higher'" (see this module's own docstring) -- `value` is the
  // literal string `'required'`, `'preferHigher'`, or a priority number's
  // string form, straight from the `<select>`'s own `value`/`<option
  // value>`, so the user's explicit pick always fully determines every
  // affected field at once; no separate "mark optional" step with an
  // implicit default priority to compute.
  function setRequirementKind(skillId: number, value: string): void {
    const preferHigher = value === 'preferHigher'
    const optional = value !== 'required' && !preferHigher
    const priority = optional ? Number(value) : undefined
    onChange(
      requirements.map((r) =>
        r.skillId === skillId
          ? { ...r, optional, priority, preferHigher: preferHigher || undefined }
          : r,
      ),
    )
  }

  const hasHiden = requirements.some((r) => isHiden(r.skillId))
  let nextNumber = 1
  return (
    <div>
      {hasHiden && (
        <div className="skill-requirement-hiden-info">
          Hiden/Tech skills only count toward the active skill cap exemption when granted by a cuff
          -- from armor or a weapon, they're capped like any other skill.
        </div>
      )}
      <ul className="list-unstyled d-flex flex-column gap-2">
        {sortedRequirements.map((requirement) => {
          const tiers = skillOf(requirement.skillId)?.tiers ?? []
          const hiden = isHiden(requirement.skillId)
          const number = hiden ? null : nextNumber++
          return (
            <li
              key={requirement.skillId}
              className={
                hiden
                  ? 'd-flex align-items-center gap-2 skill-requirement-hiden'
                  : 'd-flex align-items-center gap-2'
              }
            >
              <span className="flex-grow-1">
                {hiden ? (
                  <span className="skill-requirement-hiden-badge">Hiden/Tech</span>
                ) : (
                  `${number}. `
                )}{' '}
                <span>{nameOf(requirement.skillId)}</span>
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
              <select
                className={
                  requirement.optional
                    ? 'form-select form-select-sm'
                    : 'form-select form-select-sm skill-requirement-select-required'
                }
                style={{ width: 'auto' }}
                aria-label={`${nameOf(requirement.skillId)} requirement type`}
                value={
                  requirement.preferHigher
                    ? 'preferHigher'
                    : requirement.optional
                      ? String(requirement.priority ?? 1)
                      : 'required'
                }
                onChange={(e) => setRequirementKind(requirement.skillId, e.target.value)}
              >
                <option value="required">Required</option>
                {/* Only offered when a tier above the one currently picked
                    actually exists (see this module's own docstring) --
                    already being at the skill's own top tier leaves nothing
                    for "prefer higher" to reward. */}
                {tiers.some((t) => t.minPoints > requirement.minPoints) && (
                  <option value="preferHigher">Prefer higher</option>
                )}
                {Array.from({ length: MAX_OPTIONAL_SKILL_PRIORITY_TIERS }, (_, i) => i + 1).map(
                  (p) => (
                    <option key={p} value={p}>
                      Option {p}
                    </option>
                  ),
                )}
              </select>
              <button
                type="button"
                aria-label={`Remove ${nameOf(requirement.skillId)}`}
                className="btn-close btn-close-white"
                style={{ fontSize: '0.65rem' }}
                onClick={() => remove(requirement.skillId)}
              />
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
