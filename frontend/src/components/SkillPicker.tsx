import type { SkillRequirement } from '../search-engine/types'

export interface SkillOption {
  readonly id: number
  readonly name: string
}

export interface SkillPickerProps {
  readonly skills: readonly SkillOption[]
  readonly requirements: readonly SkillRequirement[]
  readonly onChange: (next: SkillRequirement[]) => void
}

const DEFAULT_MIN_POINTS = 1

export function SkillPicker({ skills, requirements, onChange }: SkillPickerProps) {
  const nameOf = (skillId: number) =>
    skills.find((s) => s.id === skillId)?.name ?? `Skill ${skillId}`
  const pickedIds = new Set(requirements.map((r) => r.skillId))
  const available = skills.filter((s) => !pickedIds.has(s.id))

  function addSkill(skillId: number): void {
    onChange([...requirements, { skillId, minPoints: DEFAULT_MIN_POINTS }])
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
        {requirements.map((requirement) => (
          <li key={requirement.skillId} className="d-flex align-items-center gap-2">
            <span className="flex-grow-1">{nameOf(requirement.skillId)}</span>
            <input
              type="number"
              className="form-control"
              style={{ width: '6rem' }}
              min={0}
              value={requirement.minPoints}
              onChange={(e) => setMinPoints(requirement.skillId, Number(e.target.value))}
            />
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              aria-label={`Remove ${nameOf(requirement.skillId)}`}
              onClick={() => remove(requirement.skillId)}
            >
              Remove
            </button>
          </li>
        ))}
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
        {available.map((skill) => (
          <option key={skill.id} value={skill.id}>
            {skill.name}
          </option>
        ))}
      </select>
    </div>
  )
}
