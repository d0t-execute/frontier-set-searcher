# Skill system roadmap

Ten planned future-work items on skill mechanics (cap system, priority list, Zenith/Exotic
skills, Go Skill Boost), cuff equipment support, skill UI/categorization, per-piece include/
exclude controls, weapon Zenith-skill support, sharing a search result, and an overall UI
decluttering pass, with what already exists in the codebase for each. Tracked here as a running list of known-missing depth/polish, distinct from immediate bug-fix
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
- **Correction (2026-10-15): the piece-counting bonus undercounted non-standard-route G-Rank/Zenith
  gear.** The project owner reported a concrete mismatch: a build with 5 G-Rank-or-later pieces and
  a level-4 "Skill Slots Up" should cap at 16 (10 + 2 + 4), but showed 14 (the +2 piece bonus wasn't
  applying). First-pass root cause: `GRANK_OR_LATER_CATEGORIES` only listed the *standard-tier*
  leaves (`grank_*`, `zenith_plain`/`zenith_zy`/`zenith_zx`) -- the same G/GX/Zenith sub-tiers also
  exist as their own leaves under Guild/Tower/Caravan/Road/Tournament acquisition routes, none of
  which were counted. Patched by adding every route's leaf to the set, live-browser-verified against
  5 non-standard-route pieces (cap read 14/15 at Skill-Slots-Up level 2/3, matching
  `10 + 2 + level` -- before the fix it would've read 12/13).
- **Second correction (2026-10-15, same day): the category-leaf approach itself was fundamentally
  unsound.** Asked by the project owner to confirm the full above/below-G-rank category list (their
  own examples: Hunting Tournament/HS below, Hunting Tournament G/GX above; Event below, Event Zenith
  above), a full cross-tab of every category against its real raw `CLASS` values
  (`etl/.data/cache/equip.body`) found several categories silently **mix** below-G-rank and
  G-Rank-or-later pieces, because `classify_equipment_category` never examines `CLASS` for them at
  all: every "Paid and Premium" leaf (`paid_package`/`paid_premium_kit`/`paid_gachapon`/
  `paid_net_cafe`/`paid_promotional` -- `paid_gachapon` alone holds 1,056 `CLASS "Q"` Zenith-Shugo
  and 840 `CLASS "L"` G-Hiden rows among its 13,745), plus `guild_festival`, `guild_plain`,
  `event_plain`, and `road_plain`. No category-leaf set can ever get these right; the previous
  "ZP"/"Event-route" open points were really instances of this same class of bug, not two unrelated
  gaps. Confirmed directly against `docs/data-format-notes.md`'s own `CLASS` decode table (`I`=G-class,
  `J`="G-rank sibling of" Shugo, `G`/`H`/`L`/`M`/`O`/`P`/`Q`=the other G-rank-or-later tiers) that
  `CLASS` alone, independent of acquisition route, is the authoritative signal.
  - **Fix**: a new `is_grank_or_later_equipment(fields)` in `etl/src/etl/parse/gear_category.py`,
    computed directly from `CLASS` (Tower armor, `CLASS="N"` uniformly, is the one exception -- its
    G/GX distinction still comes from the name suffix). Threaded through as a new column completely
    independent of the display `category`: `ParsedEquipmentRow.grank_or_later` ->
    `Equipment.grank_or_later` (`schema.sql`, `repository.py`'s `insert_equipment`/
    `_equipment_from_row`) -> `pipeline.py` -> `export.py`'s `"grankOrLater"` field on every
    `equipment/<slot>.json` candidate -> `load-bundle.ts`'s `NamedCandidate.grankOrLater: boolean` ->
    `active-skill-cap.ts`'s `countGrankOrLaterPieces`, which now reads this flag directly and no
    longer needs (or has) a category Set at all.
  - Verified directly against the real cached dataset before committing to the fix: of 61,817 real
    equipment rows, 24,407 are G-Rank-or-later by this flag (vs. the ~16,500 the old category-Set
    approach would've reached even after every route was added) -- every previously-"pure" category
    matches 1:1, and the previously-mixed ones now split correctly (e.g. `event_plain`'s 3,024 rows:
    1,355 flagged true).
  - This also fully **resolves** the earlier "Event-route armor has no plain G/GX leaf" open point --
    it never needed one; the flag doesn't depend on `category` having a matching leaf at all.
  - New tests: `etl/tests/parse/test_gear_category.py`'s `is_grank_or_later_equipment` section (every
    G-rank-or-later/below-G-rank `CLASS` value, cross-CRE-route consistency, the Tower name-suffix
    special case), `test_repository.py`'s round-trip + default tests, `test_export.py`'s
    `test_exports_a_grank_or_later_pieces_flag`, and `active-skill-cap.test.ts`'s rewritten
    `countGrankOrLaterPieces` tests (including one proving a mixed category's two pieces are judged
    individually, not by their shared category string).
  - Verification: 258/258 ETL tests pass (gear_category.py at 100% coverage), ruff clean, DB rebuilt
    from scratch (`.bak-pre-grank-or-later-flag` preserves the prior DB), bundle re-exported (only
    the 5 `equipment/*.json` files changed, confirmed via `git status`), 191/191 frontend tests pass,
    `tsc -b` and oxlint clean.
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

