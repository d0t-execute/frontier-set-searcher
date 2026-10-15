# Skill system roadmap

Eight planned future-work items on skill mechanics (cap system, priority list, Zenith/Exotic
skills, Go Skill Boost), cuff equipment support, skill UI/categorization, per-piece include/
exclude controls, and weapon Zenith-skill support, with what already exists in the codebase for
each. Tracked here as a running list of known-missing depth/polish, distinct from immediate bug-fix
work -- surface this when deciding "what's left" or starting work on any one of these items, since
each entry below already has the relevant existing-codebase context pre-researched so that work
doesn't have to re-derive it.

**This is the single source of truth for what to work on next** -- an autonomous session should
pull its task list from here, not invent scope. See docs/autonomous-session-plan.md when working
unattended.

## 1. Skill cap system + skill priority list

**Status (2026-10-15): COMPLETE, fully verified.** The game caps how many *distinct normal skills*
can be simultaneously active on one build (confirmed by the project owner, citing
https://mertna.github.io/MHFZ-Skills/?skills=Priority): a base of 10, +1/+2 more for a build using
>=3/>=5 G-Rank-or-later armor pieces, and +1 per stacked level of the Zenith skill "Skill Slots Up"
(up to +7, theoretical max 19 active skills). Once a build's active normal-skill count would exceed
that cap, the lowest-*priority* ones (per that same page's own activation-priority table, rank 1 =
most protected) get force-disabled first. Scope is normal skills only -- Zenith skills are a wholly
separate, unaffected pool (the priority table's ~194 rows match this catalog's normal-skill count,
not the ~26-family Zenith catalog).

- ETL (`etl/src/etl/parse/skill_priority.py`, new): `parse_skill_priority_table(html)` parses the
  Priority.html page's flattened `(rank, name)` grid, skipping blank trailing cells and the
  `[Skill Removed]` placeholder. `etl/src/etl/pipeline.py`'s new `load_skill_priority()` mirrors
  `load_skill_tiers()` exactly -- same `SKILL_TIER_NAME_ALIASES` reuse, same
  matched/unmatched-both-ways reporting rather than silently dropping mismatches, safe to re-run.
  Two Priority-page-only name variants needed new alias entries beyond the existing tier-site ones:
  `"SAF tech"` (lowercase "tech", vs. the tier site's `"SAF Tech"`) and `"P. Breakthrough"` (vs. the
  catalog's `"Point Breakthrough"`). After both fixes, a live rebuild matched all 194 catalog skills
  to a priority rank with zero unmatched entries either way.
- Schema: `skill.priority_rank INTEGER`, nullable (`etl/src/etl/db/schema.sql`,
  `models.py`'s `Skill.priority_rank`, `repository.py`'s `list_skills`/`get_skill_by_name`/new
  `set_skill_priority_rank`). `null` means "never matched a row on the priority page," not "no
  priority in-game" -- treated as the lowest priority (first disabled) downstream.
- Export: `skills.json`'s `_export_skills` now includes `"priorityRank"` per skill
  (`etl/src/etl/export.py`). Zenith skills are never exported with a rank (always `null`) since
  they're out of scope for this cap.
- Frontend: `frontend/src/search-engine/active-skill-cap.ts` (new) --
  `computeActiveSkillCap(picks, skillTotals, zenithSkills)` (10 + G-Rank-piece-count bonus + capped
  Skill-Slots-Up level) and `determineActiveSkills(picks, skillTotals, skills, zenithSkills)`
  (filters `BuildResult.skillTotals` to normal-skill ids only, decides "active" the same way
  `ilp-model.ts`'s own tier-crossing convention does -- smallest positive / largest negative
  threshold, untiered skills fall back to "any positive points" -- then sorts active skills by
  priority rank ascending, unranked last, and slices everything past the cap into `disabled`).
  `load-bundle.ts`'s `NamedSkill` gained `priorityRank: number | null`.
  `ResultsList.tsx` now computes and shows each result's active-skill cap and flags any
  cap-exceeding skill as `(disabled)` inline next to its point total.
- **Known open point**: the in-game piece-counting rule names five G-Rank-or-later suffixes --
  "Z, ZF, ZY, ZP and ZX". This project's existing category taxonomy
  ([gear-category-taxonomy.md](gear-category-taxonomy.md)) cleanly covers four of them
  (`zenith_plain` for Z/ZF, `zenith_zy`, `zenith_zx`) but sorts "ZP" pieces under a
  monetization-channel leaf (`paid_premium_kit`/`paid_gachapon`/`paid_promotional`) instead of a
  Zenith-tier category, since the source data doesn't distinguish "paid G-Rank-or-later" from "paid
  but not G-Rank" any other way. `active-skill-cap.ts`'s `GRANK_OR_LATER_CATEGORIES` therefore
  undercounts a build's G-Rank-or-later piece total whenever it includes ZP armor -- documented
  in-code rather than guessed away, since "count every paid piece" would likely overcount instead
  (most paid pieces aren't G-Rank-or-later).
- Related existing behavior this builds on: the search engine already treats "more points past a
  requirement's threshold" as a tie, never a win -- the production model's requirement rows
  ([ilp-model.ts](../frontend/src/search-engine/ilp-model.ts)) are hard constraints with no reward
  for overshoot. This feature is purely a post-hoc, display-only computation over a completed
  `BuildResult`; it does not change the search engine's objective or constraints.
- Verification: 251/251 ETL tests pass (6 new `load_skill_priority` tests, 2 new
  `_export_skills`/priority-rank export tests), ruff clean, DB rebuilt from scratch
  (`.bak-pre-skill-priority` preserves the prior DB) with 0 unmatched priority entries/skills, data
  bundle re-exported and trailing-newline-fixed. 161 -> 175 frontend tests pass (14 new:
  13 in `active-skill-cap.test.ts`, 1 in `ResultsList.test.tsx`), `tsc -b` clean, oxlint clean (one
  pre-existing, unrelated `vite.config.ts` warning).
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
  no single real item ever grants more than level 1 of a family.
- **Update (2026-10-15): per-family level cap.** The scraped game data has no record of each
  family's *maximum* stackable level (since every real piece only ever grants "+1"), so the UI
  originally exported `tiers: []` for every family, rendering a free-entry number input with no
  upper bound. Per the project owner: only some Zenith families actually have more than one level,
  and a Zenith skill boosts a specific normal skill's effect at each level (no engine-side linkage
  needed -- that's for the player to know, not the solver to enforce) -- so the *picker* should still
  cap each family at its real maximum. Cross-checked against the community reference
  (https://mertna.github.io/MHFZ-Skills/?skills=Zenith, which lists exactly the same 26 families
  this export already produces) and hardcoded each family's max level into a new
  `ZENITH_SKILL_MAX_LEVEL` dict in `export.py`. `tiers` is now built from that cap (`[max, ..., 1]`,
  descending, same convention normal skill tiers already use) instead of being left empty -- e.g.
  "Guard Up" exports two tiers (+1/+2), "Skill Slots Up" exports seven (+1..+7), while a genuinely
  single-level family like "Vampirism Up" or "Dissolver Up" exports just one ("+1"). No frontend code
  changed: `SkillPicker.tsx` already rendered a bounded dropdown whenever `tiers` is non-empty, so
  populating real tiers was enough to get correct capped selection "for free."
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

**Status (2026-10-15): RESOLVED -- does not exist as a distinct mechanic. No implementation needed;
this TODO is closed as a naming confusion, not a missing feature.**

- "Exotic" (CLASS O) is documented only as an equipment origin tier, same family as G/GX/Exotic GX
  ([gear-category-taxonomy.md](gear-category-taxonomy.md)). No special field analogous to
  Zenith's `Teni`/`TENINAME` is documented for it, and no `exotic_skill`-style table exists anywhere
  in the ETL/DB models.
- Exotic gear in the exported data carries only normal skills.
- Fresh research against the source site (2026-10-15, per the project owner's standing instruction
  to verify rather than assume before closing a thin item): the same `mertna.github.io/MHFZ-Skills`
  site this project already treats as authoritative for normal skills, Zenith skills, and the
  activation-priority table (TODO #1) has no "Exotic" section, tab, or skill list anywhere on it --
  checked live. Web search for any MHF/MHF-Z community documentation of an "Exotic skill" mechanic
  (as opposed to "Exotic armor/equipment," the tier) turned up nothing; every real hit was about
  unrelated games (Destiny 2, The Division) coincidentally also using the word "exotic." This is the
  same rigor the Zenith-skill finding required, applied here with the opposite conclusion: Zenith
  turned out to be real and got built (TODO #2); Exotic does not, so there is nothing to build.
  Conclusion: "Exotic" in this game is purely the equipment-tier name (CLASS O, same family as
  G/GX), and this roadmap item most likely originated from conflating that tier name with a
  Zenith-style separate skill pool that doesn't actually exist for it.

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
- **Open point (2026-10-15)**: fresh web research (English and Japanese queries against the general
  web and the `mertna.github.io/MHFZ-Skills` site) found no mechanic matching this name in either
  language -- not as a skill, a Zenith skill, a sigil effect, or any other documented system. Unlike
  TODO #3 (Exotic skills), this came back inconclusive rather than confidently resolved: there's no
  positive evidence ruling it out as there was for Exotic (no structural field/tier-family hiding it
  in plain sight), just an absence of hits for a term that may be an informal/community nickname, a
  mistranslation, or specific to a sub-version/era of MHF this project's sources don't cover. Left
  open rather than guessed at -- needs the project owner to supply the in-game Japanese name, a
  screenshot, or the source they originally saw this term in before further research can narrow it
  down.

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
- **Reviewed 2026-10-15, deliberately left undecided.** Considered building this autonomously (a
  type-to-filter input, the same pattern just added for `ArmorPicker.tsx`/TODO #7), but at this
  catalog's actual size (194 skills across 14 categories) a plain `<select>` with `<optgroup>`s is
  not the same severity of problem the armor picker's ~13,000-candidate list was -- there's no
  clear-cut usability defect forcing a specific fix the way there was there, just an open-ended
  "nicer" redesign with several equally-plausible directions the item's own text already flags.
  Picking one here risked building something the project owner didn't actually want, with no way to
  course-correct until they're back -- left for them to scope rather than guessed at.

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
- **Follow-up (2026-10-15): Premium cuffs excluded by default.** The category-exclusion filter
  itself was correct, but its *default* wasn't: every category (including every `cuff_premium_*`
  one) started included, silently assuming Poogie is always wearing Premium clothes -- a
  precondition this app has no way to verify. `App.tsx`'s `DEFAULT_EXCLUDED_CUFF_CATEGORIES` now
  seeds `excludedCuffCategories` with the whole "Premium Poogie Cuffs" group at startup, so only
  Standard (incl. Zenith "SZ") and Hiden cuffs are offered out of the box; Premium stays available
  as an explicit opt-in via the existing checkboxes. Investigated and ruled out, while tracking this
  down: true Tower Weapon Sigils (raw `DEC="3", CLASS="N"` rows) were suspected of leaking into the
  cuff pool -- re-verified against the raw cache, the DB, and the exported bundle, confirmed zero
  present (`_is_cuff_row` already excludes them correctly, with an existing regression test). The
  likely actual source of the "looks like a Tower sigil" impression: real Premium cuffs include
  oddly-named "skill lottery" variants (e.g. `Skill Slots Up PZ1`..`PZ58`, `Charge Attack PA1`) --
  confirmed legitimate via the raw Japanese comment translating to "Skill Cuff Lottery", not weapon
  data, but easy to mistake for one, especially once visible by default alongside Premium's other
  categories. Also re-verified the "2 cuffs + combined Poogie-slot budget" ILP constraint directly
  (forcing cuff-only solutions via a dummy-slot harness) -- it correctly rejects combinations
  exceeding the 2-slot budget in every case tried; no reproduction found of it being bypassed.
- **Correction (2026-10-15): the "ruled out" Tower-sigil leak above was real, just misdiagnosed.**
  The project owner reported two concrete leaked names -- "Hearing P. Up Sigil" and "Stylish Up
  Sigil" -- both offered as cuffs despite being Weapon Sigils. `_is_cuff_row` wasn't excluding
  `DEC="3"` rows as claimed above; it had special-cased `DEC="3" AND CLASS="P"` as a supposed
  cheaper "Zenith Cuff" variant (inherited from an earlier session), which is exactly the leak.
  Root-caused by diffing the named leaked rows against known-good references the owner supplied
  ("Artisan PA1" = Premium cuff, "Thunder Sword SA1" = Festival/Standard cuff, "Skill Slots Up SZ"
  = Zenith cuff): every `DEC="3", CLASS="P"` row's Zenith-skill (Teni) value turned out to be fully
  redundant with an independent `DEC="1", CLASS="P"` family, several had item names inconsistent
  with their own Teni-indexed effect, and the source site itself lists "Sigil(Info)" as a tab
  separate from "Cuff/Z Cuff" (an already-documented but under-weighted corroborating note). Fixed
  by simplifying `_is_cuff_row` to `DEC == "1"` only -- full stop, no `CLASS` special-case -- across
  `equipment.py`, its tests/fixtures, `schema.sql`'s column comment, and
  [data-format-notes.md](data-format-notes.md)'s Cuffs/Weapon-Sigil sections. DB rebuilt from
  scratch (3332 -> 3306 cuffs, the 26-row difference being exactly the `cuff_standard_zenith`
  category's known-good size). Re-verified: 237 ETL tests + 158 frontend tests pass, ruff clean,
  zero "Sigil"-named entries anywhere in the regenerated `cuffs.json`, and a live browser search for
  a Zenith-only skill requirement resolves to real Zenith armor with zero cuffs/sigils involved.

## 7. Exclude or force-include specific armor pieces / cuffs

**Status (2026-10-15): Armor picker COMPLETE and verified; cuff picker deliberately out of scope
(open point, see below).** Implements the refined scope's force-include direction for the 5 real
armor slots (head/chest/arms/waist/legs) without any `ilp-model.ts`/`engine.ts` changes at all --
the same "narrow the slot's candidate list down to exactly one synthesized candidate" trick
`buildWeaponSlot` (TODO #8) already uses, since `buildModel`'s existing per-slot "exactly one
candidate" row already forces the solver's hand once there's only one option. No new ILP machinery
(fixed-bound columns) was needed after all -- the "Force-include is a real model change" analysis
below turned out to be avoidable by solving one level up, at the query-construction layer instead.

- `frontend/src/search-engine/pinned-armor.ts` (new): `PinnedSlot` (`candidateId` +
  `decorationIds`) and `computePinnedSkillTotals()`, the shared live-feedback helper (kept out of
  the component file so it stays lint-clean for React Fast Refresh, which requires a component file
  to only export components).
- `frontend/src/components/ArmorPicker.tsx` (new): one picker per armor slot. **Had to be
  type-to-filter, not a plain `<select>`** -- a real slot's candidate list runs into the tens of
  thousands (head alone: ~13,000; confirmed live, first implementation attempt rendered all of them
  into one native `<select>`, a genuine usability/DOM-size problem caught during live-browser
  verification, not assumed away). Nothing renders until the user types >= 2 characters; matches are
  capped at 30 with a "keep typing to narrow it down" hint. Decoration search for a pinned piece's
  open slots is filtered the same way (and additionally pre-filtered to decorations that still fit
  the piece's *remaining* capacity, same convention `buildWeaponSlot`'s weapon-slot-count control
  established). Shows "Pinned skill totals" live across every currently-pinned slot (partial,
  best-effort -- unpinned slots contribute nothing, it's not a prediction of the final build),
  reusing `active-skill-cap.ts`'s `isSkillActive` (exported for this) to flag which totals are
  already active.
- `App.tsx`'s `slotsAfterPinning()`: for each pinned slot, looks up the real candidate, merges its
  own `skills` with every placed decoration's `skills` (by skillId), reduces `openSlotCount` by the
  decorations' total size, and folds the decoration names into the display name
  (`"Leather Helm + Attack 1 Deco"`, mirroring the weapon slot's own
  `"Zenith weapon (<skill>)"` convention) -- then replaces that slot's candidate list with just this
  one synthesized candidate. Applied after the existing category filter, deliberately overriding it
  for a pinned slot (a piece the player explicitly pinned shouldn't be silently blocked by an
  unrelated gear-level checkbox).
- **Open point, deliberately deferred**: cuffs are NOT covered by this picker. Per the refined
  scope's own note, cuffs need their own design ("a flat 0-2 list, not per-slot... likely closer to
  the weapon-slot picker than the per-armor-slot one") -- left as a follow-up rather than guessed at
  under this pass. The weapon slot is also out of scope here, but for a different reason: it has no
  real per-piece identity to pin at all (only a Zenith skill, which is already force-selectable
  today via its own exclude checklist in `App.tsx` -- excluding every option but one *is*
  force-include for that slot).
- Verification: 12 new tests across `pinned-armor.test.ts` (5) and `ArmorPicker.test.tsx` (10, one
  rewritten set after the type-to-filter redesign) pass, plus one pre-existing `App.test.tsx` test
  fixed after the picker's new per-slot `<option>` elements made a `findByText(/leather helm/i)`
  query ambiguous (fixed by giving `ResultsList`'s own `<ul>` an `aria-label="Search results"` and
  scoping that query to it, rather than loosening the match). `tsc -b` and oxlint clean. Live
  browser: pinned "Leather Helm" into the head slot, placed "Attack 1 Deco" into its one open slot
  (confirmed "(0 open slots left)" and "Attack: 3" in the live pinned-totals line), ran a search, and
  confirmed the result's head slot read exactly `"Leather Helm + Attack 1 Deco"` with every other
  slot still solver-chosen -- proving the override reaches the real solver, not just the picker UI.

Original (pre-refinement) research, kept for context:

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

**Refined scope (2026-10-15, from the project owner)**: the real motivating use cases are (1)
optimizing the rest of a build around gear the player already owns, and (2) exactly pinning part of
a build and exploring different ways to fill in the rest -- both need force-*include*, not just
exclude, so this can't be scoped down to the "cheap" exclude-only half above. Concretely:

- An **armor picker** UI: lets the user force-select a specific piece for each slot (head/chest/
  arms/waist/legs/weapon), **and** a specific decoration (or set of decorations) into that piece's
  open slots, overriding the solver's own choice for that slot entirely. Cuffs need the same
  treatment once a per-cuff force-include shape exists (today's cuffs are a flat 0-2 list, not
  per-slot, so this needs its own design, likely closer to the weapon-slot picker below than the
  per-armor-slot one).
- While picking, the UI should show **live feedback**: the running skill point totals and which
  skills/tiers are currently active across whatever's been pinned so far -- not just a silent
  selection with no feedback until the full search runs.
- Unpinned slots stay solver-optimized as today; this is additive to the existing free search, not
  a replacement mode.

## 8. Weapon Zenith-skill slot support

**Implemented 2026-10-15, pending final live-browser re-verification.** Prompted by the project
owner spotting that no search result ever used a weapon at all -- the engine only ever modeled the
5 armor slots + cuffs, never a weapon, even though a weapon can carry one Zenith skill and (like
armor) has open decoration slots. Clarified scope, in order of the owner's own messages:

- Don't output or let the user pick a *specific* real weapon -- "we can just specify which skill
  the weapon should have." A weapon's identity (name/rarity/stats) never matters to this tool
  (confirmed pre-existing: `etl/src/etl/db/schema.sql`'s comment on the `weapon` table), so the
  weapon slot is modeled as a virtual, nameless choice: any allowed Zenith skill, or none.
- Slot count: **not** auto-maximized like every other slot/cuff, by explicit correction from the
  owner -- a weapon's remaining open slots are commonly spent on **Weapon Sigils**, a mechanic
  entirely outside this tool's scope, so assuming the solver can freely claim all of them would
  silently assume away the player's own use for them. Needs a direct, user-set slot count (0-3)
  instead, mirroring how the owner recalled the old reference tool's own "blank slot" picker working.
- Zenith skill choice: include/exclude only (checklist, solver picks freely among allowed skills) --
  explicitly not a "force one exact skill" picker, by the owner's own choice between the two when
  asked directly.

Real-data finding that simplified the slot-count design: queried the rebuilt DB directly -- every
Zenith-carrying weapon has exactly 3 slots (all ~24,000 of them, no exceptions), and a "blank"
weapon can also always reach 3. Combined with the project's existing "weapon stats don't matter"
rule, there's never a tradeoff *except* the sigil-reservation one above -- so slot count needed
exactly one user-facing control, not a catalog of per-skill slot-count variants.

Also found and fixed a real ETL bug while investigating: the weapon pages label 3 Zenith skills
with abbreviated text ("Earplugs Up+1", "S. Assault Up+1", "C. Conversion Up+1") that don't match
their canonical equip.js-derived names ("Hearing Protection Up+1", "Stylish Assault Up+1", "Crit
Conversion Up+1") -- confirmed via the raw cached weapon-page HTML and cross-checked against those
same abbreviations already appearing in each family's own real cuff names (e.g. "Earplugs Up SZ").
Without a fix, `load_weapons` would have inserted 3 duplicate `zenith_skill` rows for effects that
already existed. Fixed via `ZENITH_SKILL_WEAPON_NAME_ALIASES` in `pipeline.py` (mirrors the
established `SKILL_TIER_NAME_ALIASES` pattern), confirmed by the DB's distinct-Zenith-skill count
dropping from 29 to the correct 26 after a full rebuild.

**What changed:**
- `etl/src/etl/pipeline.py`: `ZENITH_SKILL_WEAPON_NAME_ALIASES` + applied in `load_weapons`'s
  `resolve_zenith_skill`.
- `etl/src/etl/db/repository.py`: broadened `list_zenith_skill_ids_used_by_equipment_or_cuffs` into
  `list_zenith_skill_ids_used_by_equipment_cuffs_or_weapons` (a weapon-only Zenith skill is now
  satisfiable, via the virtual weapon slot, so it belongs in the catalog); added
  `list_zenith_skill_ids_used_by_weapons`.
- `etl/src/etl/export.py`: new `weapon-zenith-skills.json` (`_export_weapon_zenith_skill_ids`) --
  just the exported family ids a weapon can carry, no weapon identities at all.
- `frontend/src/search-engine/load-bundle.ts`: `DataBundle.weaponZenithSkillIds: readonly number[]`.
- `frontend/src/App.tsx`: weapon modeled as a 6th, always-present `SlotQuery` (`slotId: 'weapon'`)
  built dynamically at search time from the bundle's id list + two new controls -- **zero changes
  needed to `ilp-model.ts`/`engine.ts`**, since a virtual mandatory single-choice slot is exactly
  what every armor slot already is. New "Weapon" UI section: a `CategoryFilter`-reused Zenith-skill
  checklist (`defaultExcludedWeaponZenithSkillIds` starts every real skill excluded, only "No Zenith
  skill" included -- a true no-op until the player opts a skill in, matching
  `DEFAULT_EXCLUDED_CUFF_CATEGORIES`'s own "don't silently assume a new feature's most permissive
  state" precedent) + a 0-3 `<select>` for reserved decoration-slot count (default 0).
**Status: COMPLETE, fully verified (2026-10-15).** 240 ETL tests passing, ruff clean, DB rebuilt (26
distinct Zenith skills, down from 29), bundle regenerated, `tsc -b` clean, full frontend vitest
suite green (161/161, including two new weapon-specific tests and the updated `App.test.tsx`
fixtures/assertions for the now-always-present weapon slot). Live-browser-verified with a direct
before/after: the earlier-discovered infeasible case (Skill Slots Up+4 + Stylish Up + Vigorous Up +
Hearing Protection Up+1, Premium cuffs included -- see this doc's "Follow-up (2026-10-15): Premium
cuffs excluded by default" section) returned "No matching builds found" with the weapon's Zenith
skill checklist left at its default (every real skill excluded), then returned 5 real results the
moment "Skill Slots Up" was checked into the weapon checklist -- the winning build's `Weapon: Zenith
weapon (Skill Slots Up)` line is exactly the 7th carrier the earlier investigation proved was
missing. Confirms the feature isn't just wired up but actually expands what the solver can satisfy.

Also fixed in passing: a full `vitest run` once hung 25+ minutes past every test's own timeout, then
ran clean on immediate retry (one-off environment fluke, not reproduced). Added
`frontend/vite.config.ts`'s `testTimeout: 120_000` as a blanket per-test safety net regardless of
cause -- see docs/autonomous-session-plan.md's stuck-task section for the full writeup.
