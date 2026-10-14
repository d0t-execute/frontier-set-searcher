# Skill system roadmap

Seven planned future-work items on skill mechanics (cap system, priority list, Zenith/Exotic
skills, Go Skill Boost), cuff equipment support, skill UI/categorization, and per-piece include/
exclude controls, with what already exists in the codebase for each. Tracked here as a running list
of known-missing depth/polish, distinct from immediate bug-fix work -- surface this when deciding
"what's left" or starting work on any one of these items, since each entry below already has the
relevant existing-codebase context pre-researched so that work doesn't have to re-derive it.

## 1. Skill cap system + skill priority list

Not started -- nothing exists for an in-game skill-point cap or a priority/importance ranking of
skills.

- Related existing behavior worth knowing before designing this: the search engine already treats
  "more points past a requirement's threshold" as a tie, never a win -- the production model's
  requirement rows ([ilp-model.ts](../frontend/src/search-engine/ilp-model.ts)) are hard
  constraints with no reward for overshoot, and `engine.property.test.ts`'s brute-force oracle has
  a test-only `cappedVector()` helper modeling the same rule for comparison purposes. A "skill cap"
  feature would likely build on or interact with this existing dominance behavior, not introduce it
  from scratch.
- [PLAN.md](PLAN.md) mentions a "level cap" as a Phase 5 UI placeholder, but that's a
  weapon/armor level constraint, unrelated to skill points -- don't confuse the two.

## 2. Zenith skills as a separate filter

**Status (2026-10-15): DONE, end to end.** Confirmed with the project owner: Zenith skills stack
additively exactly like normal skills (e.g. two "Vampirism Up+1" pieces reach the same total as a
hypothetical "+2" piece) -- NOT a flat one-shot grant as the "second, separate skill-point system"
phrasing below once speculated. That meant this could reuse the search engine's existing
`SkillContribution`/`SkillRequirement` machinery completely unchanged: `engine.ts`, `ilp-model.ts`,
`worker-protocol.ts`, `worker-client.ts`, and `worker-handler.ts` needed zero edits. Only ETL export
+ frontend data loading + UI were needed:

- `etl/src/etl/export.py` now exports `zenith-skills.json` (one entry per Zenith skill *family* --
  `_zenith_family` strips a raw name's "+<N>" tier suffix, e.g. "Vampirism Up+2" -> family
  "Vampirism Up" at level 2; a suffix-less name like "Dissolver Up" is its own single-tier family at
  level 1) and appends each equipment/cuff row's Zenith contribution directly into its ordinary
  `skills` array as `{skillId, points}`, using a new `ZENITH_SKILL_ID_OFFSET` (1,000,000) to keep
  every Zenith family id clear of the normal skill id space. Verified against the real dataset:
  every `zenith_skill` row actually referenced by equipment/cuffs is a "+1" or suffix-less name --
  no single real item ever grants more than level 1 of a family, so `tiers: []` is exported
  deliberately empty (renders as a free-entry number input in `SkillPicker.tsx`, not a constrained
  dropdown, since the real achievable total is open-ended and bounded only by how many same-family
  pieces a build equips).
- The raw `zenith_skill` table also carries ids referenced only by `weapon` rows (weapons aren't
  exported at all) -- a new `list_zenith_skill_ids_used_by_equipment_or_cuffs` repository function
  filters those out so the catalog never offers an unsatisfiable requirement (confirmed 3 real
  examples: "Earplugs Up+1"/"S. Assault Up+1"/"C. Conversion Up+1", weapon-only in the real data).
- Frontend: `load-bundle.ts`'s `DataBundle.zenithSkills: readonly NamedSkill[]` (same type as
  `skills`), `App.tsx` gained a second `<SkillPicker>` instance under a "Zenith skills" heading
  (requirements combined with normal ones into one array before calling `worker.search()`) --
  `SkillPicker.tsx` gained an `addLabel` prop so the two instances' "Add a …" controls have distinct
  accessible names. `skillNames` (used for result display) now merges both catalogs.
- Verified end to end against the real, regenerated data bundle: a direct engine probe proved
  stacking works exactly as described (3 different Zenith-armor pieces, each contributing 1 point
  of "Dissolver Up", correctly satisfy `minPoints` 1/2/3), and a live browser search streamed back a
  real result showing "Dissolver Up: 1" in its skill totals.
- Don't confuse with the "Zenith" gear *category* (origin tier, e.g. "Zenith Armour", "Zenith
  ZY/ZX") that already exists as a UI filter in `gear-categories.ts`/
  [gear-category-taxonomy.md](gear-category-taxonomy.md) -- that's the equipment-tier filter,
  unrelated to this Zenith *skill pool* TODO.

## 3. Exotic skills

Likely does not exist as a distinct mechanic -- needs fresh research against the source site before
building, don't assume a Zenith-style parallel system.

