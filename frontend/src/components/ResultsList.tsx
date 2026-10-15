import { useState } from 'react'
import { determineActiveSkills } from '../search-engine/active-skill-cap'
import type { NamedCandidate, NamedResistances, NamedSkill } from '../search-engine/load-bundle'
import type { SkillId } from '../search-engine/types'
import type { NamedBuildResult } from './types'

/** Summed across every pick in a result (armor, weapon, cuffs aren't picks
 * here -- see `NamedBuildResult.picks`). Weapons and cuffs carry no defense/
 * resistance data at all (confirmed against the raw data, see
 * docs/data-format-notes.md: the "deco" bucket's Cuff rows and the weapon
 * buckets have no F/W/T/D/I/DEF columns, a different row shape from armor),
 * so in practice only armor picks ever contribute a non-zero amount here --
 * but summing every pick regardless costs nothing, since a non-armor pick's
 * own placeholder values (`null`/all-zero, see `build-query.ts`'s
 * `NO_RESISTANCES`) are additive no-ops. `defenseMax` (not `defenseBase`) is
 * used for "Total defense" -- the fully-forged value is what a hunter
 * actually cares about reaching, the same reasoning
 * docs/data-format-notes.md gives for storing it at all. */
function sumStats(picks: ReadonlyMap<string, NamedCandidate>): {
  readonly totalDefense: number
  readonly resistances: NamedResistances
} {
  let totalDefense = 0
  const resistances = { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 }
  for (const candidate of picks.values()) {
    totalDefense += candidate.defenseMax ?? 0
    resistances.fire += candidate.resistances.fire
    resistances.water += candidate.resistances.water
    resistances.thunder += candidate.resistances.thunder
    resistances.ice += candidate.resistances.ice
    resistances.dragon += candidate.resistances.dragon
  }
  return { totalDefense, resistances }
}

export interface ResultsListProps {
  readonly results: readonly NamedBuildResult[]
  readonly skillNames: ReadonlyMap<SkillId, string>
  readonly skills: readonly NamedSkill[]
  readonly zenithSkills: readonly NamedSkill[]
  /** When given, each card gets a "Get shareable link" button that calls this
   * with the card's own index to produce the link (docs/skill-system-roadmap.md
   * TODO #9) -- omitted entirely (no button at all) when not provided, e.g.
   * `ResultPage.tsx` rendering a single already-shared result has no further
   * index to share. */
  readonly getShareUrl?: (index: number) => Promise<string>
}

export function ResultsList({
  results,
  skillNames,
  skills,
  zenithSkills,
  getShareUrl,
}: ResultsListProps) {
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
            getShareUrl={getShareUrl ? () => getShareUrl(i) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}

export interface ResultCardProps {
  readonly result: NamedBuildResult
  readonly skillNames: ReadonlyMap<SkillId, string>
  readonly skills: readonly NamedSkill[]
  readonly zenithSkills: readonly NamedSkill[]
  readonly getShareUrl?: () => Promise<string>
}

/** Exported so `ResultPage.tsx` (a shared single-result link, see
 * docs/skill-system-roadmap.md TODO #9) can render exactly the same card the
 * main search page's results list does, instead of a second, drifting copy
 * of this rendering. */
export function ResultCard({
  result,
  skillNames,
  skills,
  zenithSkills,
  getShareUrl,
}: ResultCardProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [isGeneratingShareUrl, setIsGeneratingShareUrl] = useState(false)

  function handleGetShareUrl(): void {
    if (!getShareUrl) return
    setIsGeneratingShareUrl(true)
    void getShareUrl()
      .then(setShareUrl)
      .finally(() => setIsGeneratingShareUrl(false))
  }
  const { cap, disabled } = determineActiveSkills(
    result.picks,
    result.skillTotals,
    skills,
    zenithSkills,
    result.cuffs,
  )
  const disabledIds = new Set(disabled)
  const zenithSkillIds = new Set(zenithSkills.map((s) => s.id))
  const skillEntries = [...result.skillTotals.entries()]
  const regularSkillEntries = skillEntries.filter(([skillId]) => !zenithSkillIds.has(skillId))
  const zenithSkillEntries = skillEntries.filter(([skillId]) => zenithSkillIds.has(skillId))
  const formatSkillEntry = ([skillId, points]: readonly [SkillId, number]): string => {
    const name = skillNames.get(skillId) ?? `Skill ${skillId}`
    return disabledIds.has(skillId) ? `${name}: ${points} (disabled)` : `${name}: ${points}`
  }
  const { totalDefense, resistances } = sumStats(result.picks)
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
      <div className="small text-muted">Total defense: {totalDefense}</div>
      <div className="small text-muted">
        Fire: {resistances.fire}, Water: {resistances.water}, Thunder: {resistances.thunder}, Ice:{' '}
        {resistances.ice}, Dragon: {resistances.dragon}
      </div>
      <div className="small text-muted">{regularSkillEntries.map(formatSkillEntry).join(', ')}</div>
      {zenithSkillEntries.length > 0 && (
        <div className="small text-muted">
          <span className="fw-bold">Zenith skills:</span>{' '}
          {zenithSkillEntries.map(formatSkillEntry).join(', ')}
        </div>
      )}

      {getShareUrl && (
        <div className="mt-2">
          {shareUrl ? (
            <div className="d-flex gap-2 align-items-center">
              <input
                type="text"
                className="form-control form-control-sm"
                aria-label="Shareable link"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => void navigator.clipboard?.writeText(shareUrl)}
              >
                Copy
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={isGeneratingShareUrl}
              onClick={handleGetShareUrl}
            >
              {isGeneratingShareUrl ? 'Generating link…' : 'Get shareable link'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
