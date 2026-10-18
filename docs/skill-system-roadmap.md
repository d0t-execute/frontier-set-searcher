# Skill system roadmap

Planned future-work items on skill mechanics (cap system, priority list, Zenith/Exotic
skills), cuff equipment support, skill UI/categorization, per-piece include/
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

**Status: COMPLETE and verified (2026-10-15).** The original "RESOLVED -- does not exist" conclusion
below was wrong (or at least incomplete) -- the project owner corrected it directly: "exotic armor is
also still unimplemented. the way it works is that some pieces of armor, those gotten from 'exotic'
monsters, will simply give the maximum tier of a specific skill. for example, equipping any barioth
armor piece will grant ice attack up large in addition to its other skills." There *is* a real
mechanic here; it just isn't a separate skill pool the way Zenith is (which is what the original
research was specifically checking for and correctly found nothing of).

- Investigated the raw data directly rather than guessing from the correction alone (full write-up:
  [data-format-notes.md](data-format-notes.md)'s new "Exotic armor" section). Found: Exotic equipment
  (`CLASS="O"`) embeds a bracketed bonus-skill marker in its own flavor-text field (`DOC`, index 38),
  e.g. `≪Exotic Armor：Ice Attack 【Large】≫` -- confirmed against the site's own `SkillForm.js`, which
  extracts this text and forces that *normal* skill (from the same catalog as every other skill, not
  a separate pool like Zenith's `Teni`/`TENINAME`) active at that tier, unconditionally. Confirmed 1:1
  with `CLASS="O"` across the full real dataset (688/688 rows, 0 mismatches either direction),
  confined to the 5 armor buckets (0 in `deco`), and exactly 17 distinct markers total -- one fixed
  skill per Exotic monster family, identical across every piece/forge-tier within a family (checked
  all of Barioth's own rows).
- Each of the 17 raw markers was manually cross-referenced against its target skill's own existing
  tier-threshold points already in `skills.json` (e.g. `Ice Attack 【Large】` -> the "Ice Attack"
  skill's "Ice Attack (Large)" tier, 20 points) -- not guessed, and not resolved dynamically against
  `skill_tier` at load time, since that data isn't loaded until *after* equipment in `pipeline.py`'s
  `main()`. Resolved instead via a new fixed `EXOTIC_ARMOR_SKILL_GRANTS` dict (marker -> (skill name,
  points)), the same "confirmed-by-inspection, hardcoded" pattern already used elsewhere in this
  codebase (e.g. `ZENITH_SKILL_MAX_LEVEL`).
- **Modeled as a plain extra entry in the piece's own exported `skills` array**, summed with its
  normal `SN1-5` contributions if they happen to coincide on the same skill id -- not a new column,
  constraint, or search-engine mechanism. This reuses the engine's existing additive skill-point
  machinery completely unchanged (same reasoning TODO #2's Zenith-skill implementation already
  established: reuse what already works instead of building a parallel system), and matches the
  project owner's own framing exactly ("in addition to its other skills"). A deliberate
  simplification of the source site's own "force active unconditionally, don't double-count"
  semantics, which only matters to that site's own point-*display* UI, not to this project's solver.
- `etl/src/etl/parse/equipment.py`: new `Field.DOC = 38`, `_extract_exotic_skill_marker` (regex
  extraction only, no DB access -- resolution needs the skill catalog, which this layer doesn't
  have), `ParsedEquipmentRow.exotic_skill_marker: str | None`.
- `etl/src/etl/pipeline.py`: `EXOTIC_ARMOR_SKILL_GRANTS` dict; `load_equipment`'s per-row loop now
  sums every skill contribution (normal + the resolved Exotic grant, if any) into one dict before
  calling `add_equipment_skill`, avoiding a primary-key collision on `(equipment_id, skill_id)` when
  a grant coincides with one of the piece's own listed skills. `LoadSummary` gained
  `exotic_grant_count`/`unmatched_exotic_markers` (the latter surfaced, not silently dropped, same
  "report, don't guess" convention as `SkillTierLoadSummary`/`SkillPriorityLoadSummary` -- a future
  re-scrape could expose a new Exotic monster family this dict hasn't been taught about yet).
- No frontend changes needed at all -- `export.py`'s existing `_export_equipment` already serializes
  whatever's in each piece's own skill-points join, so the new contributions flow through for free.
- Verification: 2 new parse-layer tests (extracts the real "Barioth Helm" marker; `None` for a
  non-Exotic row) and 3 new pipeline-layer tests (applies the grant, correctly summed into the real
  skill catalog; reports an unmatched marker rather than dropping it silently; the shared fixture's
  new Barioth Helm row bumps `equipment_count` 13 -> 14) all pass. Full ETL suite: 289/289 tests pass,
  ruff clean. DB rebuilt from scratch (`.bak-pre-exotic-armor-grants` preserves the prior DB;
  "Applied 688 Exotic-armor bonus-skill grants" with 0 unmatched markers on the real rebuild), bundle
  re-exported and confirmed directly against the regenerated `equipment/head.json`: every real
  Barioth Helm variant (8 pieces, every forge tier) now lists `"Ice Attack": 20` alongside its own
  normal skills, exactly matching the project owner's own example.

**Follow-up (2026-10-15): Exotic-granted skills are exempt from the active-skill cap.** The project
owner: "exotic skills should also not count towards the skill cap." Mirrors TODO #1's existing
Hiden/cuff cap exemption (`active-skill-cap.ts`'s `isCapExempt`), but unconditional -- not gated by
category, since an Exotic grant (e.g. Barioth's "Ice Attack") is never itself a Hiden/Tech skill.

- A piece's Exotic grant needed its own column separate from the merged skill points added for TODO
  #3 above, since the merged-points representation made it structurally impossible to tell an
  Exotic-granted skill id apart from the piece's own normal contributions after the fact -- needed to
  know *which* skill id to exempt, not just that the piece has *some* bonus. Added `equipment.
  exotic_skill_id` (nullable FK to `skill`, schema.sql/models.py/repository.py) alongside the
  existing merged-points entry in `equipment_skill` -- both now set from the same resolved grant in
  `pipeline.py`'s `load_equipment`, not a second lookup.
- `export.py`'s `_export_equipment` gained `exoticSkillId`; `load-bundle.ts`'s `NamedCandidate`
  gained the matching `exoticSkillId: number | null` field.
- `active-skill-cap.ts`: new `exoticGrantedSkillIds(picks)` (mirrors the existing
  `cuffContributedSkillIds`), and `isCapExempt` now also exempts any skill id in that set,
  unconditionally -- independent of the existing Hiden/cuff category check.
- `shared-state.ts`'s `SharedPick` gained `exoticSkillId` (carried through the wire format) so a
  shared link's reconstructed result still shows the exemption correctly, without re-resolving
  anything against the live bundle (same TODO #15 constraint as every other field on `SharedPick`).
- Verification: new `active-skill-cap.test.ts` cases (exempts an Exotic-granted skill regardless of
  category; doesn't exempt an otherwise-identical skill when no pick's Exotic grant targets it).
  ETL: new `test_load_equipment_sets_exotic_skill_id_separately_from_the_merged_points` pipeline test.
  Real DB rebuilt a second time to pick up the new column (688 grants still applied, 0 unmatched);
  bundle re-exported and confirmed Barioth pieces now carry `"exoticSkillId": 83` ("Ice Attack")
  alongside their already-merged points.

## 4. "Go Skill Boost"

**Removed (2026-10-18) per the project owner.** Never found in any scraped data or research pass
(see git history for this entry's prior research notes); dropped from scope rather than left open.

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

**Follow-up (2026-10-15): Result-card redesign, three-column layout.** The project owner supplied a
concept mockup for exactly the "`ResultsList.tsx`'s result cards were left visually as-is" gap noted
above -- saved at [result-card-mockup.png](result-card-mockup.png). **Status: Not started.** Full spec,
in the project owner's own words plus what the mockup shows:

- **Three-column layout per result card.**
  - **Left column -- skills**: each active skill shown as its actual *level* in brackets, not a raw
    point total, alongside its current points over the threshold that crossed it, e.g. `Stylish +1
    (17/15)` and `Sword Saint (30/30)` (the mockup's own examples). A skill that hasn't crossed any
    threshold yet should still show its progress the same way (e.g. `8/10`). Skills that are either
    below their own first threshold or force-disabled by the active-skill cap (`active-skill-cap.ts`'s
    existing `disabled` list) should render **grayed out**, visually distinct from active ones --
    today's plain comma-joined list with a parenthetical `(disabled)` suffix doesn't make this
    distinction visually, just textually.
  - **Middle column -- picks**: the armor pieces and weapon, same information already shown today
    (`ResultsList.tsx`'s per-slot `<dl>`), but each piece's own decorations shown as its own small
    sub-list under it (the mockup shows "Helmet" with "Deco 1/Deco 2/Deco 3" indented beneath) rather
    than inline as today's `" + <deco name>"` suffix.
  - **Right column -- stats**: new info not shown anywhere today -- **total armor** (the actual
    summed defense stat across all equipped pieces, not yet modeled/exported anywhere in this
    pipeline for a *build* total, only per-piece `defense_base`/`defense_max`), **all five
    resistances** (Fire/Water/Thunder/Ice/Dragon, summed the same way), and room for other
    at-a-glance totals the project owner called out as "nice to have" without pinning down an exact
    list yet (floated "total skill cap" as one example -- already computed today via
    `determineActiveSkills`'s `cap`, just not shown in this column).
- **Hover tooltips on picks**: hovering an armor piece or a placed decoration in the middle column
  pops up its own individual skill-point contributions (which skills, how many points each) -- today
  nothing shows a piece's own contribution in isolation, only the build's already-summed
  `skillTotals`.
- **Scope note, not yet investigated**: a per-build "total armor"/resistance total needs summing
  defense/resistance across the solver's own chosen picks at render time (straightforward, all the
  per-piece data already exists in `NamedCandidate`... except resistances aren't parsed/exported at
  all yet -- `docs/data-format-notes.md`'s own column layout table lists fields 5-9 (`F, W, T, D, I`)
  as "Fire/Water/Thunder/Dragon/Ice resistance" but marks them out of scope today, same as several
  other still-deferred fields). Getting resistances into result cards therefore has an ETL
  prerequisite (parse + export those 5 fields per piece) before any frontend work can show them --
  not optional polish, a blocking dependency.
- Per-piece skill contributions for the hover tooltip are already fully available
  (`NamedCandidate.skills`/`NamedDecoration.skills`) -- no new data plumbing needed there, purely a
  new UI affordance.
- Nothing about this changes the search engine itself (constraints, objective, solver) -- purely a
  display/presentation redesign of an already-complete `BuildResult`, same category of change as
  TODO #16's Zenith-skill split.

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

**Follow-up (2026-10-15): replaced the single "Tower Gems" toggle with a real, full decoration
category tree.** The user supplied a screenshot of the reference tool's own decoration-category
checkbox tree (Standard, G Rank, Hiden, Raviente, Musou, Events, Festival, Guild, Hunter's Road --
24 leaves total), explicitly excluding Tower from it (Tower stays governed by the pre-existing,
separate `isTower` toggle above, untouched).

- `etl/src/etl/parse/gear_category.py`'s new `classify_decoration_category` (mirrors
  `classify_equipment_category`/`classify_cuff_category`'s own CRE-first precedence) implements
  every leaf, threaded through `ParsedDecorationRow.category` -> `Decoration.category` (new DB
  column, default `'deco_standard'`) -> `decorations.json`'s new `category` field.
- Every leaf was verified against the real cached dataset (`etl/.data/cache/equip.body`'s decoration
  bucket, 2,658 rows after correctly filtering out Cuff/placeholder rows that share the same raw
  bucket) -- see `docs/gear-category-taxonomy.md`'s "Decorations" table for the full rule set and
  confirmed counts. Two corrections fell out of this pass: the old "イGX" count (93, a guess) was
  actually 43 once the 50 Musou rows (which share its same `CRE=1e`+`CLASS I` bucket) were carved
  out; and the old "Diva Defense" leaf (`CRE=2u`, guessed INFERRED) turned out to actually be
  Keoaruboru's decorations (confirmed by the user: obtained through Diva Defense, so it's the same
  leaf as the reference tool's own "Diva Def," not two).
- Five leaves (the Musou monster sub-series, DClad/Rapin/Elysium/Bonne/Fonce) and Keoaruboru
  couldn't be derived from CRE/CLASS alone -- every one of them shares its bucket with ordinary
  named-monster decorations, so CRE/CLASS can't distinguish them. Resolved by asking the user for
  the exact in-game decoration names, then confirming each against the raw dataset: Demonclad(BM)/
  Dojiclad(GN) = Musou Nargacuga, Rafan = Musou Bogabadorumu, Elysium = Musou Zerureusu, Bonne =
  Musou Duremudira, Fonce = Musou Elzelion, Burning Cliff(BM)/Crimson Cliff(GN) = Keoaruboru.
- One leaf from the reference tool's tree, "(EXd): Extreme Quests," is deferred -- no decoration
  name in the real dataset could be confirmed for it (only "Extreme"/"EX" token matches were the
  already-accounted-for Extreme Raviente GX rows). Needs the exact decoration name before it can be
  added.
- `frontend/src/search-engine/decoration-categories.ts` rewritten: `DECORATION_CATEGORY_GROUPS` now
  has 10 groups (the pre-existing single-leaf "Decoration tier" group, kept untouched and first, plus
  9 new groups for the confirmed taxonomy). `load-bundle.ts`'s `NamedDecoration` gained a `category:
  string` field (mirrors `NamedCuff`/`NamedCandidate`). `build-query.ts`'s
  `decorationsAfterCategoryFilter` now checks both `isTower` (via `TOWER_DECORATION_CATEGORY_KEY`,
  unchanged) and `d.category` against the same `excludedDecorationCategories` set -- a decoration
  survives only if it passes both checks, so the Tower toggle and the new tree keep working
  independently through one shared state.
- Schema change required a full ETL pipeline rebuild (new `decoration.category` column; `CREATE
  TABLE IF NOT EXISTS` is a no-op against an already-materialized table -- same gotcha as the cuff-
  category column, see [[project_cuff_equipment_support]]): old `frontier.sqlite3` moved aside as
  `frontier.sqlite3.bak-pre-deco-category`, full `python -m etl.pipeline` + `python -m etl.export`
  re-run against the cached raw data. Real counts tabulated and matched the taxonomy doc exactly
  (2,658 decorations; see the doc's table for every leaf's count).
- Verification: 285 ETL tests pass (up from 258; new `test_gear_category.py` cases for every leaf,
  including the Shantien-shaped "G2".."G5"/"GF2".."GF5" numbered-tier-token edge case that an
  exact-token-membership check misses), ruff clean. Full frontend suite (250 tests, up from 248;
  two new `build-query.test.ts` cases for the combined isTower+category filter), `tsc -b`, oxlint
  all clean. Live-browser confirmed against the real regenerated bundle: all 25 checkboxes (Tower +
  24 new leaves) render under "Decorations" exactly matching the user's screenshot structure, and an
  end-to-end search (Attack) completes with no console errors.

**Follow-up (2026-10-15): Tower Gems removed from search entirely; Lottery Hiden excluded by
default.** User feedback: Tower Gems shouldn't be a togglable choice at all (there's no legitimate
reason to search with them in scope, since this engine has no way to target them at a Tower armor
piece specifically) -- the toggle from the entry above is now gone, replaced with an unconditional
exclusion.

- `decoration-categories.ts`: removed `TOWER_DECORATION_CATEGORY_KEY` and the "Decoration tier"
  group entirely (24 leaves now, down from 25).
- `build-query.ts`'s `decorationsAfterCategoryFilter`: drops every `isTower` decoration
  unconditionally (`if (d.isTower) return false`), no longer gated on `excludedCategories`. The
  `category`-based filter (the richer tree) is unaffected and stays togglable.
- `App.tsx`: `DEFAULT_EXCLUDED_DECORATION_CATEGORIES` changed from `new Set([TOWER_DECORATION_CATEGORY_KEY])`
  to `new Set(['deco_lottery_hiden'])` -- Lottery Hiden Decorations ("do not use" per the reference
  tool's own tree) now starts excluded by default, same pattern as Tower Gems used to, but still a
  togglable choice (unlike Tower, which is never equippable through this tool's searches at all).
  The "Decorations" section's static blurb was rewritten to state the Tower exclusion as a fact,
  not an instruction to "include them here."
- Verification: full frontend suite (249 tests, down from 250 -- two Tower-toggle-specific cases
  removed, one combined case added), `tsc -b`, oxlint all clean. Live-browser confirmed via DOM
  query against the real bundle: no `deco_tower` checkbox exists anywhere in the Decorations
  section; `gear-category-deco_lottery_hiden` renders unchecked (excluded) by default; every other
  decoration leaf renders checked (included).

## 12. Pin a decoration into a slot without pinning the armor piece

**Status (2026-10-15): COMPLETE.** Resolved the open design question from this entry's own
original note in favor of a third mechanism, distinct from both pinned-armor's "narrow to one
synthesized candidate" trick (TODO #7) and pinned-cuffs' "fold into row bounds" trick: a decoration
's placement already has no model-level coupling to which candidate fills the slot beyond the
shared per-slot capacity row, so a pinned decoration is modeled as a real column whose matching
decoration-count column is forced to exactly 1, while the slot's own candidate and every other
decoration stay fully solver-chosen. This turned out to need no new ILP machinery at all beyond
bound-fixing one existing column.

- `ilp-model.ts`'s `buildModel` gained `options.pinnedSlotDecorations` (keyed by `slotId`, a flat
  decoration list with duplicates allowed for multiple copies -- same convention as `pinnedCuffs`).
  Per slot, groups the flat list into id -> total count; when generating each decoration's one-hot
  count columns, raises `maxCount` to at least the pinned count (even past what any candidate's
  real capacity allows, so an unfittable pin still gets a column for `capacityRow` to correctly
  reject rather than silently vanishing) and fixes the matching count column's `colLower` to 1.
  `slotDecorationGroups` also now force-includes a pinned decoration even when it wouldn't
  naturally pass the slot's own capacity-fit filter, for the same reason.
- `types.ts`'s `SearchOptions` gained `pinnedSlotDecorations?: ReadonlyMap<string, readonly
  Decoration[]>`.
- `engine.ts`'s `search()`: pinned slot decorations are unioned into the relevant-decorations pool
  *after* `filterRelevantDecorations` runs, not before -- a pinned decoration must reach the solver
  even if it contributes to no requested skill (the player might pin one purely for its own sake).
- `build-query.ts`: `QueryFormState` gained `pinnedSlotDecorationIds: ReadonlyMap<string, readonly
  string[]>`; new `resolvePinnedSlotDecorations()` resolves ids to full `NamedDecoration` data
  (dropping unresolvable ids, same fail-soft convention as `resolvePinnedCuffs`) and skips any slot
  that's also present in `pinnedArmor` (mutual exclusivity -- a piece pin's own decorations already
  cover that slot). `BuiltQuery`/`buildSearchQuery` carry the resolved map through.
- `pinned-armor.ts`'s `computePinnedSkillTotals` gained an optional 4th parameter so the live
  "Pinned skill totals" preview in `ArmorPicker.tsx` also reflects slot-only decoration pins.
- `ArmorPicker.tsx`: new `SlotDecorationOnlyPicker` sub-component, shown only when a slot has no
  full piece pin (alongside the existing piece search, not replacing it) -- a type-to-filter
  decoration search bounded by the *largest* open-slot count any candidate for that slot could
  offer (not a specific candidate's, since none is chosen yet; a looser bound than the real
  eventual capacity, so the solver itself is what ultimately rejects an unfittable pin, not this
  UI). `ArmorPicker`'s own `setPin` now also clears a slot's decoration-only pin whenever a full
  piece pin is set for the same slot, enforcing mutual exclusivity from the UI side too.
- `App.tsx`/`ResultPage.tsx`/`shared-state.ts`: new `pinnedSlotDecorationIds` state/field threaded
  through `AppInitialState`, `QueryFormState`, and `SharedSearchState` (wire key `psd`) the same way
  every other pinning mechanism already is -- shareable links and "use as a base" both carry it
  (though a solved result's "use as a base" still re-pins every slot as a full piece pin via
  `pinnedArmorFromResult`, same pre-existing behavior, not something this TODO changes).
- Verification: new tests in `ilp-model.test.ts` (4 cases: candidate stays solver-chosen, multiple
  copies via duplicate list entries, infeasible when unfittable, doesn't affect other slots),
  `engine.test.ts` (2 cases, including surviving `filterRelevantDecorations` for an
  otherwise-irrelevant decoration), `build-query.test.ts` (`resolvePinnedSlotDecorations`, 4 cases),
  `pinned-armor.test.ts` (2 cases), and `ArmorPicker.test.tsx` (6 cases, including the mutual-
  exclusivity UI behavior). `tsc -b` clean, full frontend suite (248 tests total) and oxlint clean.
  Live-browser end-to-end: pinned "Attack 1 Deco" into the head slot with no piece chosen, ran a
  real search, and confirmed the result picked a real candidate ("Aura GS Head") with the forced
  decoration correctly attached ("Aura GS Head + Attack 1 Deco").

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

## 15. Shareable link reconstruction isn't reliably showing the same build

**Status: COMPLETE and verified (2026-10-15).** User report: "the build it shows is not
consistent" -- opening a shared link doesn't reliably reproduce the exact build that was shared.

- By design (TODO #9's "Implementation" above), a shared link does NOT encode the solved
  `BuildResult` itself -- it encodes the *query* (requirements, exclusions, pinned armor/cuffs/weapon)
  plus a `resultIndex`, and `ResultPage.tsx` re-runs the real solver against that query, collecting
  streamed results until `resultIndex` is reached. The known, already-documented trade-off for this
  approach: "a link can resolve to a different result (or none) if the data bundle changes
  significantly between sharing and opening" (`shared-state.ts`'s own docstring). That alone doesn't
  explain inconsistency within a single, unchanged data bundle -- worth confirming whether that's
  actually what the user is seeing (e.g. after a `frontend/public/data/*.json` re-export, like the
  one this same session did for the decoration-category work) or something else.
- A second, more concerning candidate: solver non-determinism. If the ILP solver (`ilp-model.ts`/
  `engine.ts`) can return a *different* optimal solution for the exact same inputs across separate
  runs (e.g. due to tie-breaking order depending on `Map`/object iteration order, or any
  non-reproducible randomness), then re-running the solver to reconstruct "the result at
  `resultIndex`" would be fundamentally unreliable even with an unchanged data bundle and an
  unchanged query -- the same link could show a different build than the one originally shared, or
  even than the one shown moments earlier on the same machine. This would need to be ruled in/out
  first, since it'd affect more than just sharing (e.g. would also mean the *live* search's own
  result list isn't stable across re-searches with identical inputs).
### Investigation (2026-10-15)

- **Solver non-determinism, tested directly against the real data bundle: did NOT reproduce.** Ran
  `engine.ts`'s `search()` twice back-to-back against the exact real, user-supplied 17-skill
  "exceptionally tight sword-build" query already on file in
  `engine.real-data.performance.test.ts` as the one query known to sometimes need the per-round time
  box's retry (`TIME_BOX_SECONDS` / `MAX_TIME_BOX_ATTEMPTS` in `engine.ts`) -- the single most
  plausible non-determinism source, since that time box is wall-clock-based (`mipInterrupt`'s
  `running_time`), so if a round is ever genuinely interrupted before reaching a proven-optimal
  answer, the "best incumbent so far" it returns could in principle depend on exactly how much of
  the search tree got explored before the wall-clock cutoff -- different machine load, different
  run. Both runs (a disposable scratch test, not committed) finished in ~30s each (no retry needed
  this time) and returned **byte-identical** results: same 5 armor picks and the same decoration
  ids in every slot. This doesn't rule out non-determinism in the rarer case where a round actually
  hits the time box and returns a merely-feasible (not proven-optimal) incumbent -- that specific
  case wasn't forced or observed directly, since this query happened not to need the box's retry on
  either run -- but it does mean "the solver just disagrees with itself sometimes" isn't a
  reflexive, easy-to-trigger bug; it would have to be narrowly confined to that one edge case.
- **The far more likely real explanation, given today's own session history: the already-documented
  data-bundle-change trade-off.** This very session re-exported the full data bundle and changed
  default category exclusions multiple times today alone -- the decoration-category taxonomy
  rebuild ([[project_decoration_category_taxonomy]]), Tower Gems going from togglable to
  unconditionally excluded, and Lottery Hiden Decorations becoming newly default-excluded. A link
  shared before any of today's changes and opened after would very plausibly resolve to a different
  build: not because the solver disagreed with itself, but because `ResultPage.tsx` reconstructs a
  link's `excludedWeaponZenithSkillIds` (and would, by the same logic, reconstruct any other
  "app's own default" field) from *today's* defaults when the link didn't pin one explicitly, and
  separately resolves `pinnedArmor`/`pinnedCuffIds`/`pinnedSlotDecorationIds` against *today's*
  catalog ids and `buildSearchQuery` against *today's* candidate/decoration pools -- all of which
  shifted today. `shared-state.ts`'s own docstring already names this exact trade-off; this session's
  own activity is a concrete, textbook case of it, not a hypothetical. This reframes the report: not
  a new bug to fix, but the known trade-off actually firing, on a day with unusually heavy bundle
  churn.
- Asked the project owner directly whether the inconsistency was across a bundle rebuild (e.g. a
  link from before today's decoration-category rebuild vs. opened after) or within one unchanged
  session. **Answer: within one unchanged session** -- ruling out the data-bundle-change explanation
  above as the actual cause the owner hit, even though it remains a real, separately-documented risk
  of the old query-and-`resultIndex` design. With the bundle-drift theory ruled out and the solver
  non-determinism theory unconfirmed either way (see above), the owner chose to fix the design itself
  rather than chase down which exact edge case was firing: **encode the solved `BuildResult`
  directly in the link**, so a link's display can never again depend on anything that might have
  changed since it was shared -- not the bundle, not today's default exclusions, not a re-solve's
  own timing.

### Implementation (2026-10-15)

- `frontend/src/search-engine/shared-state.ts`: `SharedSearchState` no longer carries `pinnedArmor`/
  `pinnedCuffIds`/`pinnedSlotDecorationIds`/`resultIndex` -- replaced with a `result: SharedBuildResult`
  field holding everything needed to render the build with zero bundle lookups: each pick's
  `slotId`/`id`/`name`/`openSlotCount`/`grankOrLater` (the last for `active-skill-cap.ts`'s G-Rank
  piece-count bonus), each slot's placed decorations (`id`/`name`/`slotSize`), each equipped cuff
  (`id`/`name`/`skills` -- `skills` kept, unlike a pick's, since the Hiden/cuff cap exemption reads a
  cuff's own contributions directly), and the full `skillTotals` array. `requirements`/
  `zenithRequirements`/`excludedCategories`/`excludedCuffCategories`/`excludedDecorationCategories`/
  `excludedWeaponZenithSkillIds`/`weaponSlotCount`/`preferExactMatches` are all kept (cheap, small
  arrays) purely so "use as a base for a new search" can still restore the original search's own
  category filters and preferences -- not needed for display anymore, since display no longer
  re-derives anything from them.
- `frontend/src/ResultPage.tsx`: no longer imports `useSearchWorker`/`buildSearchQuery` at all --
  decodes the link, converts its embedded `SharedBuildResult` straight into a `NamedBuildResult`
  (`toNamedBuildResult`, a pure, synchronous mapping with no bundle lookup), and renders it through
  the same `ResultCard` immediately. The data bundle is still loaded, but only for `skillNames`/
  `skills`/`zenithSkills` (display names + the active-skill-cap catalog) and `weaponZenithSkillIds`
  (still needed by "use as a base"'s `pinnedWeaponExclusion`) -- never to resolve a pick/decoration/
  cuff id against the live catalog. `category` is left as an empty placeholder string on every
  reconstructed pick/decoration/cuff (confirmed unread anywhere on this display path, including
  `determineActiveSkills`, which only reads `grankOrLater`), avoiding the need to carry a field
  nothing here actually uses. The `reconstructStatus`/"not found"/solver-error states are gone
  entirely -- there's no re-solve left to fail; only `decodeStatus` (`loading`/`found`/
  `invalid-link`) remains.
- `frontend/src/App.tsx`'s `buildShareUrl` now reads the actual `NamedBuildResult` straight out of
  its own `results[resultIndex]` state (already held in memory from the live search that produced
  it) and serializes it directly, instead of encoding `resultIndex` for the result page to later
  re-derive.
- Verification: `shared-state.test.ts` rewritten for the new shape (full round-trip, a
  null-`openSlotCount`-and-empty-decorations/cuffs edge case, every existing malformed-input/
  URL-safety/compression-size test kept), `ResultPage.test.tsx` rewritten (no more worker mock at
  all -- a decoded link renders synchronously with nothing to stream), `App.test.tsx`'s shareable-link
  test updated to assert the embedded `result.picks` round-trips instead of a `resultIndex`,
  `AppRoot.test.tsx`'s fixture updated to the new shape. Full suite: 251/251 tests pass, `tsc -b
  --force` and `oxlint` both clean. Live-browser-verified end to end: ran a real search, grabbed its
  "Get shareable link" URL, opened it in a second tab, and confirmed the shared page rendered the
  *exact* same build (same 5 armor picks, same skill totals down to the exact point values) with no
  console errors and no visible load/re-solve delay -- then clicked "Use as a base for a new search"
  and confirmed all 5 armor slots came back correctly pinned on the main search page from the link's
  own embedded data, with the original skill requirement ("Attack") still present.

## 16. Separate Zenith skills from regular skills in result cards

**Status: COMPLETE and verified (2026-10-15).** User ask: split Zenith skills out from regular
skills in the result-card display, rather than showing them mixed together in one list.

- Confirmed root cause: `frontend/src/search-engine/load-bundle.ts`'s `skillNames` is a single flat
  `Map<number, string>` built from `[...skills, ...zenithSkills]` combined -- every regular and
  Zenith skill name lookup goes through the same map. `ResultCard` (`components/ResultsList.tsx`)
  renders `result.skillTotals` (also one flat `Map<number, points>`) as a single comma-joined line
  (`{name}: {points}`, optionally `(disabled)`), with no distinction between a regular skill
  contribution and a Zenith one.
- **Implementation chose catalog membership over the id-offset threshold**: rather than a
  `skillId >= 1_000_000` numeric check, `ResultCard` builds `zenithSkillIds = new Set(zenithSkills.map(s
  => s.id))` from its existing `zenithSkills` prop and partitions `[...result.skillTotals.entries()]`
  into `regularSkillEntries`/`zenithSkillEntries` by membership in that set -- the same convention
  `active-skill-cap.ts`'s `determineActiveSkills` already uses to tell normal and Zenith skill ids
  apart, rather than introducing a second, parallel magic-number check that could drift from it.
- Presentation: mirrors the existing conditional "Cuffs: ..." line pattern already in this
  component. Regular skills keep rendering on their existing plain `<div>` line (unlabeled, as
  before); a second `<div>` with a bold "Zenith skills:" label renders only when
  `zenithSkillEntries.length > 0`, immediately below it.
- Touched only `ResultCard` in `components/ResultsList.tsx` and its tests, as expected --
  `skillTotals` itself, `determineActiveSkills`, and the solver are unchanged.
- Verification: 2 new `ResultsList.test.tsx` cases (Zenith skills render under their own heading,
  separate from regular skills; nothing Zenith-related renders when the build has none) pass, all
  13 tests in that file green. `tsc -b --force` and `oxlint` both clean. Full frontend suite:
  251/251 tests pass. Live-browser-verified: added "Attack" as a regular skill requirement and
  "Skill Slots Up" as a Zenith one, ran a real search, and confirmed every result card rendered
  the regular skill totals (`Attack: 11, ...`) on one line with a separate `Zenith skills: Skill
  Slots Up: 1` line beneath it; no console errors.

## 17. Blademaster/Gunner Hunter Type exclusivity

**Status: COMPLETE and verified (2026-10-15).** The project owner: "there needs to be a distinction
made between blade master pieces and gunner pieces. They can't just be mixed and matched." In-game,
Hunter Type is fixed by weapon choice (a Blademaster weapon vs. a Gunner one), not a per-piece trait
the solver gets to decide freely -- a build can use Blademaster-restricted and Gunner-restricted
armor together only if it never equips one of each at once, which until now this engine had no
concept of at all.

- Investigated the raw data directly: `equip.js` rows carry a `TYPE` field (raw index 2, values
  `0`=Common/`1`=Blademaster/`2`=Gunner) already documented in `data-format-notes.md`'s column-layout
  table but never parsed before. Confirmed via direct inspection of the real cached data: head
  pieces are ~100% Common (1 Type=2 outlier among 12947); body/arm/waist/leg pieces split roughly
  evenly Blademaster/Gunner (~6200-6240 / ~5650-5670 each) with a small Common minority (~300-360
  each); the `deco` bucket (decorations+cuffs) has a small minority too (18 Gunner, 1 Blademaster, of
  6040) but is out of scope here (decorations/cuffs aren't restricted by Hunter Type in-game).
- **Chosen fix: a required pre-solve filter, not a new ILP constraint.** Modeling "no mixing" as a
  true cross-slot disjunctive constraint inside the solver (`ilp-model.ts`) would need new binary
  decision variables threaded through `Candidate`/`buildModel` for what's otherwise a UI-level
  concept the solver's core types know nothing about. Since Hunter Type is a single choice the
  player already makes via their weapon (outside this tool's scope, same as the weapon's own
  identity), filtering candidates by it *before* the solve -- same architecture as the existing
  gear-level/cuff-category/decoration-category filters in `build-query.ts` -- is both simpler and
  more faithful to the actual game mechanic than optimizing over it.
- `etl/src/etl/parse/equipment.py`: new `HunterType` literal (`db/models.py`), `_parse_hunter_type`
  (raw TYPE code -> `HunterType`, defaulting to `"common"`), `ParsedEquipmentRow.hunter_type`.
  `equipment.hunter_type` column (schema.sql, `NOT NULL DEFAULT 'common'`, CHECK-constrained) set
  directly from the parsed row in `pipeline.py`'s `load_equipment` (no resolution step needed, unlike
  the Exotic grant). `export.py`'s `_export_equipment` gained `hunterType`.
- `load-bundle.ts`: new exported `HunterType` type; `NamedCandidate` gained `hunterType: HunterType`.
- `build-query.ts`: new `HunterTypeFilter = 'blademaster' | 'gunner'` (no third "either" option --
  there's no legitimate in-game state that isn't one or the other), new
  `slotsAfterHunterTypeFilter(slots, hunterTypeFilter)` (drops every candidate whose `hunterType` is
  the *opposite* restricted type; a `"common"` piece is never filtered), wired into
  `buildSearchQuery` between the gear-level category filter and pinning (a pinned slot still
  overrides it entirely, same precedent as the existing category filter). The synthesized weapon
  slot and pinned-slot candidates both carry `hunterType: 'common'` (a weapon/its Zenith skill has no
  Hunter Type restriction of its own).
- `App.tsx`: new required `hunterTypeFilter` state (default `'blademaster'`, arbitrary but needing
  *some* default since this is a required choice, not an optional filter), new "Hunter type" `<select>`
  in the existing "Weapon" disclosure section (thematically paired with the weapon controls, since
  in-game your weapon determines it), threaded into `AppInitialState`/`QueryFormState`.
- `shared-state.ts`'s `SharedSearchState` gained `hunterTypeFilter` (carried for "use as a base for a
  new search" reconstruction, same as `weaponSlotCount` -- not needed to *display* an already-solved
  result, only to resume the same search).
- Verification: new `build-query.test.ts` cases (`slotsAfterHunterTypeFilter` keeps common pieces
  plus only the matching type, for both values; `buildSearchQuery` end-to-end drops the opposing
  type's candidates from a slot's solver pool). ETL: new `test_load_equipment_persists_hunter_type`
  (real fixture rows "Steno GS Vest・Peach" = Gunner, "Steno HS Mail・Blue" = Blademaster, already
  present in `equip_sample.js` -- discovered rather than added, avoiding another `equipment_count`
  bump) plus two parse-layer tests (`test_parses_hunter_type_restriction` against the real
  "Hunter's Mail"/"Hunter's Vest" rows, `test_hunter_type_defaults_to_common`). Full ETL suite:
  293/293 tests pass, ruff clean. Real DB rebuilt a second time alongside TODO #3's follow-up above
  (same rebuild picked up both new columns at once); bundle re-exported and confirmed directly:
  Barioth arm pieces show `"hunterType": "blademaster"`, Barioth Guard (head) coexists with a
  `"gunner"`-typed Barioth piece, and the real dataset's `hunterType` distribution across all
  exported equipment (22650 gunner / 24944 blademaster / 14223 common) matches the raw-data
  investigation above.

## 18. Persist search form inputs across page reloads

**Status: COMPLETE and verified (2026-10-15).** The project owner asked how difficult it would be
to cache search queries in the browser so refreshing the page doesn't reset selected skills, etc.

- Low-to-medium difficulty in practice: `App.tsx`'s form state was already the same shape as
  `AppInitialState` (the type "use as a base for a new search" -- TODO #9 -- already hands back in),
  so this mostly reused that shape and `shared-state.ts`'s existing `Set`/`Map` -> JSON-safe-array
  conversion pattern, rather than inventing a new one.
- New `search-engine/search-form-state.ts`: a thin JSON-safe mirror of `AppInitialState` (`Set`/`Map`
  fields as plain arrays, same reasoning `shared-state.ts`'s `WireFormat` already established, though
  without that module's compression/short-key concerns -- this never leaves the browser, so there's
  no URL-length budget to economize for). `loadSearchFormState`/`saveSearchFormState` wrap
  `localStorage` access in `try`/`catch` (private browsing, exhausted quota, or disabled storage all
  throw rather than just no-op) and fail soft to `null`/silently-do-nothing respectively -- same
  "losing this is never worth surfacing as an error" reasoning as every other fail-soft convention in
  this codebase (`resolvePinnedCuffs`'s dropped ids, `shared-state.ts`'s `fromWireFormat`).
- **Only persists search inputs, never results** -- same scope `AppInitialState` already has. Saved
  via one `useEffect` in `App.tsx` depending on every relevant piece of state, so any change (adding a
  skill, flipping a category checkbox, pinning armor, changing Hunter Type) re-saves the full
  snapshot immediately, no debounce needed (the write is small and cheap).
- Each `useState` initializer now falls back `initialState?.field ?? persisted?.field ?? DEFAULT` --
  an explicit seed (shared-link reconstruction or "use as a base") always wins over merely-persisted
  state from a previous session, never the other way around.
- `excludedWeaponZenithSkillIds` persists the raw, possibly-`null` state itself, not the
  bundle-resolved `effectiveExcludedWeaponZenithSkillIds` -- saving the resolved default as if the
  user had explicitly chosen it would freeze in today's Zenith-skill catalog, permanently losing the
  "untouched, defer to whatever the default turns out to be" meaning `null` carries.
- `test/setup.ts` gained a global `afterEach(() => localStorage.clear())` -- without it, one test's
  saved form state would leak into the next test's fresh `<App />` mount, since jsdom's
  `localStorage` otherwise persists across tests within a run.
- Verification: new `search-form-state.test.ts` (7 cases: round-trips every field, round-trips a
  non-null `excludedWeaponZenithSkillIds`, returns `null` for nothing-saved/malformed JSON/missing
  fields/an invalid `hunterTypeFilter` value). `tsc -b` and `oxlint` both clean. Full suite excluding
  the known-flaky real-data performance test: 262/262 pass. Live-browser-verified: set "Hunter type"
  to Gunner and added an "Ice Attack" skill requirement, confirmed `localStorage` held the expected
  JSON snapshot, reloaded the page, and confirmed both were restored exactly.

## 19. Search-page layout rework: columns, searchable skills, modern form controls

**Status: COMPLETE and verified (2026-10-15).** The project owner: divide the search page into
columns (skill-related things on the left, gear-related in the middle, other things on the right),
give the skill picker a real search field, clean up the dropdowns, and add breathing room between
elements.

- **Three-column layout** (`App.tsx`/`index.css`'s new `.app-columns`/`.app-column`): left holds
  Skills + Zenith skills, middle holds Pin specific armor / Gear levels / Poogie cuffs / Decorations
  / Pin specific cuffs, right holds Weapon. The middle column gets extra width
  (`grid-template-columns: 1fr 1.3fr 1fr`) since it holds the most/densest sections. Collapses to one
  column below 860px rather than squeezing three narrow columns onto a phone-width viewport. Replaces
  the old single `.app-section-stack` -- inter-card spacing is now each column's own flex `gap`
  instead of a `.disclosure + .disclosure` sibling margin, so there's one place controlling it, not
  two that could silently double up.
- **Searchable skill picker** (`SkillPicker.tsx`): the old flat `<select>` "add a skill" dropdown
  (bad for finding one skill in a ~194-entry list) is now a live-filtered, always-grouped list -- a
  text input narrows a scrollable, category-grouped button list as you type, with the full catalog
  shown by default (not gated behind a minimum-character count like ArmorPicker/CuffPicker's own
  `FilterableOptions`, since this catalog is small enough to render in full; `groupByCategory`'s
  existing grouping stays intact as visible headings). Picking a skill clears the search text and
  re-shows the full list, so adding several skills in a row doesn't need re-typing anything.
- **Form-control restyling uncovered a real bug, not just a cosmetic one**: investigating "the
  dropdowns still look a little weird" found that `frontend/src/vendor/bootstrap/` was vendoring
  **Bootstrap 6.0.0-alpha.1** (confirmed via its JS bundle's own header comment), which is missing
  `.btn-primary`, `.btn-outline-*`, `.form-select`, `.form-check-input`, `.form-check-label`,
  `.btn-close-white`, `.text-bg-secondary`, `.text-muted`, and more -- every one of those had been
  rendering as a bare unstyled native element or with no component styling at all, this whole
  project. Asked the project owner how to handle it (downgrade to stable Bootstrap, patch the alpha's
  gaps with custom CSS, or defer); chose to downgrade. Added `bootstrap@^5.3.8` as a real npm
  dependency, switched `main.tsx` to `import 'bootstrap/dist/css/bootstrap.min.css'` from
  `node_modules`, and deleted `frontend/src/vendor/bootstrap/` entirely (its JS bundle was never
  imported anywhere in the app to begin with -- confirmed via a repo-wide search for `data-bs-*`
  attributes and any import of it, finding none -- so nothing besides the CSS was ever actually used).
- **Modernized form controls** (`index.css`): `.form-select`/`.form-control` get this page's own
  border/background/accent tokens instead of Bootstrap's defaults, with an explicit `appearance:
  none` + hand-drawn SVG chevron (light/dark variants, since a data-URI can't reference a CSS custom
  property) -- needed explicitly once real Bootstrap was in place, since nothing can be assumed to
  inherit correctly without checking. `.form-check-input` picks up `accent-color: var(--accent)`.
  `.btn-primary` is re-themed from Bootstrap's default blue to this page's own purple accent by
  overriding its own Bootstrap-5.3-style component custom properties (`--bs-btn-bg` etc.) rather than
  hand-rewriting the whole rule, so hover/active/disabled states keep working automatically.
- **A real Bootstrap also exposed a second latent bug**: its Reboot CSS sets an opaque `background-
  color` directly on `<body>`, which painted over `:root`'s own dark-mode background (previously
  invisible since the broken alpha build never applied that rule at all). Fixed by setting
  `background`/`color` explicitly on `body` in `index.css`, which wins on the same-specificity tie
  since this project's own stylesheet loads after Bootstrap's.
- **Padding**: `.disclosure-body-inner`'s open-state bottom padding increased slightly (18px ->
  20px, plus a new 14px top padding); a new `.app-field-group` class (gap-based, not margin-utility-
  based) gives the Weapon section's three sub-blocks (Hunter type / Zenith-skill checklist / slot
  count) consistent spacing without fighting Bootstrap's own `.mt-*`/`.mb-*` utility classes already
  sprinkled through other components' markup (equal-specificity rules are decided by source order,
  and a blanket spacing rule would have silently overridden those elsewhere).
- **Not attempted this pass**: a minor pre-existing (unrelated to this rework) `FilterableOptions.tsx`
  quirk noticed while verifying live -- its matches `<select size={Math.min(shown.length, 8)}>`
  collapses to a normal closed dropdown when exactly one match exists, instead of an open listbox
  like 2+ matches get -- spun off as a separate follow-up task rather than fixed inline here, since
  it's an existing ArmorPicker/CuffPicker behavior this pass didn't touch.
- Verification: `SkillPicker.test.tsx` rewritten for the new interaction model (role changes from
  `combobox`/`option` to `textbox`/`button`, plus 3 new tests: narrows results while typing, shows a
  "No matches" message, clears search text after adding) -- 16/16 pass. `App.test.tsx`'s ~16
  `selectOptions`-based "add a skill"/"add a Zenith skill" interactions mechanically updated to
  `click` the skill's button instead -- 18/18 pass. Full suite excluding the known-flaky real-data
  performance test: 265/265 pass. `tsc -b`, `oxlint`, and `prettier --check` on every file this pass
  touched all clean (pre-existing drift in ~16 untouched files, confirmed unrelated -- not introduced
  by this work). `vite build` production build succeeds (236 KB CSS, 32.7 KB gzipped, real Bootstrap
  now bundled in full rather than a broken partial one). Live-browser-verified in both light and dark
  color schemes: 3-column layout renders correctly and collapses to one column at a narrow width;
  dropdowns show one correctly-colored chevron each (no more tiled/broken background-image); the
  "Search" button and checkbox checkmarks render in the page's own purple accent instead of
  Bootstrap's default blue; the skill search field live-narrows results by category as typed,
  clicking a result adds it and clears the field, and typing "attack" correctly narrowed to exactly
  "Attack Skills" category members.

## 20. At most one Hiden cuff equipped at once

**Status: COMPLETE and verified (2026-10-16).** The project owner noticed the solver could equip two
Hiden cuffs from two different weapon-type technique trees in the same result (e.g. an `SnS・` cuff
plus a `GS・` cuff together) -- impossible in-game, since Hiden cuffs are per-weapon-type techniques
tied to the one weapon actually in use. Confirmed against the real dataset before fixing: a forced
search for both "SnS Tech" and "GS Tech" returned `SnS・S. Assault` + `GS・Strong Attack` equipped
simultaneously. Confirmed by the project owner: the rule is simply "at most 1 Hiden cuff total,
regardless of weapon type," and since every Hiden cuff costs 0 Poogie-slot capacity
(`CUFF_SLOT_BUDGET`), the existing slot-budget math is untouched by this.

- `types.ts`'s `Cuff` (previously `type Cuff = Decoration`) is now its own interface with an optional
  `category?: string` field -- optional so every existing test fixture/`pinnedCuffs` caller that
  doesn't care about Hiden-ness keeps compiling unchanged (a `Decoration` without `category` still
  structurally satisfies `Cuff`). Added `HIDEN_CUFF_CATEGORY = 'cuff_hiden'`, reused by
  `cuff-categories.ts`'s own UI category tree instead of a second hardcoded literal.
- `ilp-model.ts`'s `buildModel` gets a third global cuff row (`cuffHidenCountRow`, alongside the
  existing `cuffBudgetRow`/`cuffCountRow`), capped at `MAX_EQUIPPED_HIDEN_CUFFS = 1` minus however many
  Hiden cuffs are already pinned (same "pin reduces the free-pool budget" pattern the other two cuff
  rows already use) -- every Hiden-category cuff column feeds this row with its own `count`, every
  non-Hiden cuff column doesn't touch it at all, so the rule only ever constrains Hiden cuffs against
  each other, never against a non-Hiden one.
- A pinned Hiden cuff isn't itself blocked from coexisting with a second pinned Hiden cuff (pins are
  unconditionally accepted everywhere else in this codebase too -- out of scope here, same as every
  other "a pin always wins" exemption).
- Verification: 3 new `ilp-model.test.ts` cases (rejects two free Hiden cuffs even though the general
  item-count/budget rules alone would allow both; allows one Hiden cuff alongside one non-Hiden cuff;
  blocks the free pool from adding a second Hiden cuff once one is already pinned) pass alongside all
  46 existing cases in that file. Re-ran the original real-dataset repro end-to-end after the fix
  (scratch test, not committed): across 5 distinct ranked results for the same "SnS Tech + GS Tech"
  query, never more than one Hiden-category cuff appears in any single result -- the solver instead
  either uses one Hiden cuff that happens to grant both skills at once (several real cuffs do, e.g.
  `GS・Charge Up`) or reaches the second skill through armor/decorations, both legitimate in-game.
  `tsc -b` and `oxlint` clean.

## 21. Exclude specific equipment by id

**Status: COMPLETE and verified (2026-10-16).** The project owner: add a section under the armor
column letting the player permanently rule out specific armor pieces, decorations, or cuffs by name
(one search field each) -- a stronger, per-item version of the existing category filters, for gear
the player simply doesn't own or never wants suggested. If an excluded item is also pinned, the pin
wins and it stays usable in that one spot; excluding a decoration that's pinned into a slot (e.g. an
"Ice Atk G" gem) still leaves that specific pinned copy in place, it just can't be freely added
anywhere else by the solver.

- `build-query.ts`: new `QueryFormState` fields `excludedArmorIds`/`excludedDecorationIds`/
  `excludedCuffIds` (`ReadonlySet<string>`), and three new filter functions
  (`slotsAfterExcludedIds`/`decorationsAfterExcludedIds`/`cuffsAfterExcludedIds`) mirroring the
  existing category-filter functions' shape. `buildSearchQuery` applies armor/cuff id-exclusion in the
  same filter chain as the category filters, strictly before `slotsAfterPinning`/`resolvePinnedCuffs`
  -- `slotsAfterPinning` already resolves a pin against the *unfiltered* bundle regardless of any
  upstream filtering, so "pin wins over exclusion" falls out for free, the same mechanism that already
  makes a pin override the category/Hunter-Type filters. Decorations needed one extra wrinkle: the
  category-filtered-but-not-id-excluded decoration list (`pinnableDecorations`, a local in
  `buildSearchQuery`) is what `slotsAfterPinning`/`resolvePinnedSlotDecorations` resolve pins against,
  while the solver's own free pool additionally gets the id-exclusion filter -- otherwise an excluded
  decoration pinned into a slot would silently disappear from that pin too (its own id would fail to
  resolve in the filtered list `slotsAfterPinning`'s `decorationsById` is built from). Cuffs don't need
  this care: `resolvePinnedCuffs` already reads straight from the unfiltered bundle, so a pinned cuff
  was already structurally exempt from every pool-level cuff filter, id-exclusion included.
- `EquipmentExclusionPicker.tsx` (new): three independent `FilterableOptions`-backed search fields
  (Armor/Decorations/Cuffs, reusing the same type-to-filter convention `ArmorPicker`/`CuffPicker`
  already use for these same large catalogs), each with its own excluded-ids chip list (`badge` +
  `btn-close`, same convention as a pinned piece's decoration badges).
- `App.tsx`: new `excludedArmorIds`/`excludedDecorationIds`/`excludedCuffIds` state (empty `Set` by
  default -- no "obviously should start excluded" set exists for by-id exclusions, unlike the
  category defaults), threaded through `AppInitialState`, `QueryFormState`, the localStorage
  persistence effect (`search-form-state.ts`), and the shared-link wire format (`shared-state.ts`,
  short keys `eai`/`edi`/`eci`) so "use as a base for a new search" restores them too. Rendered as a
  new "Exclude specific equipment" `Disclosure` at the bottom of the middle (gear-related) column,
  after "Pin specific cuffs".
- Verification: new `build-query.test.ts` cases for all three filter functions plus 6 `buildSearchQuery`
  integration cases (drops an excluded armor piece/decoration/cuff from the solver's free pool; still
  pins an excluded armor piece into its slot; still bakes an excluded decoration into a piece pin or a
  decoration-only slot pin; still resolves a pinned-but-excluded cuff) -- 23/23 pass in that file.
  `search-form-state.test.ts`/`shared-state.test.ts` round-trip tests extended with the three new
  fields. `tsc -b` and `oxlint` clean across the whole frontend.

## 22. Default a newly-added skill to its highest tier

**Status (2026-10-18): COMPLETE.** `SkillPicker.tsx`'s `defaultMinPoints` now picks the *strongest*
positive tier (the first non-negative entry in `tiers`, confirmed pre-sorted highest-threshold-first
against the real `skills.json`, e.g. Attack's `[80, 50, 25, 15, 10]`) instead of the weakest, falling
back to `tiers[0]` the same way when every tier is a penalty. Applies identically to both `SkillPicker`
instances (normal and Zenith skills) since they share the same component and function, with no stated
reason they'd want to differ.

Verified: `SkillPicker.test.tsx`'s tier-default test updated to expect the strongest tier
(`Vampirism+2`/20, not `Vampirism+1`/10); live-verified against the real dataset -- adding "Gather"
now defaults to "Gathering+2" (15) rather than "Gathering+1" (10).

## 23. Enter-to-add in the skill search field, refocused for rapid repeated entry

**Status (2026-10-18): COMPLETE.** Enter-to-add itself already shipped as part of TODO #31's keyboard
navigation (`handleSearchKeyDown` adds whichever match is arrow-key-highlighted, defaulting to the top
one) -- that path already never loses focus, since the keydown fires on the search `<input>` itself.
The one remaining gap TODO #31 didn't cover: clicking a `.skill-add-option` button moves focus to that
button, so resuming typing needed a mouse click. Fixed with a `ref` on the search input and a
`.focus()` call added alongside `addSkill`'s existing `setSearch('')`/`setActiveIndex(0)`, covering
both the click and Enter paths uniformly.

Verified: `SkillPicker.test.tsx`'s new test asserts the search field has focus immediately after
clicking a suggestion; live-verified in the browser.

## 24. Widen the app intro/credits section

**Status (2026-10-16): COMPLETE** (fixed in the same commit that originally logged this entry --
`51df931`, "Widen the app intro for the credits text" -- this status line just wasn't updated at the
time). `.app-intro`'s `max-width` (`index.css`) was raised from `60ch` to `160ch`, wide enough that the
credits paragraph no longer wraps awkwardly at the widened desktop layout TODO #19 introduced. Verified
directly against the current codebase while triaging this doc's other "Not started" entries
(2026-10-18): confirmed the 160ch rule is still in place and matches the paragraph rendered in
`App.tsx`'s `<p className="app-intro">`.

## 25. Pin a skill or Zenith skill instead of a specific cuff

**Status (2026-10-18): COMPLETE.** The project owner: cuffs are partially random (same name, multiple
variants with different exact point values/sub-skills -- confirmed by the project owner, e.g. the
"SZ"/"PZ" Zenith cuffs' own variation), so forcing one *specific* cuff id (the existing TODO #7
pin) is often more rigid than what the player actually wants. Adds a second per-slot pin mode:
pin by the skill (or Zenith skill) a cuff grants, letting the solver pick *which* specific cuff
variant best serves the rest of the build, additive alongside the exact-cuff pin rather than
replacing it.

The three open design questions from this entry's original draft, resolved by the project owner:
1. A skill-mode cuff pin is distinct from adding that skill as a normal search requirement, exactly
   as drafted: a requirement sets a build-wide minimum from any source, while this pin specifically
   forces a **cuff slot** to be spent on that skill regardless of whether another source already
   covers the threshold.
2. For a Zenith-skill pin, the solver should freely choose whichever qualifying cuff variant best
   serves the rest of the build, not auto-pick a single "best" one up front -- this needed real
   solver modeling, not a shortcut.
3. The UI reuses the existing `CuffPicker.tsx`, with a new per-slot mode toggle rather than a
   separate control.

Implementation, bottom-up:
- **`types.ts`**: new `SearchOptions.pinnedCuffSkillIds` -- a flat list of pinned skill ids
  (duplicates allowed, same "repeats = count" convention as `pinnedCuffs`).
- **`ilp-model.ts`**: cuffs are already modeled as a shared, unordered pool (not discrete numbered
  slots), bounded only by aggregate budget/count/Hiden-count rows -- so this needed no new per-slot
  column machinery. One new row per distinct pinned skill id requires the summed equipped-count of
  cuffs granting that skill to reach however many times it was pinned (offset by any already-pinned
  exact cuff that happens to also grant it), reusing the same per-column coefficient convention
  `cuffCountRow` already uses.
- **`expand.ts`**: `filterRelevantDecorations`/`filterRelevantCuffs` gained an optional
  `extraSkillIds` parameter so a cuff relevant *only* to a pinned skill (not a search requirement)
  still reaches the solver; `engine.ts` passes `options.pinnedCuffSkillIds` through.
- **`build-query.ts`**: new `PinnedCuffSlot = {mode: 'exact'; cuffId} | {mode: 'skill'; skillId}`
  discriminated union; `QueryFormState.pinnedCuffIds: string[]` became `pinnedCuffSlots:
  PinnedCuffSlot[]`; `resolvePinnedCuffs` now returns `{pinnedCuffs, pinnedCuffSkillIds}`, splitting
  the two pin kinds apart for `buildSearchQuery` to pass to the solver separately.
- **`CuffPicker.tsx`**: each slot gained an "Exact cuff"/"By skill" toggle (only shown while nothing
  is pinned yet or "Change" was clicked); a skill-mode pin displays as "Any cuff granting X" instead
  of a resolved cuff name. Took a new `pinnableSkills` prop covering both normal and Zenith skills,
  since a cuff can grant either.
- **`search-form-state.ts`** / **`query-code.ts`**: both persistence paths updated for the renamed
  field and its new shape -- the human-readable query code represents a skill-mode pin as a
  `"Skill: <name>"`-prefixed line in the existing "Pinned cuffs" section, resolved against a combined
  skill+Zenith-skill index (`cuffSkillIndex`), distinct from a plain cuff-name line.
- **`ResultPage.tsx`**: "Use as a base for a new search" now reconstructs a shared result's own
  cuffs as exact-mode pins (a solved result names specific cuffs, never a skill).

Verified: `tsc -b` and `oxlint` clean; the full Vitest suite passes (373 tests, including new
`ilp-model.test.ts` coverage for the pinned-cuff-skill row -- rejecting with no matching free cuff,
picking the better of two matching variants under the cuff budget, requiring two distinct equipped
units when the same skill is pinned twice, and crediting an already-pinned exact cuff that also
grants the skill); a live browser pass pinned Cuff slot 1 to "Sharpness" by skill, searched for a
`Sharpening Artisan` requirement, and confirmed the solver equipped a real cuff (Incitement PC1)
that grants Sharpness to satisfy the pin, without that cuff being named anywhere in the search.

## 26. First external-feedback quick-wins batch

**Status (2026-10-16): COMPLETE.** The first 6 items picked from `docs/feedback.md`'s Round 1 (items
#5, #7, #9, #11, #17, #19), chosen for being cheap to build and high quality-of-life, per the
project owner's go-ahead after a triage pass.

- **#9 Cuff hover tooltip**: `ResultsList.tsx`'s Cuffs line now wraps each cuff name in a `title`
  built from `contributionSummary(cuff.skills, skillNames)`, matching the tooltip every other pick/
  decoration already had -- `CuffPicker.tsx` was never the gap, the result card's own cuff rendering
  was.
- **#17 Sort decorations within a result**: the per-slot decoration list in `ResultsList.tsx`'s Picks
  column now renders `[...decorations].sort((a, b) => a.name.localeCompare(b.name))` instead of the
  solver's own pick order, so duplicate decorations sit next to each other.
- **#5 Exotic skills in their own result-card tab**: `ResultCard` now computes `exoticSkillIds` from
  `result.picks`' own `exoticSkillId` field (not a catalog flag -- whether a skill is "Exotic" here
  depends on which piece granted it), splits a new `exoticSkillEntries` list out of `regularSkillEntries`
  the same way `zenithSkillEntries` already was, and renders it as its own "Exotic skills:" block,
  mirroring the existing Zenith-skills block.
- **#11 Collapsible result cards**: `ResultCard` gained a `collapsed` state and a
  `.disclosure-header`-styled toggle button (new `.result-card-toggle` CSS rule in `index.css`,
  negative-margined back to the card's own edge) above each card; `ResultsList` now passes an
  `index` prop so each toggle can show "Result N".
- **#19 Search armor pieces by skill, not just name**: `FilterableOptions.tsx` gained an optional
  `matches` prop (defaulting to the old name-substring check) so a caller can match on more than a
  name. `ArmorPicker.tsx`'s `ArmorSlotPicker` now builds a `candidateMatches` function from a new
  `skillNameById` prop (threaded down from `ArmorPicker`'s own `skills` prop) that checks a
  candidate's name *or* any of its granted skills' resolved names. Scoped to the pin search only --
  `EquipmentExclusionPicker.tsx`'s armor-exclusion search still matches on name only, left as a
  follow-up (its `Named` item type has no `skills` field to search on yet).
- **#7 Copy a result to the clipboard**: `ResultCard` gained two new buttons next to the existing
  "Download as image" -- "Copy image" (`handleCopyImage`, reusing `handleDownloadImage`'s own
  `html-to-image` rendering via `toBlob` instead of `toPng`, written via
  `navigator.clipboard.write([new ClipboardItem(...)])`) and "Copy as text" (`handleCopyText`, a new
  `buildResultText` helper that renders the same skills/picks/stats the card shows as plain lines,
  written via `navigator.clipboard.writeText`). Both silently no-op on a clipboard-permission
  rejection (nothing meaningful to show the user beyond leaving the button clickable again).

Verified: `tsc -b` and `oxlint` clean; `ArmorPicker`/`ResultsList`/`FilterableOptions`'s own Vitest
suites pass (43 tests); a live browser pass confirmed the skill-name armor search actually matches on
granted skills (not just names), the collapse toggle works per-card, and the new result-card buttons
render and wire up correctly (clipboard writes themselves could only be confirmed up to the
browser's own permission prompt, which this project's sandboxed preview browser always denies).

## 27. Second external-feedback batch: browse categories, impossible-search detection, save/load by code

**Status (2026-10-16): COMPLETE.** The "good payoff, moderate effort" items from `docs/feedback.md`'s
Round 1 triage (#2, #14, #18), per the project owner's go-ahead to continue past TODO #26's batch.

- **#2 See what's actually in a category**: `CategoryFilter.tsx` gained an optional `itemsByCategory`
  prop (`ReadonlyMap<categoryKey, items>`) -- when given, every leaf gets a "View (N)" toggle
  (new `CategoryLeaf` sub-component, its own `expanded` state) that expands a comma-joined list of
  every item's name in that category, capped at `MAX_CATEGORY_CONTENTS_SHOWN` (100, same
  cap-and-say-how-many-more convention as `FilterableOptions`' `MAX_MATCHES_SHOWN`). `App.tsx`'s new
  `groupByCategory` helper builds the three maps this needs (armor from the already-flattened
  `allArmorCandidates`, cuffs from `bundle.cuffs`, decorations from `bundle.decorations`), passed into
  the Gear levels/Poogie cuffs/Decorations `CategoryFilter` calls -- the Weapon section's Zenith-skill
  checklist is left without one, since there's no per-item catalog to browse there (it's already a
  flat list of Zenith skills, not a category of many items).
- **#14 Detect an impossible search up front**: new `search-engine/feasibility.ts`'s
  `findUnreachableRequirements` reuses `ilp-model.ts`'s own `computeAchievableRanges` (now exported,
  along with `pointsTowards`) -- the same safe *over*-estimate of each skill's reachable total that
  `buildModel` already relies on for its big-M sizing, so a requirement this flags is one the solver
  could never satisfy either, not a guess. `App.tsx`'s `handleSearch` runs this immediately after
  `buildSearchQuery` resolves the query (before ever calling `worker.search`), adding any pinned
  cuffs'/pinned-slot-decorations' fixed contribution on top of the free pool's own bound; if anything
  comes back unreachable, the search is skipped entirely and the existing error-message UI
  (`status === 'error'`) shows e.g. "This search can never succeed: Attack needs 80, but at most 69 is
  reachable. Lower the requirement, or include more equipment that grants it." Deliberately scoped to
  only what's a pure, provable consequence of the data already on hand -- *not* the Zenith-
  simultaneous-skill-count question the feedback item's own example raised (see
  `findUnreachableRequirements`'s own docstring), since that depends on confirming an actual game
  mechanic not yet modeled anywhere in this engine, the same caution TODO #16 already flagged for a
  related Zenith question. A false "unreachable" is impossible by construction; a false "reachable" is
  possible (the bound is deliberately loose) and just falls through to the solver as before.
- **#18 Save/load a query by text code**: new `search-engine/query-code.ts`'s
  `encodeQueryCode`/`decodeQueryCode`, reusing the gzip + base64url codec `shared-state.ts` already
  had (pulled out into new `codec.ts` so both modules share it instead of duplicating it) -- applied to
  `search-form-state.ts`'s existing `SearchFormState` shape (exported its internal validator as
  `validateSearchFormState` for reuse) rather than a new one, since it already carries exactly the
  search inputs this needs. Distinct from that module's own `localStorage` auto-persistence (which
  always restores just the *last* search): this lets the player keep and reuse *any number* of
  distinct searches via a pasted code, including sharing one with someone else. New "Save/load this
  query" `Disclosure` in `App.tsx` (named to avoid colliding with the existing "Search" button's own
  accessible name once both matched `/search/i` in `App.test.tsx`) with a "Get a save code" button and
  a paste-a-code-and-Load field, surfacing a decode failure inline ("That code could not be read --
  check it was copied in full.") rather than silently doing nothing.

Verified: `tsc -b` and `oxlint` clean; new `feasibility.test.ts` (7 tests) and `query-code.test.ts` (8
tests) pass, plus `CategoryFilter.test.tsx`'s 3 new `itemsByCategory` tests; full suite is 306/307
(the one failure is the same pre-existing `engine.real-data.performance.test.ts` timing flake noted in
TODO #26, unrelated to this batch). `App.test.tsx`'s fixture (`BUNDLE`) needed its "Leather Helm"
candidate given real skill contributions -- it previously granted nothing at all, which the new
feasibility check correctly (if inconveniently, for a fixture that never cared before) started
rejecting as unreachable. Live-verified in the browser against the real data bundle: the category
"View" toggles show correct real counts and contents for all three trees, a feasible search (Attack
Up (Absolute)) still finds a result normally, and excluding every gear-level category correctly
surfaces "This search can never succeed: Attack needs 80, but at most 69 is reachable" instead of a
bare empty result list. Save/load-by-code round-tripped live too: generated a code, removed the
Attack requirement, pasted the code back in, and the requirement reappeared exactly as saved; a
malformed code correctly showed the inline error instead of silently doing nothing.

## 28. Non-negative resistance floors (per element)

**Status (2026-10-16): COMPLETE.** `docs/feedback.md` Round 1 #4, the last of the "good payoff,
moderate effort" items (#2/#14/#18 done in roadmap #27) -- the project owner's go-ahead to continue
past that batch. The one item of the four that needed a real solver change rather than a UI/display
feature.

Modeled as a hard constraint, exactly like a skill-requirement row: for each element the player
checks, a new row is added with `rowLower = 0, rowUpper = +infinity`, summing that element's
resistance contribution across every chosen armor candidate. `types.ts` gained `Resistances` (the
five elements) and `ResistanceElement`; `Candidate.resistances?` is optional, following the same
"absent = no contribution" convention as `Candidate.openSlotCount?` -- decorations and cuffs never
carry resistance data (per `docs/data-format-notes.md` and `build-query.ts`'s existing
`NO_RESISTANCES` constant), so only the candidate-column loop in `ilp-model.ts`'s `buildModel` gets
entries for these rows, never the decoration or cuff loops. `load-bundle.ts`'s `NamedResistances` is
now just `export type NamedResistances = Resistances` (a type alias, not a separate interface), so
the already-existing named-candidate resistance data satisfies the new field automatically.
`SearchOptions.resistanceFloors?: readonly ResistanceFloor[]` threads through the existing options
pipeline unchanged (`App.tsx` -> `useSearchWorker` -> `worker-client.ts` -> `worker-protocol.ts` ->
`worker-handler.ts` -> `engine.ts` -> `buildModel`), since every intermediate layer was already
generic over `SearchOptions`.

New "Resistances" `Disclosure` in `App.tsx` between "Exclude specific equipment" and "Save/load this
query": five checkboxes (Fire/Water/Thunder/Ice/Dragon), each checked element becoming a
`{ element, minTotal: 0 }` entry in `resistanceFloors`. Threaded through the same three places every
other search-input field goes: `AppInitialState.nonNegativeResistances` (seed for "use as a base for
a new search", read in `ResultPage.tsx`'s `handleUseAsBase`), `SearchFormState.nonNegativeResistances`
(localStorage auto-persist and save/load-by-code reuse, `search-form-state.ts`), and
`SharedSearchState.nonNegativeResistances` (full shareable-result links, `shared-state.ts`'s wire
format as `nnr`). Deliberately not wired into `feasibility.ts`'s `findUnreachableRequirements`
(TODO #27's impossible-search pre-check) -- an infeasible resistance-floor combination just falls
through to the solver as zero results, the same acceptable scope boundary TODO #27 itself drew around
what that check does and doesn't cover.

Verified: `tsc -b` and `oxlint` clean; `ilp-model.test.ts` gained 6 new tests covering a floor
rejecting a candidate that dips an element below it, meeting a floor exactly, combining contributions
across slots, only constraining the requested element, a candidate with no `resistances` field
counting as zero, and decorations/cuffs not interfering (55/55 in that file). `App.test.tsx` gained a
test confirming checking Fire and Dragon produces the matching `resistanceFloors` entries in the
`worker.search` call (19/19 in that file). Live-verified in the browser against the real data bundle:
checked "Fire", added an Attack requirement, and the result changed (different picks, Fire resistance
9) from the same search with no resistance floor checked -- confirming the constraint actually
changes the solver's chosen build rather than being a no-op.

**Follow-up (2026-10-17), per the project owner:** two refinements, both on top of the still-unpushed
work above. First, the "Resistances" and "Save/load this query" `Disclosure`s moved from the middle
column to the right column (below "Weapon"), purely a layout change -- no behavior difference, and
`App.test.tsx` queries by role/name rather than DOM order so nothing needed updating there. Second, a
"toggle all" control: `CategoryFilter.tsx`'s own `GroupCheckbox` (the same checked/indeterminate
parent-checkbox widget its category groups already use) is now exported, with a new optional
`ariaLabel` override (defaulting to its old `${label} (all)`, used as-is by `CategoryFilter` itself)
since "Resistances"' own five leaves don't share a group label the way a category tree's do. `App.tsx`
renders one above the five element checkboxes, checked when all five are required, indeterminate when
some are, and clicking it sets the full five-element set or clears it entirely.

## 29. Hover tooltip for a piece/decoration/cuff's own skills, in every pin/exclude picker

**Status (2026-10-17): COMPLETE.** Per the project owner, while reviewing the still-unpushed work
above: "Pin specific armor"/"Pin specific cuffs"/"Exclude specific equipment" (`ArmorPicker.tsx`,
`CuffPicker.tsx`, `EquipmentExclusionPicker.tsx`) only ever showed an item's bare name while picking
it, unlike a result card's own Picks list (`ResultsList.tsx`), which has shown this as a hover tooltip
since the original cuff/decoration/armor result display work. Generalizes that same tooltip to every
other place a specific piece, decoration, or cuff is chosen by name, not just where one ends up in a
result.

`ResultsList.tsx`'s own `contributionSummary` (builds a "Skill: points, Skill: points" string from a
`SkillContribution[]` and a skill-name lookup) moved out into new, shared
`search-engine/contribution-summary.ts` rather than staying private to that one file.
`FilterableOptions.tsx` gained an optional `describe?: (item: T) => string | undefined` prop (the same
shape as its existing `matches` override), rendered as each `<option>`'s own `title` -- native
`<option title>` tooltips, no extra UI. Every caller that has a skill catalog in scope now passes
`describe={(item) => contributionSummary(item.skills, skillNameById)}`:

- `ArmorPicker.tsx` already built a `skillNameById` map for its own armor-by-skill search (TODO #26's
  #19); reused here for both the piece search and the decoration search (both the per-slot one and
  `SlotDecorationOnlyPicker`'s TODO #12 one), plus the already-chosen piece `<span>` and placed-
  decoration badges once picked.
- `CuffPicker.tsx` gained a new required `skillNameById` prop (threaded from `App.tsx` as
  `bundle.skillNames`, an existing ready-made map -- no new one needed), applied the same way to its
  search and its already-pinned cuff display.
- `EquipmentExclusionPicker.tsx`'s internal `Named` type gained an optional `skills` field (several of
  this component's three catalogs -- armor/decorations/cuffs -- already carry it; optional rather than
  required keeps the type honest about a hypothetical future catalog that doesn't), plus the same new
  `skillNameById` prop, applied to its search and its already-excluded badges.

Verified: `tsc -b` and `oxlint` clean; new tests in `ArmorPicker.test.tsx` (piece and decoration
tooltips, both in-search and once chosen), `CuffPicker.test.tsx` (cuff tooltip, in-search and once
pinned), and a new `EquipmentExclusionPicker.test.tsx` (this component had no dedicated test file
before -- both its search and its excluded-badge tooltips), plus the full suite (321/321, excluding
the same two known-flaky timing tests `engine.real-data.performance.test.ts`/
`engine.property.test.ts` noted in TODO #28's own verification). Live-verified in the browser against
the real data bundle: searching "Leather" in the head-piece pin search shows each option's own real
skill grants on hover (e.g. "Leather R Helm" -- "Attack: 5, Fate: 4, Fire Sword: 5, Quake Res: -3,
Stamina: 3").

**Follow-up (2026-10-17): keyboard-only picking in every one of these pickers.** Per the project
owner: "the main thing that I would still really like to implement is being able to use everything
through keyboard... type a skill name, enter... rather than having to... click on the result."
`ArmorPicker.tsx`, `CuffPicker.tsx`, and `EquipmentExclusionPicker.tsx` each pair a plain search
`<input>` with a `FilterableOptions`-rendered `<select>` listbox, but previously did nothing with
Enter in that input -- reaching the listbox at all needed a Tab out of the text field first. Two
shared pure functions, `firstMatch`/`handleEnterToPickFirst`, now live in a new
`components/pick-first-match.ts` (not in `FilterableOptions.tsx` itself -- oxlint's Fast-Refresh
`only-export-components` rule flags a component file exporting plain functions, the same reason
`pinned-armor.ts` already gives for keeping helpers out of its own component file). Every affected
search input's `onKeyDown` and its sibling `FilterableOptions`' `onPick` now call the same named
pick-function (`pickCandidate`/`pickSlotDecoration` in `ArmorPicker.tsx`, `pickCuff` in
`CuffPicker.tsx`, the inline `add`/`pickDecoration` in `EquipmentExclusionPicker.tsx`), so keyboard and
mouse selection can never drift apart.

Verified: `tsc -b` and `oxlint` clean; new `describe('keyboard-only picking', ...)` blocks in
`ArmorPicker.test.tsx` (pin a piece via Enter, place a decoration via Enter, no-op with no match),
`CuffPicker.test.tsx` (pin a cuff via Enter, no-op with no match), and
`EquipmentExclusionPicker.test.tsx` (exclude an item via Enter, no-op with no match); full suite
328/328 (the same two known-flaky timing tests excluded, per TODO #28). Live-verified in the browser
against the real data bundle: typing "Leather" then Enter in the head-piece pin search pinned "Leather
Helm" with no mouse click, typing "attack" then Enter in that slot's decoration search placed "Attack
1 Deco", typing "Sharpen" then Enter in cuff slot 1 pinned "Sharpening PC1", and typing "attack" then
Enter in the decoration-exclusion search excluded "Attack 1 Deco" -- all four reverted afterward to
leave the page's saved state unchanged.

## 30. Human-readable save/load query codes

**Status (2026-10-17): COMPLETE.** Per the project owner, while reviewing the save/load-by-code
feature from TODO #27: the gzip+base64url code it produced looked like gibberish -- every id (skill,
category, armor/decoration/cuff) should instead resolve to its real name, both generating a code and
reading one back in.

`query-code.ts` was rewritten from a compressed binary codec to a plain, line-based text format:
every value gets its own line, either a flat `"Label: value"` line or a `"Label:"` section header
followed by `"- value"` item lines -- never multiple values packed onto one comma-separated line.
This wasn't a style choice: checking the real data turned up armor piece names containing commas,
colons, brackets and parentheses (e.g. `"Plug Head:01"`, `"Akahara Reisou・胴: Bow Red"`,
`"Mizuha [Eboshi 】"` -- 193 of ~13,000 head pieces alone), any of which could be swallowed by an
inline delimiter. One name per line means the entire rest of a line (after a known, colon-free prefix
like an armor slot id) is always the value, nothing left to escape -- `decodeSlotNamePairs` splits on
only the *first* `": "` for exactly this reason, since the prefix vocabulary (a slot id) never
contains one.

A name that isn't unique within its own catalog (e.g. two different armor pieces sharing a display
name) is disambiguated with its own id in parentheses, e.g. `"Iron Helm (head:0002)"`, resolved back
by that id rather than by name -- the one case "real names" can't fully avoid showing an id. A real
label that already happens to contain a legitimate parenthetical (e.g. `"Standard (Unavailable)"`)
round-trips as plain text, never mistaken for the disambiguation suffix (`idFor` tries an exact label
match before the suffix pattern).

New `QueryCodeCatalog` parameter (both `encodeQueryCode` and `decodeQueryCode` now take one, alongside
the existing `SearchFormState`/code argument) carries every `{id, name}` list this module needs to
resolve: skills, Zenith skills, armor candidates, decorations, cuffs, plus the three category trees
(`GEAR_CATEGORY_GROUPS`/`CUFF_CATEGORY_GROUPS`/`DECORATION_CATEGORY_GROUPS`) -- taken as data here
rather than imported directly, even though they're static, so this module's own tests exercise the
collision/disambiguation logic against a small fixture tree instead of coupling to real production
category keys. `App.tsx` builds the real one once via `useMemo` (`queryCodeCatalog`, alongside the
existing `allArmorCandidates`) and passes it to both `handleGenerateQueryCode` and
`handleLoadQueryCode`.

Caught during live verification, not before: the "Save code for this search"/"Save code to load"
fields were still single-line `<input>` elements from TODO #27 -- a browser silently strips `\n`
characters from a single-line text input's value, which was quietly corrupting the now-multi-line code
on generation (and would have made a copy-pasted code unparseable on load, since the whole format
leans on line structure). Fixed by switching both to `<textarea>`.

Verified: `tsc -b` and `oxlint` clean; `query-code.test.ts` fully rewritten against a small fixture
`QueryCodeCatalog` (13 tests: full round-trip, the nullable-vs-empty `excludedWeaponZenithSkillIds`
distinction, an entirely empty search, name disambiguation for a collision, a legitimate parenthetical
label staying plain, an embedded colon in a name, missing/squashed blank lines between sections, and
several malformed-input cases returning `null`); full suite 326/326 (the same two known-flaky timing
tests excluded, per TODO #28/#29). Live-verified in the browser against the real data bundle: a
generated code reads as plain English (skill names, "Not Implemented"/"Standard (Unavailable)"-style
category labels, real armor piece names), and pasting it back in after removing a skill requirement
correctly restored it along with every other field, with no decode error shown.

## 31. SkillPicker: persistent count, numbered list, and keyboard navigation

**Status (2026-10-17): COMPLETE.** Per the project owner, two small `SkillPicker` usability requests:
the "N skills selected" count line used to only exist inside the search dropdown's own header and
disappeared once that section collapsed, and the requirements list had no running index ("it would be
great to type a skill name, enter, type a skill name, enter" also motivated the keyboard work below).

- Moved the count to a persistent line above the requirements list itself (`"No skills selected
  yet."` when empty), so it's visible regardless of whether the add-a-skill search is open.
- Each requirement row is now numbered (`1. `, `2. `, ...), with the skill name kept in its own nested
  `<span>` so existing `getByText(name)` test assertions still match exactly (numbering text lives
  outside that span).
- Added real keyboard navigation to the search dropdown: `activeIndex` state tracks a highlighted
  match across the flattened (ungrouped) match list; ArrowUp/ArrowDown wrap around; Enter adds the
  active match; typing or changing the search text resets the highlight to the first match. Mouse
  hover still works too (`onMouseEnter` sets `activeIndex` to that option's flat index), so keyboard
  and mouse stay in sync rather than being two disconnected ways to pick. `index.css` extended the
  existing hover/focus-visible highlight rule to also cover the new `.skill-add-option-active` class.

This same "type + Enter picks the top match" pattern was then generalized to every other
type-to-filter picker on the page -- see TODO #29's own follow-up note.

Verified: `tsc -b` and `oxlint` clean; 13 new `SkillPicker.test.tsx` tests (persistent count with
items selected, the empty-state message, numbering order via `getAllByRole('listitem')`, and a
keyboard-only-selection block: Enter-adds-first-match, arrow-then-Enter, wrap-around past the last
match, highlight resets when the search text changes, no-op Enter with no matches); full suite
341/341 (the same two known-flaky timing tests excluded, per TODO #28).

## 32. Exclude specific skills; "Exclude specific equipment" reworded to "Exclusions"

**Status (2026-10-18): COMPLETE.** Per the project owner: "add the ability to exclude specific
skills. You can just add that to the exclude specific equipment and maybe reword that to
exclusions." Excluding a skill drops every armor piece, decoration, or cuff that grants it from the
solver's pool entirely -- the same effect as excluding that specific item by id, just picked by what
it grants rather than by its own name. It is NOT a tweak to the skill requirements search above (it
doesn't touch `requirements`/`zenithRequirements` at all); it only narrows which equipment the
solver is allowed to consider.

`build-query.ts` gained a fourth `QueryFormState` field, `excludedSkillIds: ReadonlySet<string>`
(stringified skill ids, same convention as the other three exclusion sets), plus three new filter
functions mirroring the existing id-based ones: `slotsAfterExcludedSkills`,
`decorationsAfterExcludedSkills`, `cuffsAfterExcludedSkills` -- each drops a candidate whenever
`candidate.skills.some(s => excludedSkillIds.has(String(s.skillId)))`. Wired into `buildSearchQuery`
right alongside the id-based exclusion, with the same "pin always wins" ordering: applied to the
pre-pinning pool, so a piece/decoration/cuff the player explicitly pinned keeps granting its skills
even if one of them is also excluded.

`EquipmentExclusionPicker.tsx` gained a fourth `ExclusionList` ("Skills"), reusing the same generic
component unchanged -- a skill is just fed in as `{id: String(skillId), name}`. `App.tsx` builds this
list once via `useMemo` from `bundle.skills` (normal skills only; Zenith skills are only ever granted
by the weapon slot, which isn't part of this picker's candidate pools, so they're left out rather than
offered as a dead-end exclusion). The section's title changed from "Exclude specific equipment" to
"Exclusions" (`excludedEquipmentSummary` renamed to `exclusionsSummary`, now summing all four sets),
and its intro paragraph now explains the skill-exclusion effect separately from the item-exclusion
one, so it doesn't read as a shortcut for "don't count this skill."

`excludedSkillIds` was threaded through every place the other three exclusion sets already go:
`AppInitialState`, `localStorage` persistence (`search-form-state.ts`'s `SearchFormState`), shared
result links (`shared-state.ts`'s `SharedSearchState`/wire format, new `esi` key), and the
human-readable save/load codes (`query-code.ts`'s new "Excluded skills" section, resolved through the
same `skillIndex` already built for skill requirements).

Verified: `tsc -b` and `oxlint` clean; new `build-query.test.ts` tests for all three filter functions
plus two `buildSearchQuery` integration tests (drops every piece/decoration/cuff granting an excluded
skill; still pins/places one that does, since a pin always wins); new `EquipmentExclusionPicker.test.tsx`
tests (the Skills list shows a match by name, excludes it once picked via the dropdown and via
Enter-to-pick, and an already-excluded skill shows as a named badge); full suite 352/352 (the same two
known-flaky timing tests excluded, per TODO #28). Live-verified in the browser against the real data
bundle: excluding "Attack" under Skills, then requiring 10 points of Attack and searching, correctly
produced "This search can never succeed: Attack needs 10, but at most 0 is reachable" -- confirming
every Attack-granting piece, decoration, and cuff was actually dropped from the pool, not just hidden
from the exclusion list's own search.

## 33. "Pin specific armor" should only search/pin pieces from included gear-level categories

**Status (2026-10-17): COMPLETE**, implemented together with TODO #35 since both narrow the exact
same list. `App.tsx` now computes a `pinnableSlots` value (mirroring the existing `pinnableDecorations`
one) and hands that to `ArmorPicker` instead of `bundle.slots` directly:
```ts
const pinnableSlots = bundle
  ? slotsAfterHunterTypeFilter(
      slotsAfterCategoryFilter(bundle.slots, excludedCategories),
      hunterTypeFilter,
    ).map((slot) => {
      const pin = pinnedArmor.get(slot.slotId)
      if (!pin || slot.candidates.some((c) => c.id === pin.candidateId)) return slot
      const pinnedCandidate = bundle.slots
        .find((s) => s.slotId === slot.slotId)
        ?.candidates.find((c) => c.id === pin.candidateId)
      return pinnedCandidate ? { ...slot, candidates: [...slot.candidates, pinnedCandidate] } : slot
    })
  : []
```
Resolved the "what happens to an already-pinned piece whose category is excluded after the fact"
question flagged below in favor of the more consistent option: the piece search itself is scoped to
included categories (so an excluded category's pieces are never offered as *new* pins), but an
already-pinned piece is explicitly kept available in its own slot's candidate list even if it would
otherwise be filtered out -- so `ArmorPicker`'s own "already pinned here" display (name, Change/Clear
buttons) keeps working rather than silently acting as if nothing were pinned. The real search was
never at risk either way, since `slotsAfterPinning` (`build-query.ts`) always resolves an existing pin
from the unfiltered `bundle.slots`.

Verified: `App.test.tsx`'s `'"Pin specific armor" scoping'` describe block (an excluded-category piece
is absent from the piece search; a non-excluded one still appears; an already-pinned piece whose
category then gets excluded stays visible with its Clear button intact). Live-verified against the
real dataset: excluding "Premium Kit" dropped the head-slot "Helm" search's match count from 2636 to
2104.

## 34. Fold SkillPicker's own "N skills selected" line back into the Disclosure summary spot

**Status (2026-10-17): COMPLETE.** `Disclosure.tsx` now always renders its `summary` span (dropped the
`!open &&` guard, updated its own docstring), so `SkillPicker.tsx`'s own redundant `"N skills
selected"`/`"No skills selected yet."` line (added for TODO #31) was deleted entirely, along with its
two dedicated tests in `SkillPicker.test.tsx` -- `App.tsx`'s existing `skillsSummary`/
`zenithSkillsSummary` (unchanged) now does this job alone, visible in the Disclosure header whether the
section is open or closed.

Checked every other `Disclosure` user (Gear levels, Poogie cuffs, Decorations, Pin specific cuffs,
Exclusions, Weapon, Resistances) -- each summary (e.g. "2 categories of 63 excluded") reads sensibly
staying visible once open too, since none of them duplicate it elsewhere in their own body the way
`SkillPicker` did.

Verified: `Disclosure.test.tsx`'s "shows the summary only while closed" test rewritten to assert the
summary stays visible after opening; live-verified in the browser -- picking a skill updates the
"Skills" Disclosure header to "1 skill" and the body no longer shows a separate count line.

## 35. "Pin specific armor" should also only search/pin pieces legal for the current Hunter Type

**Status (2026-10-17): COMPLETE**, implemented together with TODO #33 -- see that entry for the
shared `pinnableSlots` implementation (`slotsAfterHunterTypeFilter` composed with
`slotsAfterCategoryFilter`, both from `build-query.ts`, plus the already-pinned-piece preservation).

Verified: `App.test.tsx`'s `'"Pin specific armor" scoping'` describe block covers a synthetic
Gunner-only piece disappearing from the head-slot search while Blademaster is selected, then appearing
once switched to Gunner. Live-verified against the real dataset too: the dataset's one `hunterType:
'gunner'` head piece ("Rockman Cap") is absent from the piece search under Blademaster and present
under Gunner (its own default-excluded "Training Only" category had to be temporarily re-included to
observe this, since it's otherwise filtered out by TODO #33's category scoping regardless of Hunter
Type).

## 36. SkillPicker's category order shifts around as skills get picked

**Status (2026-10-17): COMPLETE.** `SkillPicker.tsx`'s old `groupByCategory` determined each
category's position by the order its *first* skill appeared in whatever array it was given -- but it
was called on `matching` (the filtered, already-picked-removed list), not the full stable `skills`
catalog, so a category's position drifted once its first-appearing skill got picked.

Fixed by decoupling ordering from filtering: a new `categoryOrder(skills)` computes the fixed
first-seen category order once from the full, stable `skills` prop; `groupByCategory` now takes that
order as a second argument and buckets the filtered `matching` list into it, dropping any category
with zero remaining matches (a category still disappears once nothing in it is left to pick -- only
the *relative order* of whatever remains stays fixed).

Verified: a new `SkillPicker.test.tsx` test using an interleaved fixture (a category's first-listed
skill picked while a later skill of the same category remains, with another category's skill sitting
between them in catalog order) asserts the two categories' relative order survives the pick. Live
browser check: picking every skill from a multi-member category one at a time kept the next category
in its original position the whole way down, until the emptied category itself disappeared.

## 37. Rework skill exclusion to cap a skill below "active" instead of banning every piece that grants it

**Status (2026-10-17): COMPLETE.** Per the project owner, this REPLACES TODO #32's "ban every
piece/decoration/cuff that grants it" behavior outright (confirmed explicitly: "the armor decorations
and cuffs should be a full exclusion. The skills should be a different mechanism. That simply prevents
final results from having that skill active") -- same stored `excludedSkillIds`, same
`EquipmentExclusionPicker.tsx` "Skills" list and UI, only the solver-side meaning of an excluded skill
id changed. Armor/decoration/cuff id-based exclusion (and category exclusion) are untouched: those stay
a full pool-level ban exactly as before.

Implementation: `ilp-model.ts`'s `buildModel` gained one hard-constraint row per
`options.excludedActiveSkillIds` entry, the same shape as the existing `resistanceFloors` row but as a
two-sided bound (a skill with both a bonus and a penalty tier has an "inactive" zone strictly between
them) and fed by candidates, decorations, *and* cuffs (resistances are candidate-only; skill points
aren't). Reuses `active-skill-cap.ts`'s `isSkillActive` logic exactly inverted, via a new shared
`breakpointsFromThresholds` helper extracted out of the existing `resolveTierBreakpoints` (which also
now calls it) so both features stay in sync: `lower = negThreshold + 1` (or `-infinity` if no penalty
tier), `upper = posThreshold - 1` (or `infinity` if no bonus tier, or `0` for a wholly untiered skill,
mirroring `isSkillActive`'s own `points > 0` fallback) -- both offset by `pinnedPointsTowards(skillId)`,
the same pinned-cuff adjustment a skill requirement row already gets.

`SearchOptions.excludedActiveSkillIds: readonly SkillId[]` is the new solver-facing field (`types.ts`).
`build-query.ts`'s old `slotsAfterExcludedSkills`/`decorationsAfterExcludedSkills`/
`cuffsAfterExcludedSkills` (TODO #32's pool filters) are deleted; `buildSearchQuery` now just parses
`state.excludedSkillIds` into `BuiltQuery.excludedActiveSkillIds` (numeric ids), which `App.tsx`'s
`handleSearch` passes straight through to `search()`'s options alongside `resistanceFloors` etc. No
persistence changes needed -- `excludedSkillIds` keeps its exact existing shape and thread through
`AppInitialState`/`search-form-state.ts`/`shared-state.ts`/`query-code.ts`.

Verified: `ilp-model.test.ts`'s new `'buildModel with options.excludedActiveSkillIds'` block (untiered
skill rejected above zero and accepted at zero; a tiered skill accepted below its threshold and
rejected at it; a penalty tier rejected; a skill with both tiers accepted in the gap between them;
contributions correctly combined from a forced decoration and from a cuff needed for another
requirement; a pinned cuff's fixed contribution tipping an otherwise-safe total over the threshold; an
unlisted skill left completely unconstrained) and `build-query.test.ts` (excluding a skill no longer
drops anything from the pool; `excludedSkillIds` parses to numeric `excludedActiveSkillIds`) and
`App.test.tsx` (an excluded skill reaches the solver as `excludedActiveSkillIds`, with the full
candidate/decoration/cuff pool unchanged). Live-verified against the real dataset: a result with
"Hunter (9/10)" as an unrequested bonus skill, re-run with Hunter excluded, returned a different build
with "Hunter (3/10)" -- kept well below its own activation threshold rather than dropped from the
build (or the search failing) entirely.

## 38. Redo gear/cuff/decoration categorization; exclude non-equippable categories by default

**Status (2026-10-18): Armor slice COMPLETE. Decoration slice COMPLETE. Cuff slice and the
gendered-name display cleanup still explicitly deferred by the project owner.**

**Decoration slice (2026-10-18), after the armor slice shipped:**
- Two small armor-slice follow-ups landed first: Musou Armour's 9 leaf labels now show the actual
  set name (Demonclad, Rapin, Chiru, Elysi, Fonse, Ganeto, Bonne, 鬼凛ノ/童凛ノ, Demon Tale/童伝ノ)
  instead of the monster name used to research them -- the monster names were only ever a lookup aid,
  per the project owner ("that was just a way to figure out what belongs where"). Every category
  group in `CategoryFilter.tsx` also gained a collapse/expand chevron (now needed with the taxonomy at
  77+ leaves) -- new `collapsedGroups` state, a `.category-group-header`/`.category-group-collapse-toggle`
  CSS pair, 1 new unit test.
- The project owner supplied the reference tool's own decoration category tree (screenshot) and a
  short list of distinctions to apply: SP decorations restricted to SP armor (same mechanism as Tower
  Gems), Musou gems for the 9 monsters (corrected mid-investigation to "only 5" -- see below), and
  Extreme Quest decorations for 3 of the 4 quests.
- **SP Decorations**: confirmed restricted to usable-only-in-SP-armor, identical mechanism to Tower
  Gems (`is_tower`) -- new `is_sp` flag threaded end-to-end (`ParsedDecorationRow` → `Decoration` →
  schema column → export `isSp` → `NamedDecoration.isSp` → `decorationsAfterCategoryFilter` drops it
  unconditionally, same one-sided-enforcement caveat as TODO #11 already documents for Tower). The 3
  tiers (SP/SP改/SP真) are a real recipe chain in the data (plain → " α" → " β" name suffix, α's recipe
  references the base item, β's references α) -- 43 decorations per tier, 129 total.
- **Musou Decorations**: investigated expanding from 5 to all 9 monsters; found 3 more curated
  `CRE=1e`+`CLASS=I` numbered names (Reiresu/Reuasu/Riaruo) that looked like candidates, but the
  project owner ruled them out directly: *"Reiresu, Reuasu, Riaruo are different ones. its only the
  5."* -- no code change needed here, they're correctly classified as plain `deco_event_gx` already.
- **Extreme Quest Decorations**: added 3 new leaves (Heruto, Iroasu, Luchar) carved out of
  `deco_event_gx`/`deco_event_g` by curated name, same `CRE=1e`+`CLASS=I` bucket as armor's. Demon
  Lord has no decoration (0 real rows, no leaf, matching the no-leaf-for-confirmed-empty convention
  already used for Taiwanese Premium armor). Real counts (Heruto=1, Iroasu=1, Luchar=3) are close to
  but not identical to the project owner's estimate (1/2/3) -- flagged as a minor discrepancy in
  docs/gear-category-taxonomy.md, not independently resolved.
- **Unavailable 3-way split**: `CRE=7-` → Training (`deco_training_only`), `CRE=9` with a literal
  "作成不可" RECIPE1 marker → Impossible to Create (`deco_impossible_to_create`), `CRE=9` otherwise
  (an unreachable HR1="10000" sentinel in every real case) → Unimplemented (`deco_unimplemented`). All
  3 added to `DEFAULT_EXCLUDED_DECORATION_CATEGORIES` (previously only `deco_lottery_hiden` was
  excluded by default), mirroring the equipment-side Unavailable group's own default exclusion.
- **"(特)" Special**: 5 "kit purchase" rows (CRE 4k/5-) given a `deco_special` leaf -- the project
  owner did not confirm this label, flagged as a judgment call (same convention as
  `CATEGORY_GRANK_BURST_SPECIES`'s unconfirmed label). "(パ) Package" and "(ガTW) Lottery Decorations"
  are confirmed empty (0 real rows under any plausible CRE) -- no leaf added, matching the
  Taiwanese-Premium no-leaf-for-confirmed-empty precedent. "(塔GX) Event Cycle Decorations" is also
  unconfirmed/possibly-empty -- its `CRE=1t` bucket is already fully accounted for by the existing
  Hunter's Road leaves.
- ETL: full rebuild required this time (new `decoration.is_sp` schema column) -- old `frontier.sqlite3`
  moved aside as `frontier.sqlite3.bak-pre-decoration-category`, full `python -m etl.pipeline` +
  `python -m etl.export` re-run. Row counts match exactly (2,658 decorations, 61,817 equipment,
  unchanged) and every new leaf's count matches docs/gear-category-taxonomy.md's table.
- Verified: `etl/tests/parse/test_gear_category.py` (129 tests, new cases for SP tiers, Extreme Quest
  decorations, and all 3 Unavailable leaves) and the full ETL suite (304 tests) pass. Frontend
  `tsc -b`/`oxlint`/full Vitest suite (375 tests) clean. Live-browser confirmed: Decorations now shows
  "4 tiers of 34 excluded" (up from 1) on a clean (`localStorage`-cleared) session, with every new
  leaf and the 3 newly-default-excluded Unavailable leaves rendering correctly.

**Follow-up (2026-10-18, same day): naming/default-exclusion refinements after the decoration slice shipped.**
- Musou Armour's 9 leaf labels renamed from the monster name to the actual armor set name (Demonclad,
  Rapin, Chiru, Elysi, Fonse, Ganeto, Bonne, 鬼凛ノ/童凛ノ, Demon Tale/童伝ノ) -- the project owner
  clarified the monster names were only ever a research aid, never meant to ship as labels. Musou
  *Decorations*' 5 leaf labels got the identical treatment (Demonclad/Dojiclad, Rafan, Elysium, Bonne,
  Fonce).
- `grank_g_hashu`'s label corrected from "G-Hashu" to "G Supremacy" -- the project owner asked whether
  it was the G-rank tier of the "Supremacy" (`hardcore_hashu`) category; confirmed yes, both leaves
  decode the identical kanji "覇", just at different CLASS tiers (`CLASS G` vs `CLASS D`) -- the
  un-translated label was an inconsistency, not an intentional distinction.
- SP Decorations (all 3 tiers) are now in `DEFAULT_EXCLUDED_DECORATION_CATEGORIES` -- they were already
  unconditionally excluded from search via `isSp` regardless of checkbox state, but the checkbox itself
  defaulted to checked, which the project owner flagged as misleading. Still real, togglable leaves
  (unlike Tower/Unavailable below) purely so their checkbox state is visible and consistent.
- The 3 "Unavailable" decoration leaves (Training/Unimplemented/Impossible to Create) are no longer
  togglable leaves at all -- removed from `DECORATION_CATEGORY_GROUPS` entirely and excluded
  unconditionally via a new `_UNOBTAINABLE_DECORATION_CATEGORIES` set in `build-query.ts`'s
  `decorationsAfterCategoryFilter`, the same not-a-leaf/unconditional treatment Tower Gems already get
  (confirmed by the project owner: these are genuinely impossible to ever obtain, not just
  discouraged).
- Removed the "Tower Gems are never included..." explanatory `<p>` at the top of the Decorations
  section in `App.tsx` -- the project owner said this can be inferred and doesn't need calling out.
- Every category group (gear/cuff/decoration) also gained a collapse/expand toggle in
  `CategoryFilter.tsx`, now that the combined taxonomy is 75+ leaves across all 3 trees.
- No ETL/classifier changes needed for any of the above -- purely `gear-categories.ts`/
  `decoration-categories.ts` labels, `App.tsx`'s default-exclusion set, and `build-query.ts`'s filter
  logic. Verified: full frontend suite (375 tests), `tsc -b`, `oxlint` clean; live-browser confirmed
  Decorations shows "4 tiers of 31 excluded" on a clean session (down from 34 leaves after removing
  Unavailable's 3, with SP's 3 newly default-excluded).

**Follow-up (2026-10-18, continued): Paid/Premium subcategories and Zenith ZF, shipped.**
- **Paid and Premium armor split by CLASS.** Research found CLASS alone fully partitions each of the 5
  routes (Package/Premium Kit/Gachapon/Net Cafe/Promotional) -- unlike Cuffs' own `CRE=4k` split (which
  needed a RECIPE1-prefix rule), name-suffix tokens (HS/GS,GP/HC/ZP) here just corroborate the CLASS
  value rather than deciding it. Added a shared `_paid_premium_subcategory` helper in
  `gear_category.py` so the 5 call sites don't duplicate the same 7-branch CLASS check, each passing
  only the sub-leaves its own route actually has real rows for (e.g. Package has no Zenith-Shugo tier,
  Premium Kit has no Hiden/Exotic tiers). One real nuance found and left unresolved: the "G-Shugo"
  (`CLASS J`) tier has 2 parallel, evenly-split, name-suffix variants ("GS"/"GP") that are both
  `TYPE=0` (not a Blademaster/Gunner pair) -- merged into one leaf since what actually distinguishes
  them in-game is unconfirmed, flagged in docs/gear-category-taxonomy.md for a future look.
  `gear-categories.ts` split the old single "Paid and Premium" group into 5 separate top-level groups
  (Package/Premium Kit/Gachapon/Net Cafe/Promotional), each with its own sub-leaves, rather than one
  27-leaf group -- the new collapse/expand toggle (see above) makes each independently collapsible.
- **Zenith ZF.** Confirmed an exact 50/50 split of what used to all be `zenith_plain`: every row
  without a ZX/ZY token already carries either a bare "Z" or a "ZF" name-suffix token, the same pattern
  as the existing ZX/ZY checks -- just added a 3rd `if "ZF" in tokens` branch alongside them. The
  identical Z/ZF/ZY/ZX split exists in 3 other CRE buckets too (Road Zenith, Event Zenith, and even
  Diva Defense's own Zenith-class rows) -- left unsplit since the request was scoped to the "Zenith
  Armour" group specifically; flagged in the taxonomy doc in case those are wanted later too.
- ETL: full rebuild required (new category *values*, no schema change) -- old `frontier.sqlite3` moved
  aside as `frontier.sqlite3.bak-pre-paid-premium-zenith-split`, full `python -m etl.pipeline` +
  `python -m etl.export` re-run. Row counts match exactly (61,817 equipment, unchanged) and every new
  leaf's count matches docs/gear-category-taxonomy.md's table exactly (e.g. Premium Kit's 21,733 now
  splits into base 9,882 + HS 3,262 + G-Shugo 6,524 + HC 1,201 + ZP 864).
- Verified: `etl/tests/parse/test_gear_category.py` (131 tests, new cases for every sub-leaf across all
  5 routes plus Zenith ZF; 2 pre-existing tests whose whole premise was "CLASS doesn't matter for Paid
  routes" were rewritten, since that's now exactly what changed) and the full ETL suite (306 tests)
  pass, including a real-data integration test in `test_equipment.py` that needed the same update.
  Frontend `tsc -b`/`oxlint`/full Vitest suite (375 tests) clean -- 3 tests broke on an unrelated latent
  issue this change exposed (`getByLabelText('Premium Kit')` matched both the new "Premium Kit" *group*
  label and its own base leaf's identical label text; fixed by switching those 3 call sites to the
  accessible-name-based `getByRole('checkbox', { name: 'Premium Kit' })` query already used elsewhere
  in the same file, which correctly disambiguates via the group's `aria-label="... (all)"` override).
  Live-browser confirmed: "Gear levels" now shows "2 categories of 100 excluded" (up from 77, exactly
  the 23 new leaves: 22 paid/premium + 1 `zenith_zf`), with every new leaf rendering at its exact
  expected count.

**Armor slice (2026-10-15/17), shipped first:**

The project owner supplied the old reference tool's own armor category tree (screenshots) plus a
list of edits, confirmed/refined over several rounds:
- Remove "Taiwanese Premium" and "Subscription Period" -- turned out to need no code change at all,
  both were already confirmed-empty (0 rows) and absent from `gear-categories.ts` from an earlier
  taxonomy pass (see docs/gear-category-taxonomy.md).
- Split Event Armour into plain/GX (confirmed by the project owner) and carve Musou- and Extreme-
  Quest-named armor out of it by curated name, mirroring how decorations already carve Musou out of
  their own Event bucket.
- Gendered armor pairs (e.g. Quna/Kireek) -- investigated and found to be **not** a miscategorization:
  verified byte-for-byte identical stats differing only in `TYPE`/name, i.e. the exact same
  Blademaster/Gunner name-pair mechanism the project already documents for Mail/Vest etc. The project
  owner confirmed this is a **display cleanup** (show both names together somewhere), explicitly not
  part of this categorization TODO -- deferred, not scoped here.
- A would-be "Raviente is inside `grank_gx`" finding was initially reported but turned out to be
  wrong: re-verified by tracking each row's actual `SkillForm.setEquip("<slot>", ...)` section in the
  raw cache, and every "Violent/Berserk/Extreme Ravi" row lives in the decoration section, not armor
  -- no Raviente armor exists at all, nothing to carve out of `grank_gx`. Caught before shipping (see
  git history on this entry), reverted cleanly.
- The 9 real Musou monster names and the 4 real Extreme Quest names were resolved through several
  rounds of the project owner supplying exact in-game names and correcting early guesses (e.g. "Demon
  Tale"/童伝ノ and "鬼凛ノ"/"童凛ノ" were first guessed as Extreme Quests, turned out to be 2 of the 9
  Musou monsters instead) -- see docs/gear-category-taxonomy.md's new "Musou Armour"/"Extreme Quest
  Armour" tables for the final confirmed mapping and counts.

Implementation:
- `etl/src/etl/parse/gear_category.py`: `classify_equipment_category`'s `cre == "1e"` branch now
  splits `CLASS=I` rows into `event_gx`/`event_plain` by GX token (previously always `event_plain`
  regardless of tier), checking two new curated name-prefix tables first -- `_EVENT_MUSOU_NAME_PREFIXES`
  (9 monsters, one tuple of names each since 2 of the 9 have a genuine dual name) and
  `_EVENT_EXTREME_NAME_PREFIXES` (4 quests) -- each returning its own new `CATEGORY_EVENT_MUSOU_*`/
  `CATEGORY_EVENT_EXTREME_*` constant.
- `frontend/src/search-engine/gear-categories.ts`: `GEAR_CATEGORY_GROUPS` gained an `event_gx` leaf
  in the existing "Event Armour" group, plus two new top-level groups ("Musou Armour" with 9 leaves,
  "Extreme Quest Armour" with 4), mirroring `decoration-categories.ts`'s own top-level "Musou
  Decorations" group rather than nesting under "Event Armour".
- Required a full ETL rebuild (new category *values* on the existing `equipment.category` column, no
  schema change needed this time -- unlike the cuff/decoration category additions, which needed a new
  column): old `frontier.sqlite3` moved aside as `frontier.sqlite3.bak-pre-event-musou-category`, full
  `python -m etl.pipeline` + `python -m etl.export` re-run. Row counts match exactly (61,817 equipment
  total, unchanged) and every new leaf's count matches the taxonomy doc's table.

Verified: `etl/tests/parse/test_gear_category.py` (123 tests, including new cases for every Musou
monster name, all 4 Extreme Quest names, and the plain/GX Event split; the pre-existing
`test_event_plain`/`test_event_mystery_requires_the_luxt_name...` tests updated for the new split) and
the full ETL suite (300 tests) pass. Frontend `tsc -b`/`oxlint`/full Vitest suite (373 tests) clean.
Live-browser confirmed against the real regenerated bundle: "Gear levels" now shows "2 categories of
77 excluded" (up from 63, exactly the 14 new leaves: 1 `event_gx` + 9 Musou + 4 Extreme), and the new
"Musou Armour"/"Extreme Quest Armour" groups render with the exact counts from the taxonomy doc.

**Deferred, not part of either slice above:**
- Cuff category redo -- the project owner will supply schema/edits for this later.
- Expanding the Musou *decoration* list past 5 monsters -- explicitly ruled out by the project owner
  (see "Decoration slice" above): confirmed it's only 5, not a gap.
- The gendered-pair display cleanup (TODO #38 absorbed this question, but it's scoped out as its own
  future display-only change, not a categorization fix).

## 39. Make armor pinning show which skill a piece grants, without hovering

**Status (2026-10-18): COMPLETE**, delivered as part of a broader gear-picker remodel the project
owner asked for in the same sitting, covering four gripes:

1. **No hover styling on a search result.** `FilterableOptions.tsx` used to render a native
   `<select>`/`<option>` pair, which no browser lets you meaningfully style on `:hover` -- unlike
   `SkillPicker.tsx`'s own custom `.skill-add-option` button list, which already had a working
   hover/active highlight. Fixed by rewriting `FilterableOptions` to render a custom
   `role="listbox"`/`role="option"` `<div>` list (mirroring `SkillPicker`'s pattern) instead of a
   native select, styled via new `.filterable-options`/`.filterable-option` CSS rules
   (`index.css`). Shared by `ArmorPicker`, `CuffPicker`, and `EquipmentExclusionPicker`, so all three
   picked up the fix for free.
2. **This TODO's original ask**: skills shown without hovering each result one at a time. Fixed by
   adding an `onHoverChange?: (item: T | null) => void` prop to `FilterableOptions`, fired on
   mouse-enter/leave of each option. `ArmorPicker.tsx`'s `ArmorSlotPicker` (and
   `SlotDecorationOnlyPicker`) track the currently-hovered candidate/decoration in local state and
   render it as a new persistent `.hovered-skill-summary` line directly below the results list (one
   per search box: piece search, decoration-into-pinned-slot search, decoration-only-pin search),
   showing "Hover a result to see its skills." until something is hovered.
3. **Highlight the searched-for skill.** The original design note below about threading the
   *overall build's* requirement skill ids down from `App.tsx` turned out to be the wrong scope --
   what the project owner actually meant was simpler: highlight a skill in the hover-summary line
   when it matches the *piece search box's own query* (the same text `candidateMatches` already
   matches pieces against by skill name, TODO #26's #19). Implemented as a local
   `HoveredSkillSummary` component in `ArmorPicker.tsx` that wraps a matching skill name in
   `<mark>`, styled via `--accent` in `index.css` (no new prop from `App.tsx` needed).
4. **Exclusion-section picking used to close/clear the field.** Unrelated to the hover work, but
   fixed in the same pass: `EquipmentExclusionPicker.tsx`'s `ExclusionList.add()` called
   `setSearch('')` after every pick, forcing a full retype to exclude a second item. Removed --
   the picked item drops out of `pickableItems` on its own, so the remaining matches just stay
   visible under the still-populated search box.

`contributionSummary` (the plain-string tooltip helper) is untouched and still used for the
`title` attribute as a fallback; the new summary line is separate, locally-built JSX in
`ArmorPicker.tsx` only (not a new shared module -- only this file needs per-skill highlighting).

Verified: `tsc -b` and `oxlint` clean; full `vitest` suite green (384/384, the one known-flaky
real-data timing test from TODO #28 aside) after rewriting `FilterableOptions.test.tsx`'s
native-select-specific tests and converting every `fireEvent.change(..., {target:{value: id}})`
pick-simulation in `ArmorPicker.test.tsx`/`CuffPicker.test.tsx`/`EquipmentExclusionPicker.test.tsx`/
`App.test.tsx` to a click on the new `role="option"` element. Live-verified in the browser: hover
highlight and the persistent summary line (with the matched skill marked) on the head-piece search,
and multi-excluding several armor pieces in a row from the Exclusions section without the field
ever clearing.

**Follow-up (2026-10-18): fixed a perceptible delay after picking in the Exclusions section.** The
project owner reported "a bit of a delay between picking and the item disappearing from the list"
once point 4 above stopped clearing the search field. Root cause (confirmed via
`MutationObserver`-based click-to-DOM-update timing in the live browser, not guesswork): the
all-armor catalog `EquipmentExclusionPicker` searches across (`allArmorCandidates` in `App.tsx`) is
~62,000 rows flattened from every slot, and `ExclusionList` was doing two full passes over it per
pick -- filtering `items` down to `pickableItems` (excluding already-excluded ids), then
`FilterableOptions` filtering *that* result again by the search query. Fixed by folding the
exclusion check into the search's own `matches` predicate (a single pass), passing the stable
`items` array straight to `FilterableOptions` instead of a freshly-filtered one each time;
`pickableItems` is now only computed for `handleEnterToPickFirst`'s benefit (keyboard-only picking,
unaffected by this). This halved the per-pick work, dropping click-to-DOM-update latency from
~1,000-3,000ms to ~22ms in a production build (`npm run build` + `vite preview`) and ~100ms in the
`npm run dev` server (React dev-mode/StrictMode overhead accounts for the remaining gap --
confirmed by profiling both builds side by side; not worth chasing further since the shipped build
is already near-instant). Added a `frontend-preview` entry to `.claude/launch.json` (alongside the
existing `frontend-dev`) for exactly this kind of prod-vs-dev performance check going forward.
Re-verified: `tsc -b`/`oxlint` clean, the same 5 affected test files green (76/76).

**Second follow-up (2026-10-18): the Armor/Decorations/Cuffs exclusion lists now also search by
skill name**, the same "search armor pieces by skill" behavior `ArmorPicker.tsx`'s own
`candidateMatches` already had (TODO #26's #19) -- the project owner asked for it to be extended to
`EquipmentExclusionPicker.tsx` too, e.g. "exclude every piece granting Ice Atk G" without knowing a
single piece's name up front. Added a shared `matchesNameOrSkill` predicate in `ExclusionList`
(checks the item's own name first, then falls back to any of its `skills` resolving to a name
containing the query via `skillNameById`), composed into both the click-driven `pickableMatches`
(already folded with the exclusion check, see the perf fix above) and the Enter-key path via
`handleEnterToPickFirst`'s own `matches` override. The "Skills" list itself is unaffected -- its
items already *are* skills, so there's nothing to extend. Added a line to the Exclusions section's
own intro text in `App.tsx` noting the new skill-search capability (mirroring `ArmorPicker`'s own "You
can also search by skill name." hint). Added 5 new tests to `EquipmentExclusionPicker.test.tsx`
covering a name-silent skill match for each of armor/decoration/cuff, plus picking and Enter-key
selection via a skill-only match. `tsc -b`/`oxlint` clean; full suite 383/383 (the one known-flaky
real-data timing test aside). Live-verified in the browser: searching "sharpening" in each of the
three lists returns pieces/decorations/cuffs whose own names don't contain "sharpening" at all
(e.g. "Hunter's Helm", "All Res UP PC5"), proving the skill-based match, not just name substring.

**Third follow-up (2026-10-19): the persistent hover-skill-summary line is now also in
`EquipmentExclusionPicker.tsx`'s Armor/Decoration/Cuff lists**, not just `ArmorPicker.tsx`'s own
piece search, per the project owner. Since both components now need the exact same component,
pulled the formerly-inline `HoveredSkillSummary` out of `ArmorPicker.tsx` into its own
`components/HoveredSkillSummary.tsx` and imported it in both places rather than duplicating it.
`ExclusionList` gained a `showSkillSummary?: boolean` prop (defaults off) and a `hovered` state
wired through `FilterableOptions`' `onHoverChange`; passed `true` for Armor/Decorations/Cuffs but
left off for Skills, since a skill-exclusion row has nothing to show there (its items already *are*
skills, same reasoning as the skill-name-search extension above). Added 4 new tests covering the
idle prompt, the populated summary, the highlighted searched-for skill, and confirming the Skills
list renders no summary line at all. `tsc -b`/`oxlint` clean; full suite 387/387 (the one known-flaky
real-data timing test aside). Live-verified in the browser: hovering a result in the Exclusions
section's Armor list shows its skills with the searched skill marked, exactly like `ArmorPicker`'s
own piece search.

Separately, two small CSS-only tweaks landed on `.hovered-skill-summary` itself per direct user
feedback on how it looked: the gap above it (between the results list and the summary line) was
tightened from 6px to 0 (down to just the ~4px irreducible gap from the parent's own Bootstrap
`gap-1` flex spacing), and its text color changed from the muted `--text` to the normal/high-emphasis
`--text-h` -- a brief earlier attempt to additionally enlarge it and wrap it in a bordered box was
tried and then explicitly rolled back by the project owner ("I'll look at it myself"), so that part
was reverted; only the gap and color changes stuck.

**Fourth follow-up (2026-10-19): raised `FilterableOptions.tsx`'s `MAX_MATCHES_SHOWN` from 30 to
200**, per the project owner ("30 is a little bit low... especially when searching for a specific
skill"). Confirmed before changing it that this is cheap: the expensive part (scanning the whole
catalog for matches) runs the same regardless of how many of those matches get rendered --
`MAX_MATCHES_SHOWN` only bounds the `.slice()` afterward, so raising it just means ~170 more small
`<div>`s in an already-scrollable list, not more scanning. Measured in the live browser with 200
results actually rendered to confirm, not just reasoned about: hover-to-DOM-update ~14ms, click-to-
pick ~63ms in the `npm run dev` server (consistent with the TODO #39 perf-fix numbers above) --
no perceptible regression. Updated `FilterableOptions.test.tsx`'s overflow-note test to use 205
items / an expected 200 shown. `tsc -b`/`oxlint` clean; full suite 387/387 (the one known-flaky
real-data timing test aside).