- "Exotic" (CLASS O) is documented only as an equipment origin tier, same family as G/GX/Exotic GX
  ([gear-category-taxonomy.md](gear-category-taxonomy.md)). No special field analogous to
  Zenith's `Teni`/`TENINAME` is documented for it, and no `exotic_skill`-style table exists anywhere
  in the ETL/DB models.
- Exotic gear in the exported data carries only normal skills.
- Before treating "Exotic skills" as real, apply the same rigor the Zenith finding required:
  verify against the source site/wiki directly.

## 4. "Go Skill Boost"

Not found anywhere in docs or scraped data -- needs fresh research; may not be scraped/parsed/
documented at all yet.

- "G Rank" only ever appears as an equipment/weapon tier marker across
  [gear-category-taxonomy.md](gear-category-taxonomy.md),
  [weapon-data-format-notes.md](weapon-data-format-notes.md),
  [data-format-notes.md](data-format-notes.md) -- never as a skill-boost mechanic.
- The only "boost"-named data found is unrelated: weapon sigil effects ("Tech Boost[<weapon>]" in
  `docs/reference/regular-sigils.json`) and Tower Armor Sigil effect names (TENKOKUNAME, in
  [data-format-notes.md](data-format-notes.md)) -- a different, already-cataloged system. Don't
  conflate either with this TODO.

## 5. Cleaner UI + better skill categorization

Existing categorization already works end-to-end but is basic (flat, no sub-structure) -- this is
genuinely new scope, not a continuation of any documented plan.

- `skills.json` has 14 categories (Gathering/Transport, Attack, Item/Combo, Map/Detection,
  Blademaster, Gunner, Health and Stamina, Hiden/Tech, Other Protection, Other, Resistance, Reward,
  Defensive, Abnormal Status) -- every skill has one; none fall back to "uncategorized" today.
- [SkillPicker.tsx](../frontend/src/components/SkillPicker.tsx)'s `groupByCategory` groups the
  "Add a skill" dropdown by category, deliberately preserving first-seen order to mirror the source
  site's own curated section order (not alphabetical). A synthetic "Other" bucket exists for
  uncategorized skills but is currently unused dead-ish code since every real skill has a category.
- Current rendering: one flat `<select>` with `<optgroup>` per category, no nesting/search/icons
  beyond that. Selected skills render as a plain list with a tier dropdown or numeric input.
- No existing design notes (PLAN.md, data-format-notes.md, gear-category-taxonomy.md) propose
  changes here, and no TODO/FIXME comments exist in the file -- confirm scope with the user before
  assuming any particular direction (search box? collapsible groups? icons?) since nothing is
  pre-decided.

## 6. Cuff equipment support

Confirmed, via direct code inspection, that cuffs don't reach the frontend at all today (0 cuff
entries anywhere in `frontend/public/data/`) -- but unlike Exotic/G-rank-boost, this one is
**almost entirely built already** on the ETL/DB side; the gap is purely in export + frontend.

- Parsing is fully implemented: `etl/src/etl/parse/equipment.py` has a dedicated `ParsedCuffRow`
  dataclass (distinct from `ParsedDecorationRow`) and a `parse_cuff_bucket()` function. Cuffs are
  read from the *same* `deco` JS source bucket as decorations, distinguished by the `DEC` field
  (`""`=decoration, `"1"`=cuff, `"3"`+`CLASS="P"`=Zenith "Sigil" cuff) -- there's no separate
  network fetch needed, whatever already pulls that bucket already has the raw cuff rows.
- Persistence is fully implemented: `etl/src/etl/db/models.py` has a dedicated `Cuff` model/table
  (own `cuff` table, own `cuff_skill` join table), and `repository.py`/`pipeline.py` already insert
  every parsed cuff on every ETL run (tracked in the run summary as `cuff_count`).
