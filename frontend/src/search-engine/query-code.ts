/**
 * Encodes/decodes a `SearchFormState` as a human-readable text code
 * (docs/feedback.md Round 1 #18, refined 2026-10-17 per the project owner:
 * "human readable... instead of base64 encoded") -- every id (skill,
 * category, armor/decoration/cuff) is resolved to its real name against the
 * loaded data bundle, both when generating a code and when reading one back
 * in. Distinct from this module's sibling `search-form-state.ts`'s own
 * `localStorage` auto-persistence: that always restores the player's single
 * *last* search on reload; this lets them keep and reuse *any number* of
 * distinct searches, by pasting a code back in whenever they want one of
 * them again -- including sharing it with someone else, the same way
 * `shared-state.ts` already does for a solved result (though that module
 * keeps its own gzip+base64url codec, for a much larger payload where
 * compactness still matters -- a pasted-and-read query code has no such
 * budget).
 *
 * Every value is written on its own line (a flat "Label: value" line, or a
 * "Label:" section header followed by "- value" item lines) rather than
 * packed onto one comma-separated line -- several real armor piece names
 * contain commas, colons, brackets and parentheses (e.g. "Plug Head:01",
 * "Akahara Reisou・胴: Bow Red", "Mizuha [Eboshi 】"), so any inline
 * delimiter would risk being swallowed by a name itself. One name per line
 * means the entire rest of a line (after a known, colon-free prefix like a
 * slot id) is always the value, with nothing left to escape.
 *
 * A name that isn't unique within its own catalog (e.g. two different armor
 * pieces that happen to share a display name) is disambiguated with its own
 * id in parentheses, e.g. "Iron Helm (head:0002)" -- resolved back by that id
 * rather than by name in that one case. This is the only case "resolved to
 * real names" can't fully avoid showing an id; everywhere else, including a
 * legitimate parenthetical already part of a real label (e.g.
 * "Standard (Unavailable)"), the plain name round-trips exactly as typed.
 */

import { WEAPON_NO_ZENITH_SKILL_KEY } from './build-query'
import type { HunterTypeFilter } from './build-query'
import type { GearCategoryGroup } from './gear-categories'
import type { PinnedSlot } from './pinned-armor'
import { validateSearchFormState } from './search-form-state'
import type { SearchFormState } from './search-form-state'
import type { ResistanceElement, SkillRequirement } from './types'

/** Every catalog this module needs to resolve an id to its real name (and
 * back). Deliberately plain `{id, name}` shapes rather than the richer
 * `Named*` types `load-bundle.ts` exports -- this module only ever needs the
 * name, and taking the narrower shape lets a caller pass e.g. its own
 * already-flattened armor-candidate list without any extra massaging. The
 * three category trees are taken here too, rather than imported directly
 * from `gear-categories.ts`/`cuff-categories.ts`/`decoration-categories.ts`
 * (despite being static data, not part of a loaded bundle) -- so this
 * module's own tests can exercise the collision/disambiguation logic against
 * a small fixture tree instead of coupling to real production category
 * keys. `App.tsx` passes the real ones. */
export interface QueryCodeCatalog {
  readonly skills: readonly { readonly id: number; readonly name: string }[]
  readonly zenithSkills: readonly { readonly id: number; readonly name: string }[]
  readonly armorCandidates: readonly { readonly id: string; readonly name: string }[]
  readonly decorations: readonly { readonly id: string; readonly name: string }[]
  readonly cuffs: readonly { readonly id: string; readonly name: string }[]
  readonly gearCategories: readonly GearCategoryGroup[]
  readonly cuffCategories: readonly GearCategoryGroup[]
  readonly decorationCategories: readonly GearCategoryGroup[]
}

interface NameIndex {
  readonly nameFor: (id: string) => string
  /** `null` for text that can't be resolved to exactly one id -- either an
   * unrecognized name, or an ambiguous one (several ids share that name, and
   * the text doesn't carry the disambiguating `(id)` suffix `nameFor` would
   * have added for exactly this case). */
  readonly idFor: (text: string) => string | null
}

