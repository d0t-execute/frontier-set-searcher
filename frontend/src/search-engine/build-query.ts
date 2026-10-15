/**
 * Pure query-construction logic shared between the main search page
 * (`App.tsx`) and the dedicated shared-result page (`ResultPage.tsx`, see
 * docs/skill-system-roadmap.md TODO #9) -- both need to turn the same form
 * state (category exclusions, pinned armor/cuffs, weapon controls) plus a
 * `DataBundle` into the exact `slots`/`cuffs`/`pinnedCuffs` `search()` takes.
 * Extracted out of `App.tsx` (where this used to live as closures over its
 * own `useState`) so a shared-result link can reconstruct the identical
 * query from its decoded state without a second, drifting copy of this
 * logic.
 */

import type {
  DataBundle,
  NamedCandidate,
  NamedCuff,
  NamedDecoration,
  NamedResistances,
  NamedSlotQuery,
} from './load-bundle'
import type { PinnedSlot } from './pinned-armor'

// The weapon slot is virtual and carries no defense/resistance data of its
// own (confirmed against the raw data -- see docs/data-format-notes.md: the
// `equip.js` weapon buckets have no F/W/T/D/I/DEF columns at all, a wholly
// different row shape from armor), so every synthesized weapon candidate
// gets these placeholder zero values.
const NO_RESISTANCES: NamedResistances = { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 }

/** Which Hunter Type the solver is allowed to equip (confirmed by the
 * project owner, 2026-10-15): Blademaster- and Gunner-restricted armor
 * can't be mixed in the same build at all, since in-game Hunter Type is
 * fixed by weapon choice, not per-piece -- there's no "either" option that
 * stays correct, only a required choice between the two. A "common"-
 * restricted piece (nearly all head pieces, plus a minority of other slots)
 * fits either and is never filtered out. */
export type HunterTypeFilter = 'blademaster' | 'gunner'

/** Key used for the weapon Zenith-skill checklist's "carries no Zenith skill
 * at all" leaf -- every real Zenith skill id is a positive number (see
 * etl/src/etl/export.py's `ZENITH_SKILL_ID_OFFSET`), so this string can never
 * collide with one. */
export const WEAPON_NO_ZENITH_SKILL_KEY = 'none'

/** Every control that shapes a query besides the skill requirements
 * themselves (kept separate since requirements are passed to `search()`
 * directly, untouched by any of this). */
export interface QueryFormState {
  readonly excludedCategories: ReadonlySet<string>
  readonly excludedCuffCategories: ReadonlySet<string>
  readonly excludedDecorationCategories: ReadonlySet<string>
  readonly excludedWeaponZenithSkillIds: ReadonlySet<string>
  readonly weaponSlotCount: number
  readonly hunterTypeFilter: HunterTypeFilter
  readonly pinnedArmor: ReadonlyMap<string, PinnedSlot>
  /** Up to `MAX_EQUIPPED_CUFFS` cuff ids, index 0 = cuff slot 1 -- see
   * `CuffPicker.tsx`'s own docstring. */
  readonly pinnedCuffIds: readonly string[]
  /** Decorations forced into a slot without pinning which candidate fills it
   * (docs/skill-system-roadmap.md TODO #12) -- keyed by `slotId`, a flat list
   * of decoration ids with duplicates allowed for multiple copies, same
   * convention as a `PinnedSlot`'s own `decorationIds`. A slot present in
   * `pinnedArmor` already bakes its own decorations in and takes priority --
   * see `resolvePinnedSlotDecorations`. */
  readonly pinnedSlotDecorationIds: ReadonlyMap<string, readonly string[]>
}

