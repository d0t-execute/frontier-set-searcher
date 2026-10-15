import { toPng } from 'html-to-image'
import { useRef, useState } from 'react'
import { determineActiveSkills } from '../search-engine/active-skill-cap'
import type { NamedCandidate, NamedResistances, NamedSkill, SkillTierRecord } from '../search-engine/load-bundle'
import type { SkillContribution, SkillId } from '../search-engine/types'
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

/** A tier label that's just a bare increment ("+1", "+2", "-1", ...) --
 * most Zenith skills' own tiers read this way (e.g. "Poison Res Up" has no
 * tier label beyond "+1"/"+2"), unlike a normal skill's, which are usually
 * already a complete display name on their own ("Gathering+2", "Attack Up
 * (Small)", "Sword Saint"). Only this bare-increment case needs the skill's
 * own name put back in front of it -- see `buildSkillEntry`'s own
 * docstring. */
const GENERIC_TIER_LABEL = /^[+-]\d+$/

interface SkillDisplayEntry {
  readonly skillId: SkillId
  readonly points: number
  /** The crossed tier's own label (e.g. "Stylish +1"), already a complete
   * display name on its own for most skills -- see `NamedSkill.tiers`'s own
   * docstring -- or the skill's own name (alone, or in front of a bare
   * increment tier label -- see `GENERIC_TIER_LABEL`) when the tier label
   * can't identify the skill by itself (2026-10-15, per the project owner:
   * repeating the skill's name *and* its tier label, e.g. "Assistance:
   * Assistance +1 (10/10)", was redundant; dropping the name whenever the
   * tier label already says it removes that without losing context for an
   * untiered skill, one that hasn't crossed any tier yet, or one -- mostly
   * Zenith skills -- whose tier label is just "+1"). */
  readonly label: string
  /** The point fraction alone, e.g. "17/15" or "12" for an untiered skill. */
  readonly value: string
  readonly crossed: boolean
  readonly disabled: boolean
  /** True once a *penalty* tier (a tier with a negative threshold, e.g.
   * Precision's "Deviation Up" at -10) is crossed -- flagged separately from
   * `crossed` so the card can call it out in the same warning color used
   * elsewhere, rather than looking identical to a beneficial tier (2026-10-
   * 16, per the project owner). */
  readonly negative: boolean
}

/** Resolves one skill total into its own display entry (docs/skill-system-
 * roadmap.md's result-card-redesign spec) -- once a tier is crossed, its own
 * label plus current points over its threshold; below every tier, plain
 * progress toward the weakest one. Untiered skills fall back to the bare
 * point total under the skill's own name.
 *
 * Negative thresholds (e.g. Precision's "Deviation Up" at -10) work as the
 * mirror image of positive ones: more-negative points cross *deeper* penalty
 * tiers, so among the negative tiers whose threshold points has reached
 * (points <= threshold), the one actually in effect is the most-negative one
 * reached, not the first one reached (2026-10-16, per the project owner: a
 * crossed negative tier was previously never detected at all, so its label
 * and threshold silently fell back to the skill's own name and its weakest
 * *positive* tier's threshold, e.g. "Precision (-13/10)" instead of
 * "Deviation Up (-13/-10)"). */
function buildSkillEntry(
  skillId: SkillId,
  points: number,
  tiers: readonly SkillTierRecord[],
  name: string,
  disabled: boolean,
): SkillDisplayEntry {
  // Both lists come out of `tiers` already sorted highest-threshold-first
  // (see `NamedSkill.tiers`'s own docstring), so the weakest positive tier is
  // last and the weakest (least severe) negative tier is first.
  const positiveTiers = tiers.filter((t) => t.minPoints >= 0)
  const negativeTiers = tiers.filter((t) => t.minPoints < 0)

  const crossedTier =
    points > 0
      ? positiveTiers.find((t) => points >= t.minPoints)
      : points < 0
        ? lastOrUndefined(negativeTiers.filter((t) => points <= t.minPoints))
        : undefined

  if (crossedTier) {
    const label = GENERIC_TIER_LABEL.test(crossedTier.label)
      ? `${name} ${crossedTier.label}`
      : crossedTier.label
    return {
      skillId,
      points,
      label,
      value: `${points}/${crossedTier.minPoints}`,
      crossed: true,
      disabled,
      negative: crossedTier.minPoints < 0,
    }
  }

  const weakestTier =
    points > 0
      ? positiveTiers[positiveTiers.length - 1]
      : points < 0
        ? negativeTiers[0]
        : undefined
  const value = weakestTier ? `${points}/${weakestTier.minPoints}` : String(points)
  return {
    skillId,
    points,
    label: name,
    value,
    crossed: tiers.length === 0 && points !== 0,
    disabled,
    negative: false,
  }
}

function lastOrUndefined<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined
}

/** Highest points first; disabled skills sort after every still-active one
 * but before skills that haven't crossed a threshold at all (2026-10-15, per
 * the project owner). */
function compareSkillEntries(a: SkillDisplayEntry, b: SkillDisplayEntry): number {
  const rank = (e: SkillDisplayEntry) => (e.disabled ? 1 : e.crossed ? 0 : 2)
  const rankDiff = rank(a) - rank(b)
  return rankDiff !== 0 ? rankDiff : b.points - a.points
}