function buildNameIndex(items: readonly { readonly id: string; readonly name: string }[]): NameIndex {
  const nameById = new Map(items.map((i) => [i.id, i.name]))
  const idsByName = new Map<string, string[]>()
  for (const item of items) {
    const ids = idsByName.get(item.name) ?? []
    ids.push(item.id)
    idsByName.set(item.name, ids)
  }
  return {
    nameFor(id) {
      const name = nameById.get(id) ?? id
      const ids = idsByName.get(name) ?? [id]
      return ids.length > 1 ? `${name} (${id})` : name
    },
    idFor(text) {
      // Tried first, so a real label that already happens to end in its own
      // "(...)" (e.g. "Standard (Unavailable)") round-trips as plain text
      // whenever it's unique -- only an actually-ambiguous name ever needs
      // the synthetic "Name (id)" suffix this falls back to below.
      const exact = idsByName.get(text)
      if (exact && exact.length === 1) return exact[0]
      const match = /^(.*) \(([^()]+)\)$/.exec(text)
      if (match && nameById.get(match[2]) === match[1]) return match[2]
      return null
    },
  }
}

function skillIndex(skills: readonly { readonly id: number; readonly name: string }[]): NameIndex {
  return buildNameIndex(skills.map((s) => ({ id: String(s.id), name: s.name })))
}

function weaponZenithIndex(zenithSkills: readonly { readonly id: number; readonly name: string }[]): NameIndex {
  return buildNameIndex([
    { id: WEAPON_NO_ZENITH_SKILL_KEY, name: 'No Zenith skill' },
    ...zenithSkills.map((s) => ({ id: String(s.id), name: s.name })),
  ])
}

function flattenCategoryGroups(groups: readonly GearCategoryGroup[]): NameIndex {
  return buildNameIndex(groups.flatMap((g) => g.categories.map((c) => ({ id: c.key, name: c.label }))))
}

const RESISTANCE_ELEMENT_LABELS: ReadonlyMap<ResistanceElement, string> = new Map([
  ['fire', 'Fire'],
  ['water', 'Water'],
  ['thunder', 'Thunder'],
  ['ice', 'Ice'],
  ['dragon', 'Dragon'],
])
const RESISTANCE_ELEMENT_BY_LABEL: ReadonlyMap<string, ResistanceElement> = new Map(
  [...RESISTANCE_ELEMENT_LABELS].map(([element, label]) => [label, element]),
)

function renderList(header: string, items: readonly string[]): readonly string[] {
  return items.length === 0 ? [] : [`${header}:`, ...items.map((item) => `- ${item}`)]
}

/** Like `renderList`, but distinguishes an absent (`null`) list from a
 * present-but-empty one -- only `excludedWeaponZenithSkillIds` needs this
 * (see `SearchFormState`'s own docstring: `null` means "not yet customized,
 * use the default exclusion", a different state from "explicitly nothing
 * excluded"). An empty-but-present list still emits its header, with no item
 * lines below it. */
function renderNullableList(header: string, items: readonly string[] | null): readonly string[] {
  return items === null ? [] : [`${header}:`, ...items.map((item) => `- ${item}`)]
}