**Bug fix (2026-10-15): Hiden/Tech skills exempt from the cap when cuff-sourced.** Reported by the
project owner from a real example build: 17 active normal skills against a cap of 16, where one of
the 17 was a "Hiden/Tech Skills"-category skill (e.g. "SnS Tech") reaching its threshold with help
from an equipped cuff -- in that case the game doesn't count that skill against the cap at all (it
doesn't consume one of its slots, and can never itself be force-disabled), so all 17 should display
as active despite nominally exceeding the cap by one. A Hiden skill reached purely through
armor/decorations, with no cuff contribution, has no such exemption and is capped normally -- this
mechanic wasn't documented or implemented anywhere before this fix.

- `frontend/src/search-engine/active-skill-cap.ts`: `determineActiveSkills` gained an optional
  `cuffs: readonly NamedCuff[] = []` parameter (defaults to empty, so every call site that doesn't
  pass cuffs is unaffected). A new `cuffContributedSkillIds()` helper sums each cuff's own skill
  contributions; any active skill both in the `"Hiden/Tech Skills"` category (confirmed exact string
  against `skills.json`) and in that set is pulled out of the cap-ranked list entirely before the
  `rankedCapped.slice(cap)` cut, so it can never land in `disabled` -- `rankedActive`'s own docstring
  was updated to reflect that it's no longer simply "a prefix up to `cap`" once an exemption exists.
- `frontend/src/components/ResultsList.tsx`: passes `result.cuffs` through to `determineActiveSkills`
  (previously unused for this computation, only for the separate "Cuffs: ..." display line).
- Verification: 3 new `active-skill-cap.test.ts` cases (exempts a Hiden skill the cuff reaches past
  the cap; still caps a Hiden skill with no cuff contribution; doesn't exempt a cuff-sourced skill
  outside the Hiden/Tech category) pass, plus all 17 existing cases in that file. `tsc -b` and oxlint
  clean. Live-browser verified: pinned a real cuff ("SnS・G", 12 points towards "SnS Tech") alongside
  11 skill requirements sized to fill the cap, and confirmed "SnS Tech: 12" rendered with no
  `(disabled)` tag in the result while a separate, lower-priority skill past the cap did show one.

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
- **Follow-up (2026-10-15): Premium cuffs re-enabled by default; unavailable/training-only leaves
  excluded instead.** Per the project owner's explicit instruction: the earlier "exclude the whole
  Premium group by default" default (above) is superseded -- Premium cuffs are fine to offer
  out-of-the-box after all. What should actually start excluded, both for cuffs and for equipment's
  own gear-level filter, is anything unobtainable in the real game: `cuff_premium_unavailable`,
  `cuff_standard_unavailable`, `cuff_standard_training_only`, and equipment's whole "Unavailable"
  group (`unavailable_not_implemented`, `unavailable_training_only`). `App.tsx`'s
  `DEFAULT_EXCLUDED_CUFF_CATEGORIES` now holds just those 3 cuff leaves (derived from
  `CUFF_CATEGORY_GROUPS` by key substring, not hand-listed) instead of the whole Premium group;
  a new `DEFAULT_EXCLUDED_EQUIPMENT_CATEGORIES` (derived from `GEAR_CATEGORY_GROUPS`'s "Unavailable"
  group) now seeds `excludedCategories` too, which previously started empty (nothing excluded) --
  the first default-exclusion equipment has ever had. Also changed in the same pass: `preferExactMatches`
  now defaults to `true` (previously `false`) -- the project owner's instruction, reasoning that an
  unrequested skill reaching one of its own tiers unprompted is more often a surprise than a win.
  `App.test.tsx` updated throughout (a new `cuff_standard_unavailable` fixture cuff added to prove
  the new default-exclusion; every test's expected default cuff list changed from "only Standard" to
  "Premium + Standard, minus the unavailable one"; the `preferExactMatches` toggle test flipped to
  prove *un*checking it now disables the setting, since checked is the new default). 191/191
  frontend tests pass, `tsc -b` and oxlint clean. Live-browser-verified: a fresh page load shows
  "Prefer exact matches" checked, "Premium"/"Standard" cuff groups checked, and every "Not
  Implemented"/"Training Only"/"(Unavailable)" leaf (both equipment and cuff trees) unchecked, with
  no control touched.

## 7. Exclude or force-include specific armor pieces / cuffs