function contributionSummary(
  contributions: readonly SkillContribution[],
  skillNames: ReadonlyMap<SkillId, string>,
): string | undefined {
  if (contributions.length === 0) return undefined
  return contributions
    .map((c) => `${skillNames.get(c.skillId) ?? `Skill ${c.skillId}`}: ${c.points}`)
    .join(', ')
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
  const [isDownloadingImage, setIsDownloadingImage] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  function handleGetShareUrl(): void {
    if (!getShareUrl) return
    setIsGeneratingShareUrl(true)
    void getShareUrl()
      .then(setShareUrl)
      .finally(() => setIsGeneratingShareUrl(false))
  }

  function handleDownloadImage(): void {
    const card = cardRef.current
    if (!card) return
    setIsDownloadingImage(true)
    // Captured against the page's own current background color (rather than
    // a fixed white/transparent default) so a dark-mode screenshot doesn't
    // come out with light gaps between the card's columns.
    void toPng(card, { backgroundColor: getComputedStyle(document.body).backgroundColor })
      .then((dataUrl) => {
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = 'frontier-build.png'
        link.click()
      })
      .finally(() => setIsDownloadingImage(false))
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
  const tiersById = new Map(
    [...skills, ...zenithSkills].map((skill) => [skill.id, skill.tiers] as const),
  )
  const skillEntries = [...result.skillTotals.entries()].map(([skillId, points]) =>
    buildSkillEntry(
      skillId,
      points,
      tiersById.get(skillId) ?? [],
      skillNames.get(skillId) ?? `Skill ${skillId}`,
      disabledIds.has(skillId),
    ),
  )
  const regularSkillEntries = skillEntries
    .filter((e) => !zenithSkillIds.has(e.skillId))
    .sort(compareSkillEntries)
  const zenithSkillEntries = skillEntries
    .filter((e) => zenithSkillIds.has(e.skillId))
    .sort(compareSkillEntries)
  const { totalDefense, resistances } = sumStats(result.picks)

  function renderSkillEntry(entry: SkillDisplayEntry, showValue = true) {
    const inactive = entry.disabled || !entry.crossed
    // An active penalty tier gets the same warning color used for the
    // disabled-skill-count callout elsewhere on the card, rather than
    // looking identical to a beneficial tier (2026-10-16, per the project
    // owner); a disabled skill keeps its own gray "inactive" look instead.
    const warning = entry.negative && !entry.disabled
    const className =
      [inactive ? 'result-skill-inactive' : null, warning ? 'text-danger' : null]
        .filter(Boolean)
        .join(' ') || undefined
    return (
      <div key={entry.skillId} className={className}>
        <span className="result-skill-level">{entry.label}</span>
        {showValue && (
          <>
            {' '}
            <span className="result-skill-value">({entry.value})</span>
          </>
        )}
        {entry.disabled && ' (disabled)'}
      </div>
    )
  }

  return (
    <div className="result-card" ref={cardRef}>
      <div className="result-column">
        <h3 className="result-column-heading">Skills</h3>
        <div className="small">{regularSkillEntries.map((entry) => renderSkillEntry(entry))}</div>
        {zenithSkillEntries.length > 0 && (
          <div className="small mt-2">
            <span className="fw-bold">Zenith skills:</span>
            <div>{zenithSkillEntries.map((entry) => renderSkillEntry(entry, false))}</div>
          </div>
        )}
      </div>

      <div className="result-column">
        <h3 className="result-column-heading">Picks</h3>
        <dl className="row mb-2">
          {[...result.picks.entries()].map(([slotId, candidate]) => {
            const decorations = result.decorations.get(slotId) ?? []
            const usedSlots = decorations.reduce((sum, d) => sum + d.slotSize, 0)
            const openSlots = (candidate.openSlotCount ?? 0) - usedSlots

            return (
              <div key={slotId} className="col-12">
                <div className="d-flex gap-1">
                  <dt className="text-capitalize">{slotId}:</dt>
                  <dd className="mb-0" title={contributionSummary(candidate.skills, skillNames)}>
                    {candidate.name}
                    {openSlots > 0 && (
                      <span className="result-muted">
                        {' '}
                        ({openSlots} open slot{openSlots === 1 ? '' : 's'})
                      </span>
                    )}
                  </dd>
                </div>
                {decorations.length > 0 && (
                  <div className="category-group-children result-decoration-list">
                    {decorations.map((decoration, i) => (
                      <div
                        key={i}
                        className="category-leaf"
                        title={contributionSummary(decoration.skills, skillNames)}
                      >
                        {decoration.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </dl>

        {result.cuffs.length > 0 && (
          <div className="mb-2">
            <span className="fw-bold">Cuffs:</span>{' '}
            {result.cuffs.map((cuff) => cuff.name).join(', ')}
          </div>
        )}
      </div>

      <div className="result-column d-flex flex-column">
        <h3 className="result-column-heading">Stats</h3>
        <div className="small">
          Active skill cap: {cap}
          {disabledIds.size > 0 && (
            <span className="text-danger">
              {' '}
              ({disabledIds.size} skill{disabledIds.size === 1 ? '' : 's'} disabled)
            </span>
          )}
        </div>
        <div className="small mt-2">Total defense: {totalDefense}</div>
        <div className="small">
          Fire: {resistances.fire}, Water: {resistances.water}, Thunder: {resistances.thunder}, Ice:{' '}
          {resistances.ice}, Dragon: {resistances.dragon}
        </div>

        <div className="mt-auto pt-2 d-flex justify-content-end align-items-center gap-2">
          {getShareUrl &&
            (shareUrl ? (
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
            ))}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            disabled={isDownloadingImage}
            onClick={handleDownloadImage}
          >
            {isDownloadingImage ? 'Downloading…' : 'Download as image'}
          </button>
        </div>
      </div>
    </div>
  )
}