export async function encodeQueryCode(state: SearchFormState, catalog: QueryCodeCatalog): Promise<string> {
  const skillIdx = skillIndex(catalog.skills)
  const zenithIdx = skillIndex(catalog.zenithSkills)
  const weaponZenithIdx = weaponZenithIndex(catalog.zenithSkills)
  const armorIdx = buildNameIndex(catalog.armorCandidates)
  const decorationIdx = buildNameIndex(catalog.decorations)
  const cuffIdx = buildNameIndex(catalog.cuffs)
  const gearCategoryIdx = flattenCategoryGroups(catalog.gearCategories)
  const cuffCategoryIdx = flattenCategoryGroups(catalog.cuffCategories)
  const decorationCategoryIdx = flattenCategoryGroups(catalog.decorationCategories)

  const blocks: (readonly string[])[] = [
    [
      `Hunter type: ${state.hunterTypeFilter === 'gunner' ? 'Gunner' : 'Blademaster'}`,
      `Weapon slots for decorations: ${state.weaponSlotCount}`,
      `Prefer exact matches: ${state.preferExactMatches ? 'Yes' : 'No'}`,
      `Results to show: ${state.maxResults}`,
    ],
    renderList(
      'Skill requirements',
      state.requirements.map((r) => `${skillIdx.nameFor(String(r.skillId))}: ${r.minPoints}`),
    ),
    renderList(
      'Zenith skill requirements',
      state.zenithRequirements.map((r) => `${zenithIdx.nameFor(String(r.skillId))}: ${r.minPoints}`),
    ),
    renderList(
      'Resistances required non-negative',
      state.nonNegativeResistances.map((e) => RESISTANCE_ELEMENT_LABELS.get(e) ?? e),
    ),
    renderList(
      'Exclude gear categories',
      state.excludedCategories.map((k) => gearCategoryIdx.nameFor(k)),
    ),
    renderList(
      'Exclude cuff categories',
      state.excludedCuffCategories.map((k) => cuffCategoryIdx.nameFor(k)),
    ),
    renderList(
      'Exclude decoration categories',
      state.excludedDecorationCategories.map((k) => decorationCategoryIdx.nameFor(k)),
    ),
    renderNullableList(
      'Excluded weapon Zenith skills',
      state.excludedWeaponZenithSkillIds === null
        ? null
        : state.excludedWeaponZenithSkillIds.map((id) => weaponZenithIdx.nameFor(id)),
    ),
    renderList(
      'Pinned armor pieces',
      state.pinnedArmor.map(([slotId, pin]) => `${slotId}: ${armorIdx.nameFor(pin.candidateId)}`),
    ),
    renderList(
      'Decorations in pinned armor',
      state.pinnedArmor.flatMap(([slotId, pin]) =>
        pin.decorationIds.map((id) => `${slotId}: ${decorationIdx.nameFor(id)}`),
      ),
    ),
    renderList(
      'Pinned cuffs',
      state.pinnedCuffIds.map((id, i) => `slot ${i + 1}: ${cuffIdx.nameFor(id)}`),
    ),
    renderList(
      'Pinned slot decorations (no piece pinned)',
      state.pinnedSlotDecorationIds.flatMap(([slotId, ids]) =>
        ids.map((id) => `${slotId}: ${decorationIdx.nameFor(id)}`),
      ),
    ),
    renderList('Excluded armor', state.excludedArmorIds.map((id) => armorIdx.nameFor(id))),
    renderList('Excluded decorations', state.excludedDecorationIds.map((id) => decorationIdx.nameFor(id))),
    renderList('Excluded cuffs', state.excludedCuffIds.map((id) => cuffIdx.nameFor(id))),
    renderList('Excluded skills', state.excludedSkillIds.map((id) => skillIdx.nameFor(id))),
  ]

  // Async only to keep this a drop-in replacement for the old gzip-based
  // version's signature -- every caller already does `await`/`.then(...)`.
  return Promise.resolve(
    blocks
      .filter((block) => block.length > 0)
      .map((block) => block.join('\n'))
      .join('\n\n') + '\n',
  )
}

interface ParsedDoc {
  readonly scalars: ReadonlyMap<string, string>
  readonly sections: ReadonlyMap<string, readonly string[]>
}

/** Splits a code into "Label: value" scalar lines and "Label:" sections
 * (each followed by zero or more "- value" item lines), tolerant of blank
 * lines and missing/extra blank-line spacing between blocks -- see this
 * module's own docstring for why every value gets its own line instead of
 * being packed onto one. */
function parseDoc(text: string): ParsedDoc {
  const scalars = new Map<string, string>()
  const sections = new Map<string, string[]>()
  let currentSection: string | null = null

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trimEnd()
    if (line.length === 0) {
      currentSection = null
      continue
    }
    if (line.startsWith('- ')) {
      if (currentSection !== null) sections.get(currentSection)!.push(line.slice(2))
      continue
    }
    const sep = line.indexOf(': ')
    if (sep === -1) {
      if (line.endsWith(':')) {
        currentSection = line.slice(0, -1)
        if (!sections.has(currentSection)) sections.set(currentSection, [])
      } else {
        currentSection = null
      }
      continue
    }
    currentSection = null
    scalars.set(line.slice(0, sep), line.slice(sep + 2))
  }

  return { scalars, sections }
}