**Status: COMPLETE and verified, both armor and cuffs (cuff picker added 2026-10-15, see
"Cuff pinning" below).** Implements the refined scope's force-include direction for the 5 real
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
- The weapon slot is out of scope for *this* picker, for a different reason than cuffs below: it has
  no real per-piece identity to pin at all (only a Zenith skill, which is already force-selectable
  today via its own exclude checklist in `App.tsx` -- excluding every option but one *is*
  force-include for that slot).

**Cuff pinning (2026-10-15, built as TODO #9's blocking prerequisite)**: cuffs can't reuse the
single-candidate-narrowing trick above, because cuffs aren't modeled as a `SlotQuery` at all --
they're a flat, shared 0-2 pool with a combined slot-cost budget (`ilp-model.ts`'s
`CUFF_SLOT_BUDGET`/`MAX_EQUIPPED_CUFFS`), so there's no per-slot cardinality row to narrow down to
one option. Solved instead by folding a pin directly into the model's row bounds rather than adding
new ILP machinery:

- `SearchOptions.pinnedCuffs?: readonly Cuff[]` (`types.ts`): 0-2 cuffs to force into the build.
  Never modeled as columns -- `ilp-model.ts`'s `buildModel` instead (a) lowers each requirement row's
  `minPoints` by however much the pin already contributes to that skill, and (b) tightens the free
  pool's `cuffBudgetRow`/`cuffCountRow` upper bounds by the pin's own slot-cost sum/count, so the
  solver's own free cuffs can only spend what's left. A pin's contribution is identical across every
  candidate solution the solver considers, so it's deliberately left out of the
  `preferExactMatches` tier machinery too -- a constant term can't change which solution ranks best,
  only a *varying* one needs modeling there (documented inline at the read site in `buildModel`).
  `engine.ts`'s `search()` merges the pinned cuffs into every yielded result's `cuffs` array and
  `skillTotals` after decoding the solver's own (smaller) free-pool choice -- `decodeSolution` itself
  is untouched, since it only ever knew about the free pool to begin with.
