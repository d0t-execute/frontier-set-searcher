import type { SkillId } from '../search-engine/types'
import type { NamedBuildResult } from './types'

export interface ResultsListProps {
  readonly results: readonly NamedBuildResult[]
  readonly skillNames: ReadonlyMap<SkillId, string>
}

export function ResultsList({ results, skillNames }: ResultsListProps) {
  if (results.length === 0) return null

  return (
    <ul className="list-unstyled d-flex flex-column gap-3">
      {results.map((result, i) => (
        // eslint-disable-next-line react/no-array-index-key -- results have
        // no stable identity of their own; order is the only thing that can
        // change, and the list is append-only during a single search.
        <li key={i} className="border rounded p-3 text-start">
          <ResultCard result={result} skillNames={skillNames} />
        </li>
      ))}
    </ul>
  )
}

function ResultCard({
  result,
  skillNames,
}: {
  result: NamedBuildResult
  skillNames: ReadonlyMap<SkillId, string>
}) {
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

      <div className="small text-muted">
        {[...result.skillTotals.entries()]
          .map(([skillId, points]) => `${skillNames.get(skillId) ?? `Skill ${skillId}`}: ${points}`)
          .join(', ')}
      </div>
    </div>
  )
}