function decodeIdList(lines: readonly string[], index: NameIndex): readonly string[] | null {
  const ids: string[] = []
  for (const line of lines) {
    const id = index.idFor(line)
    if (id === null) return null
    ids.push(id)
  }
  return ids
}

function decodeSkillRequirements(
  lines: readonly string[],
  index: NameIndex,
): readonly SkillRequirement[] | null {
  const result: SkillRequirement[] = []
  for (const line of lines) {
    const match = /^(.*): (-?\d+)$/.exec(line)
    if (!match) return null
    const id = index.idFor(match[1])
    if (id === null) return null
    result.push({ skillId: Number(id), minPoints: Number(match[2]) })
  }
  return result
}

function decodeResistances(lines: readonly string[]): readonly ResistanceElement[] | null {
  const result: ResistanceElement[] = []
  for (const line of lines) {
    const element = RESISTANCE_ELEMENT_BY_LABEL.get(line)
    if (!element) return null
    result.push(element)
  }
  return result
}

/** Decodes a `"<slotId>: <name>"` line list -- used by every section keyed
 * by armor slot (pinned pieces, their decorations, and slot-only decoration
 * pins). Splits on the *first* `": "` only: a slot id is always one of a
 * small, colon-free fixed set, so whatever a real item name does with the
 * rest of the line (including a `": "` of its own, e.g. "Akahara
 * Reisou・胴: Bow Red") is preserved intact as part of the name. */
function decodeSlotNamePairs(
  lines: readonly string[],
  index: NameIndex,
): readonly (readonly [string, string])[] | null {
  const result: (readonly [string, string])[] = []
  for (const line of lines) {
    const sep = line.indexOf(': ')
    if (sep === -1) return null
    const id = index.idFor(line.slice(sep + 2))
    if (id === null) return null
    result.push([line.slice(0, sep), id])
  }
  return result
}

function groupBySlot(pairs: readonly (readonly [string, string])[]): ReadonlyMap<string, readonly string[]> {
  const bySlot = new Map<string, string[]>()
  for (const [slotId, id] of pairs) {
    const list = bySlot.get(slotId) ?? []
    list.push(id)
    bySlot.set(slotId, list)
  }
  return bySlot
}

/** Returns `null` for anything that doesn't decode into a usable
 * `SearchFormState` at all (missing a required line, an unrecognized name,
 * an ambiguous name missing its disambiguating id, or a shape
 * `validateSearchFormState` itself rejects) -- a pasted code is user-facing
 * input (possibly mistyped, truncated, hand-edited, or from before a
 * `SearchFormState` shape change), not trusted internal data, so this fails
 * soft rather than throwing -- same convention `decodeSharedState` already
 * follows for the exact same reasons. */
