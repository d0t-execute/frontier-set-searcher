import { determineActiveSkills } from '../search-engine/active-skill-cap'
import type { NamedSkill } from '../search-engine/load-bundle'
import type { SkillId } from '../search-engine/types'
import type { NamedBuildResult } from './types'

export interface ResultsListProps {
  readonly results: readonly NamedBuildResult[]
  readonly skillNames: ReadonlyMap<SkillId, string>
  readonly skills: readonly NamedSkill[]
  readonly zenithSkills: readonly NamedSkill[]
}

export function ResultsList({ results, skillNames, skills, zenithSkills }: ResultsListProps) {
  if (results.length === 0) return null

  return (
    <ul className="list-unstyled d-flex flex-column gap-3" aria-label="Search results">
      {results.map((result, i) => (
        // eslint-disable-next-line react/no-array-index-key -- results have
        // no stable identity of their own; order is the only thing that can
        // change, and the list is append-only during a single search.
        <li key={i} className="border rounded p-3 text-start">
          <ResultCard
            result={result}
            skillNames={skillNames}
            skills={skills}
            zenithSkills={zenithSkills}
          />
        </li>
      ))}
    </ul>
  )
}

function ResultCard({
  result,
  skillNames,
  skills,
  zenithSkills,
}: {
  result: NamedBuildResult
  skillNames: ReadonlyMap<SkillId, string>
  skills: readonly NamedSkill[]
  zenithSkills: readonly NamedSkill[]
}) {
  const { cap, disabled } = determineActiveSkills(
    result.picks,
    result.skillTotals,
    skills,
    zenithSkills,
  )
  const disabledIds = new Set(disabled)
  return (
    <div>
      <dl className="row mb-2">
        {[...result.picks.entries()].map(([slotId, candidate]) => {
          const decorations = result.decorations.get(slotId) ?? []
          const usedSlots = decorations.reduce((sum, d) => sum + d.slotSize, 0)
          const openSlots = (candidate.openSlotCount ?? 0) - usedSlots

          return (
            <div key={slotId} className="col-12 d-flex gap-1">
              <dt className="text-capitalize">{slotId}:</dt>
              <dd className="mb-0">
                {candidate.name}
                {decorations.map((decoration, i) => (
                  <span key={i} className="text-muted">
                    {' '}
                    + {decoration.name}
                  </span>
                ))}
                {openSlots > 0 && (
                  <span className="text-muted">
                    {' '}
                    ({openSlots} open slot{openSlots === 1 ? '' : 's'})
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {result.cuffs.length > 0 && (
        <div className="mb-2">
          <span className="fw-bold">Cuffs:</span> {result.cuffs.map((cuff) => cuff.name).join(', ')}
        </div>
      )}

      <div className="small text-muted">
        Active skill cap: {cap}
        {disabledIds.size > 0 && (
          <span className="text-danger">
            {' '}
            ({disabledIds.size} skill{disabledIds.size === 1 ? '' : 's'} disabled)
          </span>
        )}
      </div>
      <div className="small text-muted">
        {[...result.skillTotals.entries()]
          .map(([skillId, points]) => {
            const name = skillNames.get(skillId) ?? `Skill ${skillId}`
            return disabledIds.has(skillId) ? `${name}: ${points} (disabled)` : `${name}: ${points}`
          })
          .join(', ')}
      </div>
    </div>
  )
}