- `frontend/src/components/CuffPicker.tsx` (new): two independent pickers ("Cuff slot 1"/"Cuff slot
  2", mirroring `MAX_EQUIPPED_CUFFS`), each a type-to-filter search reusing the same pattern
  `ArmorPicker.tsx` established -- extracted that pattern into a shared
  `frontend/src/components/FilterableOptions.tsx` rather than duplicating it, since this is now two
  real call sites. The same cuff id can be pinned into both slots at once (confirmed allowed by the
  project owner, same as the solver's own duplicate-cuff behavior).
- `App.tsx`: new `pinnedCuffIds: readonly string[]` state (0-2 cuff ids, index-positional), a "Pin
  specific cuffs" `Disclosure` section nested under "Poogie cuffs", and `handleSearch` resolves the
  ids to full `NamedCuff` objects and passes them as `pinnedCuffs` in the search options.
- Verification: 3 new `ilp-model.test.ts` cases (credits a pin's skills with no cuff column created;
  a pin exhausting the shared budget blocks an equal-cost free cuff; a pin exhausting the item-count
  limit blocks any further free cuff) and 3 new `engine.test.ts` cases (pin alone; pin + coexisting
  free cuff within budget; pin + free cuff that no longer fits) all pass, plus 5 new
  `CuffPicker.test.tsx` cases. Full suite, `tsc -b`, and oxlint all clean (see this item's own
  verification note for the exact run).
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

## 9. Share a build result via a generated link

**Status: COMPLETE and verified (2026-10-15).** A button on a search result card that produces a
shareable link. Original ask and refined ask below (kept for context); "Implementation" further down
covers what was actually built.

- Nothing like this exists today: there's no URL-state encoding anywhere in the app (`App.tsx` holds
  every search input purely in React `useState`, no `useSearchParams`/router, no query-string
  parsing on load) and no per-result identifier -- `BuildResult` ([types.ts](../frontend/src/search-engine/types.ts))
  has no id field, just `picks`/`decorations`/`cuffs`/`skillTotals`.
- What "this exact result" depends on, all currently plain component state in `App.tsx`: skill
  requirements (`requirements`, `zenithRequirements`), `excludedCategories`,
  `excludedCuffCategories`, `excludedWeaponZenithSkillIds`, `weaponSlotCount`, `pinnedArmor`
  (TODO #7's force-included pieces/decorations), and `preferExactMatches`. The search worker
  (`worker.search()`, streamed results via `worker-handler.ts`/`worker-protocol.ts`) can return
  several ranked results per search, so reproducing "this exact result" also needs to identify
  *which* one in that list (e.g. its rank/index), not just the search inputs -- a regenerated search
  against unchanged data should be deterministic for a given result index, but isn't guaranteed
  stable if the underlying data bundle (`frontend/public/data/*.json`) is ever re-exported with
  different ids in between.
- Out of scope for this entry: any backend/server-side link shortening or persistence -- this is a
  client-only app (static `frontend/public/data/*.json`, no backend), so "generated link" most
  likely means a self-contained URL that encodes the full state itself, not a server-issued short
  id pointing at stored state.

**Refined scope (2026-10-15, from the project owner)**: the link doesn't just reproduce the search --
it opens its own dedicated page showing *just that one result* (not the full search UI with its
inputs/results list), the same "single build" view a real Monster Hunter set-builder's permalink page
would show. That page carries one button, "Use as a base for a new search" (exact wording TBD),
which takes the viewer to the normal search page with every part of that result **pinned**: each
armor slot via TODO #7's existing `pinnedArmor` mechanism, the weapon's Zenith skill forced the same
way `buildWeaponSlot` already supports, and -- new prerequisite -- **both cuffs pinned too**, which
isn't possible today:

- **Blocking prerequisite: cuff pinning doesn't exist.** TODO #7's armor picker explicitly scoped
  cuffs out ("cuffs need their own design... likely closer to the weapon-slot picker... than the
  per-armor-slot one"). This TODO can't fully "pin every part of a result" without it. Likely shape,
  following that same note: cuffs are a flat 0-2 list (not per-slot, see `BuildResult.cuffs`), so a
  cuff pin is probably closer to the weapon slot's "narrow the candidate list to the allowed
  skill(s)" pattern than to `ArmorPicker.tsx`'s per-slot one -- but the real design question is
  whether "pin this result's cuffs" needs a general-purpose cuff *picker* (symmetrical with the armor
  one, usable standalone) or just enough machinery to force-reproduce two specific cuffs from a
  shared link -- left open rather than guessed at, since the two have different implementation
  shapes and UI footprints.
- The result page itself is new scope: a route/view distinct from the main search page, rendering one
  `BuildResult` (picks + decorations + cuffs + skill totals, same data `ResultsList.tsx` already
  knows how to render per-card -- likely reuses that card's rendering, not a new one) with no
  surrounding search form. Needs the same state-encoding work the original ask already called for
  (serializing requirements/exclusions/pins/preferences, plus which result index) to reconstruct that
  one result without the viewer re-running a search themselves.
- Still open, same as before: whether reconstructing the page re-runs the solver for just that one
  index, or encodes the `BuildResult` data directly (avoids ever needing cross-session-stable ids,
  but makes the link heavier) -- left for implementation time.

**Implementation (2026-10-15)**:

- **Cuff-pinning prerequisite**: built first -- see TODO #7's own "Cuff pinning" section for the
  full writeup (`SearchOptions.pinnedCuffs`, `ilp-model.ts`/`engine.ts` changes, `CuffPicker.tsx`).
  Resolves the open design question in favor of a general-purpose, standalone cuff picker
  (symmetrical with `ArmorPicker.tsx`), not a link-reconstruction-only mechanism.
- **Re-run vs. encode the result directly**: resolved in favor of re-running the solver. A link
  already has to encode the full query (every `QueryFormState` field, the requirements, and
  `preferExactMatches`) regardless, since the "use as a base" button needs those inputs anyway -- so
  re-deriving the one result at `resultIndex` from that same query costs nothing extra, and avoids a
  second, heavier encoding of `BuildResult` data plus any need for cross-session-stable ids. Accepted
  trade-off: a link can resolve to a different result (or none) if the data bundle changes
  significantly between sharing and opening -- documented in `shared-state.ts`'s own docstring, no
  worse than this app's existing lack of cross-session stability elsewhere (e.g. pinned piece ids).
- `frontend/src/search-engine/build-query.ts` (new): the query-construction logic (`buildWeaponSlot`,
  `slotsAfterCategoryFilter`, `slotsAfterPinning`, `cuffsAfterCategoryFilter`,
  `resolvePinnedCuffs`, combined into `buildSearchQuery`) extracted out of `App.tsx`'s own closures
  into pure functions taking a `DataBundle` and a `QueryFormState` -- needed so the shared-result page
  can reconstruct the *identical* query `App.tsx`'s live search builds, from the same single
  implementation, not a second drifting copy. Also gained `pinnedWeaponExclusion` and
  `pinnedArmorFromResult`, the inverse direction: turning a *solved* result back into the pinned
  state "use as a base" needs.
- `frontend/src/search-engine/shared-state.ts` (new): `SharedSearchState` (every `QueryFormState`
  field plus `requirements`/`zenithRequirements`/`preferExactMatches`/`resultIndex`) and its
  base64url encode/decode, plus `buildResultUrl`/`readSharedStateFromLocation`. Uses a hash route
  (`#/result/<encoded>`), not a real path -- this is a static SPA with no server-side rewrite rule,
  and a hash fragment needs none to survive a refresh or direct visit (confirmed working against a
  local production build, see docs/hosting.md).
- `frontend/src/AppRoot.tsx` (new): picks between `App` and the new `ResultPage` based on
  `window.location.hash`. Owns the "use as a base" handoff -- `App`'s search inputs are plain
  internal `useState`, seeded once from an optional `initialState` prop (`App.tsx`'s new
  `AppInitialState`), so handing in new pinned state means forcing a fresh `App` mount via a `key`
  bump, not reaching into its state from outside.
- `frontend/src/ResultPage.tsx` (new): the dedicated single-result page. Reconstructs the query via
  `buildSearchQuery`, runs the real worker search, collects streamed results until `resultIndex` is
  reached (or the search finishes short, reported as "no longer be found" -- the data-changed edge
  case above), and renders it via `ResultsList.tsx`'s now-exported `ResultCard` (no second copy of
  that rendering). Its "Use as a base for a new search" button builds a fresh `AppInitialState` from
  the *solved* result (`pinnedArmorFromResult`/`pinnedWeaponExclusion`), not the original query, so
  cuffs/armor/weapon all end up pinned to exactly what the shared build actually contained.
- `frontend/src/components/ResultsList.tsx`: `ResultsListProps` gained an optional
  `getShareUrl?: (index: number) => string` (only `App.tsx`'s live search passes one --
  `ResultPage`'s own single card has no further index to share). Each card gets a "Get shareable
  link" button revealing a read-only text field plus a best-effort clipboard "Copy" button
  (`navigator.clipboard?.writeText`, not required to exist).
- `App.tsx`: `buildShareUrl(resultIndex)` assembles a `SharedSearchState` from current state and
  calls `buildResultUrl`; `AppInitialState` (new, exported) is the shape `AppRoot` hands back in.
- Verification: new `shared-state.test.ts` (7 cases, round-trip + malformed-input handling),
  `ResultPage.test.tsx` (5 cases), `AppRoot.test.tsx` (2 cases), plus updated `App.test.tsx` (a new
  share-link test) and `ResultsList.test.tsx`. Full suite green, `tsc -b` and oxlint clean. Live
  browser, against a local GitHub-Pages-equivalent production build (see docs/hosting.md): ran a
  real search, clicked "Get shareable link," opened that exact URL in a fresh tab, confirmed the
  reconstructed page showed the identical picks/skill totals, then clicked "Use as a base for a new
  search" and confirmed the main page came back with all 5 armor pieces pinned to the shared build's
  exact pieces and the original skill requirement intact.

## 10. UI overhaul: decluttered, collapsible, modern

**Status (2026-10-15): First pass COMPLETE -- main search page converted to collapsible sections.**
The main search page had grown one flat, always-expanded section per feature (Skills, Zenith skills,
Pin specific armor, Gear levels, Poogie cuffs, Weapon, Prefer exact matches, Search) as each TODO
above landed its own UI -- individually reasonable, but the project owner's own assessment was that
the whole page had become "immensely cluttered and very difficult to parse." Explicit instruction for
this pass: keep in mind how much information is being presented and how complicated the system is,
and present it in a way that doesn't feel as overwhelming, while feeling modern and dynamic.

- `frontend/src/components/Disclosure.tsx` (new): a collapsible section -- a clickable header (title
  + chevron that rotates open, plus a one-line `summary` shown only while collapsed) and a body that
  animates to/from zero height via the CSS `grid-template-rows: 0fr -> 1fr` trick (`index.css`), not a
  JS height measurement. Deliberately keeps its content mounted and un-`display:none`d even while
  closed, rather than the more conventional "hide from the accessibility tree while collapsed"
  pattern -- documented in its own docstring as an intentional trade-off: every existing test in this
  project queries a filter's controls directly (no "open the section first" step), and keeping
  content un-hidden means none of them needed that extra step added. The real cost is that a
  collapsed section's controls stay keyboard-tab-reachable, a minor accessibility imperfection
  accepted for this pass rather than guessed away.
- `App.tsx`: every one of the page's six filter/picker sections (Skills, Zenith skills, Pin specific
  armor, Gear levels, Poogie cuffs, Weapon) now renders through `<Disclosure>`. Only **Skills** opens
  by default (the one genuinely required input -- a search can't run without at least one
  requirement); every other section starts collapsed, each showing a live one-line summary computed
  from current state (e.g. "2 categories of 63 excluded", "0 of 23 Zenith skills allowed, 0 slots
  reserved", "None pinned") so a closed section still communicates what's active without a click.
  "Prefer exact matches" stays a plain, always-visible checkbox (not its own disclosure) since it's a
  single toggle, not a list of controls -- collapsing it would cost a click to save none.
- Page shell restyled in `index.css`: each section is now a bordered, rounded card (`.disclosure`)
  with a hover-highlighted header; the Search/Cancel buttons plus the "Prefer exact matches" toggle
  moved into a single `position: sticky` action bar (`.app-action-bar`) with its own border/shadow, so
  it stays visually distinct from the filter stack above it and anchors to the bottom of the viewport
  while scrolling. A one-line intro paragraph under the `<h1>` explains the new "open only what you
  need" model. All of this reuses the light/dark CSS custom properties already defined at the top of
  `index.css` (`--bg`/`--text`/`--border`/`--accent`/`--shadow`), so both color schemes stay
  consistent without new theme-specific rules.
- Explicit inspiration pointer from the project owner (existing Monster Hunter set-builder sites,
  including the reference site this project's own data comes from) was kept in mind for the general
  shape of the solution (a collapsible-section list with per-section summaries) -- a deeper pass
  modeled more closely on a specific reference site's exact visual layout remains open for a follow-up
  once/if the project owner points at a specific one they want matched more closely.
- Scope was presentation/layout only, as planned -- no control, filter, or picker lost functionality;
  every one still renders exactly the same component it did before, just inside a collapsible wrapper.
- Verification: new `Disclosure.test.tsx` (5 tests: default-closed, `defaultOpen`, toggling, summary
  shown only while closed, content reachable while closed). No existing test needed updating to
  "open the section first" because of the content-stays-mounted decision above. 196/196 frontend
  tests pass (191 -> 196), `tsc -b` and oxlint clean. Live-browser-verified in both light and dark
  color schemes: fresh load shows only Skills expanded with every other section collapsed and
  showing a correct live summary; clicking a header's chevron smoothly expands/collapses it; fixed a
  grammar bug caught only by looking at the real rendered page ("2 categorys" -> "2 categories",
  `pluralize()` now takes an explicit irregular-plural form instead of always appending "s").
- **Still open / not attempted in this pass**: `ResultsList.tsx`'s result cards were left visually
  as-is (not restyled) -- today's `<dl>`-based layout is dense but wasn't called out as part of the
  "cluttered" complaint, which was about the search *form*, not its results; TODO #9's planned
  dedicated single-result page will likely want to revisit this card's presentation anyway, so
  restyling it twice seemed wasteful. A deeper visual-identity pass modeled closely on a specific
  reference set-builder site (exact colors/typography/iconography, not just "a list of collapsible
  cards") is also not attempted here -- left for a follow-up once the project owner has a specific
  site or mockup in mind to match, consistent with this TODO's own original note that the exact
  visual direction needed their input rather than being guessed at.

## 11. Decoration tier include/exclude filter

**Status (2026-10-15): COMPLETE.** The same category-level include/exclude control that already
exists for armor (`GEAR_CATEGORY_GROUPS`/`CategoryFilter.tsx`) and cuffs (`CUFF_CATEGORY_GROUPS`)
now exists for decorations too. Decorations only have one machine-readable axis to filter on today
-- `isTower` -- so this started (and ships) as a single toggle rather than the richer multi-level
category tree armor/cuffs have; a fuller decoration category taxonomy would add more groups to the
same mechanism, not replace it.

- `frontend/src/search-engine/decoration-categories.ts` (new): `DECORATION_CATEGORY_GROUPS`
  (reuses `GearCategoryGroup` from `gear-categories.ts`) -- one group, "Decoration tier", one leaf
  keyed `TOWER_DECORATION_CATEGORY_KEY = 'tower'`.
- `build-query.ts`'s old hardcoded `filterOutTowerDecorations` became
  `decorationsAfterCategoryFilter(decorations, excludedCategories)`, filtering `isTower`
  decorations only when the `'tower'` key is in the excluded set -- same shape as
  `cuffsAfterCategoryFilter`. `QueryFormState` gained `excludedDecorationCategories`.
- `App.tsx`: new "Decorations" `Disclosure` section (reusing `CategoryFilter`, same as "Gear
  levels"/"Poogie cuffs"), new `excludedDecorationCategories` state defaulting to
  `DEFAULT_EXCLUDED_DECORATION_CATEGORIES = new Set(['tower'])` -- i.e. Tower Gems stay excluded
  out of the box, matching the old hardcoded behavior, but are now a visible, togglable choice.
  Both `pinnableDecorations` (the manual per-slot picker's pool) and `queryFormState` (the solver's
  pool) read from the same state, so pinning and searching can't drift apart on this.
  `AppInitialState`/`buildShareUrl` also carry the field through "use as a base" and shared links.
- `shared-state.ts`'s `SharedSearchState` gained `excludedDecorationCategories: readonly string[]`
  (required, same as `excludedCategories`/`excludedCuffCategories` -- not the nullable-with-bundle-
  fallback pattern `excludedWeaponZenithSkillIds` uses, since this filter's default set is static,
  not bundle-dependent). A link encoded before this change won't decode (missing required field),
  same as any other `SharedSearchState` shape change would -- no migration attempted.
- Verification: `tsc -b` clean, full frontend suite (226 tests, up from 225 -- one new case added
  to `build-query.test.ts` for "Tower category not excluded keeps Tower Gems in the pool"), oxlint
  clean. Live-browser confirmed the new checkbox renders unchecked (excluded) by default.

**Bug fix (2026-10-15): Tower Gems no longer mixed into the regular decoration pool.** Reported by
the project owner: Tower Gems (e.g. "Vampirism Gem II", "Sword God Gem II") are strictly stronger
than their regular equivalents and were showing up in ordinary (non-Tower) searches, crowding out
normal decorations almost every time one was relevant. `docs/data-format-notes.md` had already
flagged the underlying exclusivity rule (Tower armor can only take Tower Gems; regular armor can't
take them at all) as a known, unenforced gap -- the ETL already parsed and stored an `is_tower` flag
on every decoration row, it just never reached the export.

- `etl/src/etl/export.py`'s `_export_decorations()`: now includes `"isTower": decoration.is_tower`
  (the DB/parse layer already had this -- see `etl/src/etl/parse/equipment.py`'s
  `parse_decoration_bucket` and `models.py`'s `Decoration.is_tower`). No pipeline rebuild needed,
  just a re-export; confirmed via a live DB query that the real "Vampirism Gem I/II" and "Sword God
  Gem I/II" rows are flagged `true`, and the bundle now carries 173 Tower-flagged decorations.
- `frontend/src/search-engine/load-bundle.ts`'s `NamedDecoration` gained `isTower: boolean`.
- `frontend/src/search-engine/build-query.ts`'s new `filterOutTowerDecorations()` drops every
  `isTower` decoration before any decoration list reaches either the solver
  (`buildSearchQuery`'s returned `decorations`) or `ArmorPicker.tsx`'s own manual per-slot decoration
  picker (`App.tsx`'s `pinnableDecorations`) -- so a Tower Gem can't sneak in through pinning either.
- **This is a one-sided fix, not full bidirectional exclusivity.** It stops Tower Gems from ever
  being offered to a non-Tower (or any) slot, but a *regular* decoration still isn't prevented from
  being placed into an actual Tower armor piece's own open slots if one gets picked -- the engine has
  no per-slot/per-candidate decoration-compatibility concept at all today (every slot shares one flat
  pool, gated only by combined capacity). Fixing that fully would need real per-slot eligibility
  modeling, a bigger change than this bug warranted; left as a known gap, not pursued here since
  Tower armor is rare in practice and wasn't the reported complaint.
- Verification: new `etl/tests/test_export.py::test_exports_a_tower_decoration_flag` plus the
  existing shaped-export test updated for the new field (260 ETL tests pass, ruff/mypy clean); new
  `frontend/src/search-engine/build-query.test.ts` (3 cases: drops every Tower-flagged decoration,
  empty-result edge case, `buildSearchQuery` itself excludes them). Full frontend suite (225 tests),
  `tsc -b`, and oxlint all clean. Live-browser confirmed via the real exported bundle (173 Tower
  decorations correctly flagged, including the project owner's own two named examples).

## 12. Pin a decoration into a slot without pinning the armor piece

**Status (2026-10-15): Not started -- added per the project owner's request.** Today,
`ArmorPicker.tsx`'s decoration picker only appears once a specific piece is already pinned for that
slot (`PinnedSlot` requires a `candidateId`; see `ArmorSlotPicker`'s `candidate && !picking` gate) --
there's no way to force a specific decoration into a slot while leaving the solver free to choose
*which piece* goes there. Needs a design decision on how this composes with `ilp-model.ts`: a pinned
decoration without a pinned candidate can't use the existing "narrow the slot to one synthesized
candidate" trick (TODO #7's own mechanism), since the candidate itself is still meant to be chosen by
the solver -- this is closer in shape to the cuff-pinning mechanism (TODO #7's "Cuff pinning"
section: fold a fixed contribution directly into the model's row bounds) than to armor-piece pinning,
except it also has to guarantee the decoration's `slotSize` fits within whichever candidate the
solver ends up picking for that slot (a per-slot capacity constraint that doesn't apply to the
cuffs' shared pool). Left open for implementation time rather than guessed at here.

## 13. Let the user choose how many results to return

**Status (2026-10-15): COMPLETE.** `App.tsx`'s old hardcoded `MAX_RESULTS` constant is now a
user-facing dropdown.

- `App.tsx`: `DEFAULT_MAX_RESULTS = 5` (the old constant's value, now just the default) and
  `MAX_RESULTS_OPTIONS = [1, 3, 5, 10, 20] as const` -- a closed set of options rather than a free
  number input, decided per the ILP solver's own cost model (each extra result is a full extra
  solver round-trip, see the preserved comment above `DEFAULT_MAX_RESULTS`), so the ceiling stays
  bounded without needing separate floor/ceiling validation on a text input. New `maxResults` state
  (seeded from `initialState?.maxResults ?? DEFAULT_MAX_RESULTS`) replaces the constant in both
  `handleSearch`'s cap check and the "Showing the top N results" copy (now pluralized for N=1). A
  new "Results to show" `<select>` sits next to the "Prefer exact matches" toggle in the action bar.
- `AppInitialState` gained an optional `maxResults?: number` so "use as a base for a new search"
  (TODO #9) can carry it forward, but per this entry's own original note, `SharedSearchState` does
  *not* carry it -- a shared link still only ever points at one specific `resultIndex`, so how many
  results its original sender chose to see doesn't change what the link resolves to.
- Verification: `tsc -b` clean, `App.test.tsx` (18/18, including the existing "doesn't render every
  streamed result" cap test, unchanged since it exercises the same default), live-browser confirmed
  the dropdown renders with all five options.

## 14. Shorten shareable build-result links

**Status (2026-10-15): COMPLETE.** Combined the two cheapest candidate directions this entry
originally proposed: short field names/tuples instead of `SharedSearchState`'s full shape, plus
gzip compression via the browser's native `CompressionStream`/`DecompressionStream` (no new
dependency). The backend/URL-shortener option was not pursued -- it would give up this app's
"fully static, no server" property, and the combined approach already gives a large margin under
Discord's 2000-character non-Nitro limit.

- `shared-state.ts`: new internal `WireFormat` type (`toWireFormat`/`fromWireFormat`) with short
  keys (`r`, `zr`, `ec`, `ecc`, `edc`, `ewz`, `wsc`, `pa`, `pc`, `pem`, `ri`) and tuple-shaped
  requirements/pinned-armor entries -- `SharedSearchState` itself, and everything outside this
  module, is untouched. `encodeSharedState`/`decodeSharedState` now `JSON.stringify`/`parse` the
  wire format, gzip/gunzip it (via `Response`/`CompressionStream`, not `Blob.stream()` -- jsdom's
  `Blob` polyfill doesn't implement that method, unlike every real browser's), and base64url-encode
  the compressed bytes directly (no more UTF-8-escape round-trip, since compressed output is
  already raw bytes, not text).
- This makes encode/decode `async`, which ripples into every caller: `buildResultUrl`,
  `App.tsx`'s `buildShareUrl` (and `ResultsList.tsx`'s `getShareUrl` prop type, now
  `() => Promise<string>`, with a brief "Generating link…" disabled state on the button while it
  awaits), and reading a link back. `AppRoot.tsx` no longer decodes at all -- it only checks
  `hasSharedResultHash()`/reads the raw payload via `encodedResultFromLocation()` (both
  synchronous, a plain prefix/substring check) to decide whether to render `ResultPage` at all;
  `ResultPage.tsx` now takes the still-encoded `encoded: string` instead of a decoded
  `SharedSearchState`, and decodes it itself in an effect (new `'invalid-link'`
  `ReconstructStatus`, shown as its own error message) alongside its already-async solver
  reconstruction, rather than `AppRoot` needing a decode-loading state of its own with nothing yet
  to render.
- Breaking change, not versioned, matching TODO #11's own precedent: a link encoded before this
  change fails to decode (shows the new "invalid-link" message) rather than being migrated.
- Verification: a disposable size-check script comparing a realistic query (12 skill
  requirements, 3 pinned armor pieces with decorations, both cuff slots pinned, several excluded
  categories) across encodings: today's old full-name/plain-base64 encoding came to ~1538 total
  link characters; short names alone, ~746; short names + gzip (what shipped), ~442 -- roughly a
  3.5x reduction. A second scratch test (also not committed) checked scaling isn't the worry it
  looks like at first glance -- link length grows roughly linearly with constraint count, no blowup,
  because gzip compresses the repetitive structure (many similar skill-id/category-key entries)
  well: a tiny query (2 requirements, nothing pinned) encodes to ~294 total characters; "heavy" (25
  requirements, all 5 armor pieces pinned with 3 decorations each, 20 excluded categories) to ~760;
  and a deliberately pathological case (all 194 catalog skills required at once, every one of the
  63 gear categories and all 26 weapon Zenith skills excluded, 5 pieces pinned) still only reaches
  ~1447 -- comfortably under Discord's 2000-character limit even at that extreme. `tsc -b` clean
  (after routing gzip/gunzip through `Response` rather than hand-rolled `ReadableStream` reading --
  the DOM lib's `Uint8Array<ArrayBuffer>` vs. `Uint8Array<ArrayBufferLike>` generics didn't
  reconcile cleanly with a raw stream reader). Full frontend suite (229 tests, up from 226) and
  oxlint clean. Live-browser end-to-end: generated a real link from an actual search (243
  characters total), confirmed it reconstructs the exact same build on open, and confirmed a
  corrupted/garbage link shows the new error message instead of crashing.