export async function decodeQueryCode(
  code: string,
  catalog: QueryCodeCatalog,
): Promise<SearchFormState | null> {
  const skillIdx = skillIndex(catalog.skills)
  const zenithIdx = skillIndex(catalog.zenithSkills)
  const weaponZenithIdx = weaponZenithIndex(catalog.zenithSkills)
  const armorIdx = buildNameIndex(catalog.armorCandidates)
  const decorationIdx = buildNameIndex(catalog.decorations)
  const cuffIdx = buildNameIndex(catalog.cuffs)
  const gearCategoryIdx = flattenCategoryGroups(catalog.gearCategories)
  const cuffCategoryIdx = flattenCategoryGroups(catalog.cuffCategories)
  const decorationCategoryIdx = flattenCategoryGroups(catalog.decorationCategories)

  const doc = parseDoc(code.trim())

  const hunterTypeText = doc.scalars.get('Hunter type')?.trim().toLowerCase()
  const weaponSlotCountText = doc.scalars.get('Weapon slots for decorations')
  const preferExactMatchesText = doc.scalars.get('Prefer exact matches')?.trim().toLowerCase()
  const maxResultsText = doc.scalars.get('Results to show')
  if (
    (hunterTypeText !== 'blademaster' && hunterTypeText !== 'gunner') ||
    weaponSlotCountText === undefined ||
    (preferExactMatchesText !== 'yes' && preferExactMatchesText !== 'no') ||
    maxResultsText === undefined
  ) {
    return null
  }
  const hunterTypeFilter: HunterTypeFilter = hunterTypeText
  const weaponSlotCount = Number(weaponSlotCountText)
  const preferExactMatches = preferExactMatchesText === 'yes'
  const maxResults = Number(maxResultsText)
  if (!Number.isFinite(weaponSlotCount) || !Number.isFinite(maxResults)) return null

  const requirements = decodeSkillRequirements(doc.sections.get('Skill requirements') ?? [], skillIdx)
  const zenithRequirements = decodeSkillRequirements(
    doc.sections.get('Zenith skill requirements') ?? [],
    zenithIdx,
  )
  const nonNegativeResistances = decodeResistances(
    doc.sections.get('Resistances required non-negative') ?? [],
  )
  const excludedCategories = decodeIdList(
    doc.sections.get('Exclude gear categories') ?? [],
    gearCategoryIdx,
  )
  const excludedCuffCategories = decodeIdList(
    doc.sections.get('Exclude cuff categories') ?? [],
    cuffCategoryIdx,
  )
  const excludedDecorationCategories = decodeIdList(
    doc.sections.get('Exclude decoration categories') ?? [],
    decorationCategoryIdx,
  )
  const weaponZenithSection = doc.sections.get('Excluded weapon Zenith skills')
  const excludedWeaponZenithSkillIds =
    weaponZenithSection === undefined ? null : decodeIdList(weaponZenithSection, weaponZenithIdx)
  const pinnedArmorPieces = decodeSlotNamePairs(doc.sections.get('Pinned armor pieces') ?? [], armorIdx)
  const pinnedArmorDecorations = decodeSlotNamePairs(
    doc.sections.get('Decorations in pinned armor') ?? [],
    decorationIdx,
  )
  const pinnedCuffPairs = decodeSlotNamePairs(doc.sections.get('Pinned cuffs') ?? [], cuffIdx)
  const slotDecorationPairs = decodeSlotNamePairs(
    doc.sections.get('Pinned slot decorations (no piece pinned)') ?? [],
    decorationIdx,
  )
  const excludedArmorIds = decodeIdList(doc.sections.get('Excluded armor') ?? [], armorIdx)
  const excludedDecorationIds = decodeIdList(doc.sections.get('Excluded decorations') ?? [], decorationIdx)
  const excludedCuffIds = decodeIdList(doc.sections.get('Excluded cuffs') ?? [], cuffIdx)
  const excludedSkillIds = decodeIdList(doc.sections.get('Excluded skills') ?? [], skillIdx)

  if (
    requirements === null ||
    zenithRequirements === null ||
    nonNegativeResistances === null ||
    excludedCategories === null ||
    excludedCuffCategories === null ||
    excludedDecorationCategories === null ||
    (weaponZenithSection !== undefined && excludedWeaponZenithSkillIds === null) ||
    pinnedArmorPieces === null ||
    pinnedArmorDecorations === null ||
    pinnedCuffPairs === null ||
    slotDecorationPairs === null ||
    excludedArmorIds === null ||
    excludedDecorationIds === null ||
    excludedCuffIds === null ||
    excludedSkillIds === null
  ) {
    return null
  }

  const decorationsBySlot = groupBySlot(pinnedArmorDecorations)
  const pinnedArmor: (readonly [string, PinnedSlot])[] = pinnedArmorPieces.map(([slotId, candidateId]) => [
    slotId,
    { candidateId, decorationIds: decorationsBySlot.get(slotId) ?? [] },
  ])
  const pinnedCuffIds = pinnedCuffPairs.map(([, id]) => id)
  const pinnedSlotDecorationIds = [...groupBySlot(slotDecorationPairs).entries()]

  return validateSearchFormState({
    requirements,
    zenithRequirements,
    excludedCategories,
    excludedCuffCategories,
    excludedDecorationCategories,
    excludedWeaponZenithSkillIds,
    weaponSlotCount,
    hunterTypeFilter,
    pinnedArmor,
    pinnedCuffIds,
    pinnedSlotDecorationIds,
    excludedArmorIds,
    excludedDecorationIds,
    excludedCuffIds,
    excludedSkillIds,
    nonNegativeResistances,
    preferExactMatches,
    maxResults,
  })
}