- External id format is already decided: `cuff:{hex_id}` (vs. decorations' `deco:{hex_id}`), per
  [data-format-notes.md](data-format-notes.md).
- **The gap**: `etl/src/etl/export.py` explicitly excludes cuffs from the static JSON bundle (its
  own docstring literally says "cuffs/Zenith/Tower compatibility are out of scope for this
  groundwork pass"), and cuffs have no slot type in `ARMOR_SLOT_TYPES`/`EquipmentType` (they were
  never meant to be a 6th armor slot -- they're a wholly separate entity). So today: no
  `cuffs.json` export, no cuff slot/candidate list, nothing in the search engine or UI.
- Important game-mechanic constraint already documented and NOT yet modeled anywhere in the search
  engine, per [data-format-notes.md](data-format-notes.md)'s "Cuffs" section (confirmed by the
  project owner against real game knowledge): **at most 2 cuffs can be equipped at once**, and each
  cuff's own `slot_size` (0, 1, or 2) counts against a *combined* "Poogie slot" budget shared across
  both equipped cuffs -- this is a genuinely different constraint shape from armor's per-piece
  `openSlotCount`, explicitly flagged in the docs as deferred to "Phase 3+" of the search engine.
  Four cuff sub-kinds exist (plain, G-Hiden/free, Zenith "SZ", Zenith "Sigil"), with some free cuffs
  correctly having `slot_size=0`.
- Also ties into TODO #2 (Zenith skills): Zenith Cuffs are one of the two Zenith-skill carriers
  (`zenith_skill_id` is already a field on `ParsedCuffRow`/`Cuff`), so implementing cuffs and
  implementing the Zenith skill pool naturally overlap -- worth sequencing or scoping together
  rather than treating as fully independent work.
- To implement: add a cuff export step to `export.py` (own JSON file + manifest entry, since cuffs
  aren't an armor slot), model the "2 cuffs + combined Poogie-slot budget" constraint in the search
  engine (a genuinely new constraint shape, not a reuse of the existing per-slot capacity row), and
  add cuff selection UI.
- **Status (2026-10-14): DONE, end to end.** Cuff export (`cuffs.json`), the frontend data bundle
  loading it, the "2 cuffs + combined Poogie-slot budget" ILP constraint, `engine.ts`/worker
  plumbing (`search()`'s new trailing `cuffs` parameter, threaded through
  `worker-protocol.ts`/`worker-handler.ts`/`worker-client.ts`), and the UI (a "Poogie cuffs"
  category-filter section in `App.tsx` using a new `cuff-categories.ts` tree, plus a "Cuffs: ..."
  line in `ResultsList.tsx` when any are equipped) are all implemented and tested. Also discovered
  and implemented along the way: Cuffs split into **Premium** (require Poogie to be wearing Premium
  clothes) vs **Standard** (always usable) tiers -- a previously undocumented mechanic, now
  classified by `classify_cuff_category` (18 leaves, exported as `Cuff.category`/`cuffs.json`'s
  `category` field, verified exactly against the real dataset). Confirmed by the project owner: no
  mutual exclusivity between the two tiers in one build, so this is handled as a plain
  category-exclusion filter (same mechanism equipment's gear-level category filter already uses),
  not a new solver constraint. Verified end to end against the real, regenerated data bundle
  (direct engine probe + live browser search), not just synthetic fixtures. No cuff *selection* UI
  (forcing/excluding one specific cuff by id) -- that's TODO #7 below.

## 7. Exclude or force-include specific armor pieces / cuffs

Not started -- no per-piece include/exclude mechanism exists anywhere today; confirmed there's
nothing to build on beyond the *category*-level exclude filter, which is a different granularity.

- The closest existing feature is [CategoryFilter.tsx](../frontend/src/components/CategoryFilter.tsx)'s
  `excludedCategories: ReadonlySet<string>`, which excludes whole gear *categories* (e.g. G-rank,
  Exotic tiers) from candidate lists before the search runs. That's a UI/data-filtering precedent
  worth reusing for the *exclude* half of this feature, but it operates one level too coarse --
  nothing today lets a user target one specific equipment piece or cuff by id.
- The model structure this would hook into: each [SlotQuery](../frontend/src/search-engine/types.ts)
  has a `candidates: readonly Candidate[]` list, and
  [ilp-model.ts](../frontend/src/search-engine/ilp-model.ts) builds exactly one binary "chosen"
  column per candidate with a row constraining the sum per slot to 1. This gives two very different
  implementation paths for the two directions of this feature:
  - **Exclude** is cheap: just drop the excluded candidate(s) from the slot's `candidates` array
    before calling `buildModel()` (or filter at the UI/query layer, same as `excludedCategories`
    does today) -- no new ILP machinery needed.
  - **Force-include** is a real model change: it means fixing a specific candidate's binary column
    to 1 (equivalently, giving it `colLower = colUpper = 1`), which doesn't exist as a concept in
    `addColumn()` today (every column's bounds are currently derived from its role -- choice columns
    are always `[0, 1]`, never pre-fixed to a single value). This also has to compose correctly with
    the per-slot "exactly one candidate" row and (if `preferExactMatches` is on) the tier-aware
    auxiliary machinery from TODO-adjacent work already in the engine.
  - Forcing a cuff in/out has the same two shapes once TODO #6 (cuff equipment support) exists, but
    is blocked on that work landing first -- cuffs aren't representable as a `SlotQuery` candidate
    at all yet.
- To implement: add per-piece exclude/force-include ids to `SearchOptions`, thread them through
  `engine.ts` into `buildModel()`, apply excludes as a candidate-list filter, apply force-includes as
  fixed-value columns, and add a piece-picker UI (likely per-slot, since a piece only makes sense in
  the context of its slot) alongside the existing category filter.