// The weapon slot is virtual (see etl/src/etl/export.py's module docstring --
// a weapon's identity never matters to this tool, only which Zenith skill, if
// any, it carries), so its candidates are synthesized here from the bundle's
// id list and the form state instead of loaded as-is like every other slot.
// Always has at least one candidate (falling back to "no Zenith skill" if the
// checklist excludes everything) so the mandatory one-per-slot choice this
// slot takes in `buildModel` never finds itself with nothing to choose from.
export function buildWeaponSlot(bundle: DataBundle, state: QueryFormState): NamedSlotQuery {
  const nameById = new Map(bundle.zenithSkills.map((skill) => [skill.id, skill.name]))
  const candidates: NamedCandidate[] = []
  if (!state.excludedWeaponZenithSkillIds.has(WEAPON_NO_ZENITH_SKILL_KEY)) {
    candidates.push({
      id: 'weapon:none',
      name: 'Plain weapon (no Zenith skill)',
      category: 'weapon',
      grankOrLater: false,
      hunterType: 'common',
      exoticSkillId: null,
      defenseMax: null,
      resistances: NO_RESISTANCES,
      skills: [],
      openSlotCount: state.weaponSlotCount,
    })
  }
  for (const id of bundle.weaponZenithSkillIds) {
    if (state.excludedWeaponZenithSkillIds.has(String(id))) continue
    const name = nameById.get(id) ?? `Zenith skill ${id}`
    candidates.push({
      id: `weapon:${id}`,
      name: `Zenith weapon (${name})`,
      category: 'weapon',
      grankOrLater: false,
      hunterType: 'common',
      exoticSkillId: null,
      defenseMax: null,
      resistances: NO_RESISTANCES,
      skills: [{ skillId: id, points: 1 }],
      openSlotCount: state.weaponSlotCount,
    })
  }
  if (candidates.length === 0) {
    candidates.push({
      id: 'weapon:none',
      name: 'Plain weapon (no Zenith skill)',
      category: 'weapon',
      grankOrLater: false,
      hunterType: 'common',
      exoticSkillId: null,
      defenseMax: null,
      resistances: NO_RESISTANCES,
      skills: [],
      openSlotCount: state.weaponSlotCount,
    })
  }
  return { slotId: 'weapon', candidates }
}

export function slotsAfterCategoryFilter(
  slots: readonly NamedSlotQuery[],
  excludedCategories: ReadonlySet<string>,
): NamedSlotQuery[] {
  if (excludedCategories.size === 0) return [...slots]
  return slots.map((slot) => ({
    ...slot,
    candidates: slot.candidates.filter((c) => !excludedCategories.has(c.category)),
  }))
}

/** Drops every candidate restricted to the Hunter Type the build isn't using
 * (see `HunterTypeFilter`'s own docstring) -- a "common" piece is never
 * filtered, and a pinned slot (`slotsAfterPinning`, applied after this)
 * overrides this entirely the same way it overrides the gear-level filter,
 * since a piece the player explicitly pinned shouldn't be silently blocked
 * by it. */
export function slotsAfterHunterTypeFilter(
  slots: readonly NamedSlotQuery[],
  hunterTypeFilter: HunterTypeFilter,
): NamedSlotQuery[] {
  return slots.map((slot) => ({
    ...slot,
    candidates: slot.candidates.filter(
      (c) => c.hunterType === 'common' || c.hunterType === hunterTypeFilter,
    ),
  }))
}

// A pinned slot is forced by narrowing its candidate list down to exactly one
// synthesized candidate -- the same technique `buildWeaponSlot` already uses,
// not new ILP machinery (see docs/skill-system-roadmap.md TODO #7):
// `buildModel`'s per-slot "exactly one candidate" row already forces the
// solver's hand once there's only one option. The user's chosen decorations
// are baked directly into this candidate's own `skills` (merged by skillId)
// and its `openSlotCount` is reduced by their total size, so the solver can
// still freely fill whatever capacity is left over; they're also folded into
// the displayed name (mirroring the weapon slot's own "Zenith weapon
// (<skill>)" convention) since they're never a solver "placement"
// `ResultsList` would otherwise show. Overrides the category filter for this
// slot entirely -- a piece the player explicitly pinned shouldn't be silently
// blocked by an unrelated gear-level checkbox.
export function slotsAfterPinning(
  slots: readonly NamedSlotQuery[],
  decorations: readonly NamedDecoration[],
  bundleSlots: readonly NamedSlotQuery[],
  pinnedArmor: ReadonlyMap<string, PinnedSlot>,
): NamedSlotQuery[] {
  if (pinnedArmor.size === 0) return [...slots]
  const decorationsById = new Map(decorations.map((d) => [d.id, d]))
  return slots.map((slot) => {
    const pin = pinnedArmor.get(slot.slotId)
    if (!pin) return slot
    const original = bundleSlots
      .find((s) => s.slotId === slot.slotId)
      ?.candidates.find((c) => c.id === pin.candidateId)
    if (!original) return slot

    const placedDecorations = pin.decorationIds
      .map((id) => decorationsById.get(id))
      .filter((d): d is NamedDecoration => d !== undefined)
    const skillTotals = new Map(original.skills.map((s) => [s.skillId, s.points]))
    for (const decoration of placedDecorations) {
      for (const { skillId, points } of decoration.skills) {
        skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points)
      }
    }
    const usedSlots = placedDecorations.reduce((sum, d) => sum + d.slotSize, 0)
    const name = [original.name, ...placedDecorations.map((d) => d.name)].join(' + ')

    const candidate: NamedCandidate = {
      id: original.id,
      name,
      category: original.category,
      grankOrLater: original.grankOrLater,
      hunterType: original.hunterType,
      exoticSkillId: original.exoticSkillId,
      defenseMax: original.defenseMax,
      resistances: original.resistances,
      skills: [...skillTotals.entries()].map(([skillId, points]) => ({ skillId, points })),
      openSlotCount: (original.openSlotCount ?? 0) - usedSlots,
    }
    return { slotId: slot.slotId, candidates: [candidate] }
  })
}

