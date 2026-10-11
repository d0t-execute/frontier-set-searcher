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

export function SkillPicker({ skills, requirements, onChange }: SkillPickerProps) {
  const skillOf = (skillId: number) => skills.find((s) => s.id === skillId)
  const nameOf = (skillId: number) => skillOf(skillId)?.name ?? `Skill ${skillId}`
  const pickedIds = new Set(requirements.map((r) => r.skillId))
  const available = skills.filter((s) => !pickedIds.has(s.id))

  function addSkill(skillId: number): void {
    const tiers = skillOf(skillId)?.tiers ?? []
    onChange([...requirements, { skillId, minPoints: defaultMinPoints(tiers) }])
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
        {requirements.map((requirement) => {
          const tiers = skillOf(requirement.skillId)?.tiers ?? []
          return (
            <li key={requirement.skillId} className="d-flex align-items-center gap-2">
              <span className="flex-grow-1">{nameOf(requirement.skillId)}</span>
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

      <select
        className="form-select mt-2"
        aria-label="Add a skill"
        value=""
        onChange={(e) => {
          if (e.target.value) addSkill(Number(e.target.value))
        }}
      >
        <option value="" disabled>
          Add a skill…
        </option>
        {groupByCategory(available).map(([category, categorySkills]) => (
          <optgroup key={category} label={category}>
            {categorySkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