export function cuffsAfterCategoryFilter(
  cuffs: readonly NamedCuff[],
  excludedCuffCategories: ReadonlySet<string>,
): NamedCuff[] {
  if (excludedCuffCategories.size === 0) return [...cuffs]
  return cuffs.filter((c) => !excludedCuffCategories.has(c.category))
}

/** Tower Gems and regular decorations are strictly exclusive with each other
 * in both directions in-game (docs/data-format-notes.md's "Decorations"
 * section: Tower armor can only take Tower Gems, regular armor can't take
 * them at all) -- a rule this engine doesn't model per-slot/per-candidate at
 * all. Tower Gems are therefore ALWAYS excluded from the general pool, not a
 * togglable choice (confirmed by the project owner, 2026-10-15: there's no
 * legitimate reason to search with them in scope, since this engine has no
 * way to target them at a Tower armor piece specifically). This is only a
 * partial, one-sided fix for the underlying exclusivity rule: a regular
 * decoration ending up placed into a Tower armor piece's own open slots
 * remains unenforced regardless (see docs/skill-system-roadmap.md TODO #11's
 * own note on this).
 *
 * Separately filters by `d.category` against the richer decoration-tree
 * taxonomy (see decoration-categories.ts), which IS togglable via
 * `excludedCategories`. */
export function decorationsAfterCategoryFilter(
  decorations: readonly NamedDecoration[],
  excludedCategories: ReadonlySet<string>,
): NamedDecoration[] {
  return decorations.filter((d) => {
    if (d.isTower) return false
    return !excludedCategories.has(d.category)
  })
}

/** Resolves pinned cuff ids (see `QueryFormState.pinnedCuffIds`) to their full
 * `NamedCuff` data, dropping any id no longer present in the catalog (e.g. a
 * shared link from before a data re-export changed cuff ids -- silently
 * ignored rather than failing the whole query, same spirit as a pinned armor
 * piece that no longer resolves in `slotsAfterPinning` falling back to the
 * unpinned slot). */
export function resolvePinnedCuffs(
  cuffs: readonly NamedCuff[],
  pinnedCuffIds: readonly string[],
): NamedCuff[] {
  const cuffsById = new Map(cuffs.map((c) => [c.id, c]))
  return pinnedCuffIds
    .map((id) => cuffsById.get(id))
    .filter((c): c is NamedCuff => c !== undefined)
}

/** Resolves `QueryFormState.pinnedSlotDecorationIds` into the
 * `SearchOptions.pinnedSlotDecorations` shape `search()` takes --
 * `NamedDecoration` objects instead of bare ids, dropping any id no longer
 * present in the catalog (same fail-soft convention as
 * `resolvePinnedCuffs`), and skipping any slot that's also present in
 * `pinnedArmor` entirely (that slot's own baked-in decorations already cover
 * it -- see `slotsAfterPinning` -- so a stray decoration-only pin for the
 * same slot, e.g. from an old shared link, is silently ignored rather than
 * doubly enforced or conflicting). A slot that resolves to zero decorations
 * (every id dropped) isn't included in the result at all, matching
 * `resolvePinnedCuffs`'s "nothing left" meaning "no pin," not "pin nothing."
 */
export function resolvePinnedSlotDecorations(
  decorations: readonly NamedDecoration[],
  pinnedSlotDecorationIds: ReadonlyMap<string, readonly string[]>,
  pinnedArmor: ReadonlyMap<string, PinnedSlot>,
): Map<string, NamedDecoration[]> {
  const decorationsById = new Map(decorations.map((d) => [d.id, d]))
  const resolved = new Map<string, NamedDecoration[]>()
  for (const [slotId, ids] of pinnedSlotDecorationIds) {
    if (pinnedArmor.has(slotId)) continue
    const found = ids
      .map((id) => decorationsById.get(id))
      .filter((d): d is NamedDecoration => d !== undefined)
    if (found.length > 0) resolved.set(slotId, found)
  }
  return resolved
}

export interface BuiltQuery {
  readonly slots: NamedSlotQuery[]
  readonly decorations: NamedDecoration[]
  readonly cuffs: NamedCuff[]
  readonly pinnedCuffs: NamedCuff[]
  readonly pinnedSlotDecorations: Map<string, NamedDecoration[]>
}

/** The inverse direction of `buildWeaponSlot`: given which weapon candidate a
 * solved result actually picked, returns the `excludedWeaponZenithSkillIds`
 * that would force that same candidate back into the mandatory single
 * choice -- "exclude every option but one" being force-include for this slot
 * (same reasoning as `ArmorPicker.tsx`'s own docstring on why the weapon slot
 * doesn't need its own picker). Used by the shared-result page's "use as a
 * base for a new search" button (TODO #9) to pin the weapon's Zenith skill
 * the same way every other part of the result gets pinned. */
export function pinnedWeaponExclusion(
  weaponZenithSkillIds: readonly number[],
  pickedCandidateId: string,
): Set<string> {
  const keepsNone = pickedCandidateId === 'weapon:none'
  const keptId = keepsNone ? null : Number(pickedCandidateId.slice('weapon:'.length))
  const excluded = new Set<string>()
  if (!keepsNone) excluded.add(WEAPON_NO_ZENITH_SKILL_KEY)
  for (const id of weaponZenithSkillIds) {
    if (id !== keptId) excluded.add(String(id))
  }
  return excluded
}

/** Turns a solved result's real armor-slot picks (everything but the virtual
 * `weapon` slot, which `pinnedWeaponExclusion` handles instead) into
 * `pinnedArmor` entries -- the other half of "use as a base for a new
 * search" pinning every part of a shared result. Takes the picks/decorations
 * structurally (not `NamedBuildResult` itself) so this module -- otherwise
 * pure search-engine logic -- doesn't need a dependency on the UI's own
 * `components/types.ts`. */
export function pinnedArmorFromResult(
  picks: ReadonlyMap<string, { readonly id: string }>,
  decorations: ReadonlyMap<string, readonly { readonly id: string }[]>,
): Map<string, PinnedSlot> {
  const pinned = new Map<string, PinnedSlot>()
  for (const [slotId, candidate] of picks) {
    if (slotId === 'weapon') continue
    const decorationIds = (decorations.get(slotId) ?? []).map((d) => d.id)
    pinned.set(slotId, { candidateId: candidate.id, decorationIds })
  }
  return pinned
}

/** Combines every step above into the exact `slots`/`cuffs`/`pinnedCuffs`
 * `search()` needs for one `DataBundle` and one `QueryFormState` -- the
 * single place both `App.tsx`'s live search and `ResultPage.tsx`'s
 * reconstructed one call through, so they can never drift apart. */
export function buildSearchQuery(bundle: DataBundle, state: QueryFormState): BuiltQuery {
  const decorations = decorationsAfterCategoryFilter(
    bundle.decorations,
    state.excludedDecorationCategories,
  )
  const slots = [
    ...slotsAfterPinning(
      slotsAfterHunterTypeFilter(
        slotsAfterCategoryFilter(bundle.slots, state.excludedCategories),
        state.hunterTypeFilter,
      ),
      decorations,
      bundle.slots,
      state.pinnedArmor,
    ),
    buildWeaponSlot(bundle, state),
  ]
  const cuffs = cuffsAfterCategoryFilter(bundle.cuffs, state.excludedCuffCategories)
  const pinnedCuffs = resolvePinnedCuffs(bundle.cuffs, state.pinnedCuffIds)
  const pinnedSlotDecorations = resolvePinnedSlotDecorations(
    decorations,
    state.pinnedSlotDecorationIds,
    state.pinnedArmor,
  )
  return { slots, decorations, cuffs, pinnedCuffs, pinnedSlotDecorations }
}
