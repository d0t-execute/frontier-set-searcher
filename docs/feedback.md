# External user feedback

A running log of feedback from people outside the project, collected in rounds. Unlike
[skill-system-roadmap.md](skill-system-roadmap.md) (which tracks work the project owner has actually
decided to do, with full design/implementation write-ups once started), this file is an **intake
log**: raw asks, captured faithfully, triaged loosely, before a decision has been made on whether or
how to build each one. Once an item here is actually picked up, it should get a proper entry in
`skill-system-roadmap.md` and can be marked done here with a pointer to that entry.

## Round 1 (2026-10-16)

Source: people familiar with the old (pre-this-project) MHF-Z set searcher, described as the "main
demographic" for this new tool.

1. **More detailed armor categorization**, based on the category tree the newer version of the old
   set searcher uses -- today's `GEAR_CATEGORY_GROUPS` tree (`gear-categories.ts`) is presumably
   coarser than what that tool exposes. Needs the old tool's actual tree in hand to know the gap.

2. **DONE** (see roadmap #27) ~~See what's actually in a category~~ -- armor and decorations both.
   Suggested UI: a button next to each category-tree leaf (`CategoryFilter.tsx`) that opens a list
   (maybe a new tab) of every piece/decoration in that leaf, so a filter's effect isn't a total guess
   from its name alone. Built as an inline "View (N)" expand/collapse per leaf rather than a new tab.

3. **Show a live count of selected skills**, visible even while the Skills section is collapsed (its
   `Disclosure` summary today just says "N skills", which already technically does this -- worth
   confirming with the reporter whether the ask is about the collapsed summary specifically, a
   per-skill running index as you add them ("first skill -> shows 1, second -> shows 2"), or both).

4. **DONE** (see roadmap #28) ~~Force elemental resistances to be non-negative~~ -- as a floor on the
   total build (avoid a glaring elemental weakness), and ideally toggle-able per element
   (fire/water/thunder/ice/dragon) rather than only all-or-nothing. `ResultsList.tsx` already sums and
   displays per-build resistances (TODO #21's prerequisite work) -- this asks for that sum to become an
   enforced solver constraint, not just a display.

5. **DONE** (see roadmap #26) ~~Exotic skills in their own result-card tab~~, the same way Zenith
   skills already get split out from regular skills (TODO #16).

6. **"Skill Slots Up" should accept a range (1-7), not an exact amount** -- in the old tool, picking
   a range let it autofill however many levels actually helped; here, requesting an exact amount that
   turns out to be more than needed forces the solver to pad the rest with other skills instead of
   just using less. Sounds like a request for a skill requirement to optionally be "at least X, let
   the solver settle however high it naturally reaches" rather than only "exactly X points which may
   overshoot the tier."

7. **DONE** (see roadmap #26) ~~Copy a result to the clipboard~~ -- as an image (the existing
   "Download as image" button, `ResultCard.tsx`'s `html-to-image` use, just needs a clipboard-write
   variant) or as text.

8. **Full keyboard navigation** -- usable entirely without a mouse, moving between selection
   controls.

9. **DONE** (see roadmap #26) ~~Hovering a cuff should show its skill points~~, matching the `title`
   tooltip every other pick/decoration already gets (`ArmorPicker.tsx`'s `contributionSummary`) --
   `CuffPicker.tsx` never wired the same thing up.

10. **Sort options for search results** -- by resistance (highest/lowest) or by "specific armor or
    cuff slot" (reporter wasn't sure exactly what this meant either -- needs clarification before
    design).

11. **DONE** (see roadmap #26) ~~Collapse individual result cards~~, so scrolling through many
    results is easier (`ResultsList`/`ResultCard` have no collapsed state today -- could reuse
    `Disclosure.tsx`).

12. ~~**A "preference"/"already owned" list** -- equipment that's nice to use but not required, only
    dropped from a result if that's the *only* way to reach a valid build. Effectively the inverse of
    pinning: "prefer this if feasible" rather than "force this regardless." Likely needs real
    `ilp-model.ts` objective-function support (a soft bonus for using a preferred item), not just a
    pre/post filter.~~ **DONE** -- see Round 2 #2's entry for the actual implementation.

13. **Mark gender-specific pieces** somewhere in the UI (some MHF-Z armor is gender-locked) -- needs
    checking whether the source data/ETL even captures gender restriction today.

14. **DONE in part** (see roadmap #27) ~~Better feedback on why a search found nothing~~ -- e.g.
    detecting and explaining up front that a request is logically impossible, plus whatever else is
    cheaply detectable by logic before/instead of just reporting "no results." Done for the
    data-provable case (a skill's own minimum exceeds the most any currently-includable equipment
    could ever grant it). The example actually given -- 8 simultaneous active Zenith skills -- is
    *not* covered: it depends on an unconfirmed game mechanic (how many Zenith skills can really be
    simultaneously active) this engine doesn't model at all yet, left as a follow-up needing that
    confirmation first (same caution as TODO #16).

15. **No way to target a specific gear variant/tier for a slot** -- the reported case: a real build
    mixing Origin, Exotic, and GX pieces across slots couldn't be searched for, because there's
    apparently no way to pin or filter down to "an Origin piece specifically" the way pinning an exact
    known piece or excluding/including a whole category already works. Needs investigation into
    exactly what's missing (a category-tree gap? a pinning gap for "any piece of tier X, solver's
    choice of exactly which"?).

16. **DONE** (see Round 2 #4) ~~Show the achievable active-skill cap given current armor/Zenith
    settings~~, before or alongside running a search -- the example given: if every included piece is a
    Zenith piece, a build with no active Zenith skill of its own is capped lower than normal (e.g. 12,
    or 13 with a Zenith weapon skill) because it can't reach the usual G-Rank-piece-count cap bonus.
    Needs confirming this specific mechanic (Zenith pieces not counting toward the G-Rank piece-count
    bonus) against real game rules/data before building it. **Note:** this premise turned out to
    conflict with the already-shipped data -- `NamedCandidate.grankOrLater` is `true` for Zenith-category
    gear (only Origin is carved out, per Round 2 #5), so Zenith pieces *do* count toward the G-Rank
    piece-count bonus today, both in actual solved results (`countGrankOrLaterPieces`) and in the new
    preview (`previewActiveSkillCap`). Not re-litigated as part of shipping Round 2 #4 -- flagging here
    in case the "Zenith pieces don't count" premise reflects a real game rule this project has gotten
    wrong elsewhere, worth a separate confirmation with the project owner if revisited.

17. **DONE** (see roadmap #26) ~~Sort decorations within a result~~ so duplicates of the same
    decoration cluster together (or at least sit adjacent) instead of appearing in whatever order the
    solver happened to produce, making it easier to read at a glance which decorations are used where.

18. **DONE** (see roadmap #27) ~~Save a skill-set/query for later reuse~~ -- suggested approach: a
    text input mapped to a specific saved query. Built exactly that way, reusing
    `shared-state.ts`'s own gzip/base64url codec (pulled out into `codec.ts`) scoped to just the
    search inputs (`SearchFormState`) rather than a solved result.

19. **DONE for pinning** (see roadmap #26) ~~Search for an armor piece by the skills it grants~~, not
    only by its name -- done for `ArmorPicker.tsx`'s piece-pin search. `EquipmentExclusionPicker.tsx`'s
    armor-exclusion search still matches on name only (its `Named` item shape has no `skills` field to
    search yet) -- a natural follow-up, not yet done.

20. **Tower weapons and their associated Tower decorations** -- a separate request (not from the same
    person as the rest, per the report). Today, Tower Gems are deliberately excluded from the general
    decoration pool entirely (`decorationsAfterCategoryFilter`'s docstring) because this engine has no
    way to target them at a Tower piece specifically, and Tower weapons aren't modeled at all (the
    weapon slot is virtual, keyed only by Zenith skill -- see `build-query.ts`'s `buildWeaponSlot`).
    Supporting this for real likely means modeling Tower armor as its own constrained pairing (a Tower
    weapon/piece can only take Tower Gems, and vice versa), which TODO #11's own note already flagged
    as unenforced.

## Round 2 (2026-10-19)

1. ~~**Extend "Results to show" past 50** -- add 100/150/250 to `App.tsx`'s `MAX_RESULTS_OPTIONS`
   (today: 1/3/5/10/20/50). No engine change needed, just more iterations of the existing
   solve-exclude-resolve loop -- a plain quick win.~~ **DONE** (2026-10-19)

2. ~~**A "preference"/"already owned" list** -- same ask as Round 1 #12, repeated here. Still needs
   `ilp-model.ts` objective-function support (a soft bonus for using a preferred item), not just a
   pre/post filter -- not a quick win.~~ **DONE** (2026-10-19): a new "Preferred pieces" section
   (`PreferredArmorPicker.tsx`, same search-by-skill/tier-label UI as the exclusion lists) feeds a flat
   set of armor piece ids through `QueryFormState.preferredArmorIds` ->
   `SearchOptions.preferredCandidateIds` -> `ilp-model.ts`'s `buildModel`. Initially shipped as a mild
   tie-breaker (a small bonus below `OPEN_SLOT_WEIGHT`), then corrected the same day per the project
   owner's explicit clarification: "the preferred pieces should always win out over any other valid
   result... an optimized result that uses 0 preferred pieces should be omitted in favor of a worse
   result that still meets the query and has a preferred piece" -- i.e. this is meant to optimize
   around gear the player already owns, much like pinning, but as an overridable *pool* rather than a
   fixed per-slot assignment. `PREFERRED_ITEM_WEIGHT` (10,000,000) now dominates every other ranking
   factor including `OPEN_SLOT_WEIGHT`, applied additively per preferred piece used so a build using
   *more* of them always outranks one using fewer (confirmed live: a preferred 1-open-slot piece now
   correctly wins the slot over a non-preferred 3-open-slot one). Still purely a ranking tie-break, not
   a hard constraint -- a feasible build using none of the preferred pieces is still returned once using
   any of them would make a requirement unreachable. Scoped to armor pieces only, matching the
   feedback's own wording ("pieces") -- decorations/cuffs weren't asked for and would need their own
   follow-up if wanted. Plumbed through the full persist/share/save-code pipeline
   (`search-form-state.ts`, `shared-state.ts`, `query-code.ts`) the
   same way every other query-shaping control already is.

3. ~~**Sort results by resistance, "number of skills over cap," or defense** -- overlaps Round 1 #10.
   "Number of skills over cap" is presumably `ResultCard`'s own already-computed `disabledCount` (how
   many skills `computeActiveSkillCap` force-disabled for that build) -- if so this is buildable as a
   pure client-side re-sort of the already-fetched `results` array (resistance sum, `disabledCount`,
   and summed `defenseMax` are all already derivable per result), with no engine change. Needs
   confirming that reading of "over cap," plus which direction each sort goes (e.g. fewest disabled
   first) and whether a default "solver order" option stays available.~~ **DONE** (2026-10-19): a new
   "Sort by" dropdown (`App.tsx`) re-sorts the already-solved `results` client-side, via a new shared
   `search-engine/result-stats.ts` module (`computeResultStats`, also now used by `ResultsList.tsx`
   itself so a sort can never disagree with what a card displays). "Resistances" sorts by
   `resistanceScore`: the average of all 5 elements, but any negative resistance is weighted 3x before
   averaging (confirmed by the project owner: "penalize negative values strongly" -- a build with one
   bad negative should sort below one with merely mediocre positives). "Skills over cap" sorts by
   `disabledCount` ascending (fewest first), confirmed. "Best match" (the solver's own order) stays the
   default.

4. ~~**Show the achievable active-skill cap for the current selection, before running a search** --
   overlaps Round 1 #16, now with a worked example: 5 non-"Skill Slots Up" Zenith skills selected +
   7 equippable Zenith pieces -> cap 14 (10 base + 2 G-Rank-piece-bonus + 2 from Skill Slots Up).
   The "+2 from Skill Slots Up" despite it not being one of the 5 selected skills needs clarifying --
   does this mean the preview should also account for "Skill Slots Up" points incidentally available
   from the same gear that grants the other 5 (plausible, since one piece can carry several Zenith
   skills), separately from whatever the player explicitly selects? Needs this confirmed before
   building, same caution as Round 1 #16's own entry.~~ **DONE** (2026-10-19, corrected same day): first
   shipped computing the "current" cap (what's already locked in by gear/selections plus a per-skill
   incidental-Skill-Slots-Up sum), but that conflated "what's the cap right now" with the actually-asked-
   for "how high could it still go" -- the project owner's correction: this is about the *current
   selection's remaining ceiling*, not what's already equipped. Reworked `active-skill-cap.ts`'s
   `previewActiveSkillCap` into a slot-budget model: every real armor slot, the weapon slot, and the
   `MAX_EQUIPPED_CUFFS` cuff slots are each one "position" that could still end up granting Skill Slots
   Up; every *other* selected Zenith requirement is assumed to claim one dedicated position (this game
   never grants more than one Zenith skill per piece, so a position used for skill X essentially never
   also carries Skill Slots Up); whatever positions are left over is the most Skill Slots Up this
   selection could still reach, capped at +7. A position already resolved to a single candidate
   (pinned, or narrowed by filtering) contributes everything it has unconditionally, no trade-off to
   make; a position with real choices left is matched to an unmet requirement only if needed (greedy,
   preferring to spend positions with the least Skill Slots Up potential first), confirmed against the
   project owner's own worked examples: 0 selected + 7 flexible positions -> 19 (10 + 2 G-Rank + 7); 5
   selected (each claiming its own position) -> 14 (10 + 2 + 2 left over); pinning both cuff slots to
   non-Skill-Slots-Up cuffs on top of that -> 17 (two positions removed from play entirely, not just
   claimed). The G-Rank-piece bonus itself is unchanged from the first version (per real armor slot, any
   currently-eligible candidate counts, same Origin carve-out as Round 2 #5) -- it doesn't compete with
   Zenith-skill slot usage, since one piece can be both. Fed `buildSearchQuery`'s own resolved
   `slots`/`cuffs`/`pinnedCuffs`/`pinnedCuffSkillIds` (never decorations, which don't grant Zenith
   skills), so it automatically honors every existing category/id exclusion, pin, and Hunter Type filter
   with no separate filtering logic. Shown live in `App.tsx` just above the action bar ("Highest
   active-skill cap still reachable from here: N"), reactive to every selection change (confirmed live
   against the real catalog: selecting "Dissolver Up" as a requirement dropped the reachable ceiling
   from 19 to 18, one real position consumed). `queryFormState` was memoized as part of this (it used to
   be rebuilt fresh every render, fine when only read on a button click, but not once a live preview
   reads it reactively too). **Two further corrections** (2026-10-19, same day): (1) cuffs were modeled as
   two independent `MAX_EQUIPPED_CUFFS` positions, each able to reach Skill Slots Up on its own --
   confirmed wrong by the project owner: "there are only ever 7 Zenith skill points that can be gotten in
   a build. 1 for each armor piece, 1 from the cuff, and 1 from the weapon," i.e. cuffs collectively share
   just 1 Zenith-capable position, not 2 (this surfaced as excluding the weapon's Zenith skill still
   showing a reachable cap of 19 instead of 18 -- fixed, confirmed live: 19 with weapon Skill-Slots-Up
   allowed, 18 with it excluded). A pin only "spends" that shared slot when it actually grants some Zenith
   skill (`cuffGrantsAnyZenithSkill`); a non-Zenith pin still occupies a physical cuff slot without
   touching the budget, so the one remaining unpinned slot can still become the Zenith-capable cuff. (2)
   each selected Zenith requirement was treated as claiming exactly 1 position regardless of its tier --
   confirmed wrong: "A Zenith piece can only ever give 1 point of a Zenith skill, meaning that if I have
   Stylish Assault up +2 as the goal of the search, it should deduct 2 points rather than 1." Fixed by
   reserving `minPoints` dedicated positions per requirement instead of 1 (confirmed live: adding "Stylish
   Assault Up" at +1 dropped the reachable cap by 1, at +2 by 2).

5. ~~**Origin pieces shouldn't count toward the G-Rank-or-later piece-count skill-cap bonus** -- while
   investigating #4, found this is likely a real, already-shipped bug: ETL's
   `is_grank_or_later_equipment` puts `_CLASS_SISYU` (Origin, category `grank_origin`) in
   `_GRANK_OR_LATER_CLASSES`, so an Origin piece sets `grankOrLater: true` same as any other G-Rank+
   piece, and `active-skill-cap.ts`'s `countGrankOrLaterPieces` (which feeds the real
   `computeActiveSkillCap` used for actual solved results, not just a future preview) counts it
   toward the 3/5-piece bonus today. Per this feedback, it shouldn't. Flagging for confirmation before
   fixing, since it would change already-displayed active-skill-cap numbers for any build using an
   Origin piece -- `grankOrLater` itself should stay `true` for Origin everywhere else (category
   filtering, etc.), this is scoped to the piece-count bonus specifically.~~ **DONE** (2026-10-19):
   confirmed by the project owner, fixed in `active-skill-cap.ts`'s `countGrankOrLaterPieces` -- a
   candidate in category `grank_origin` no longer counts toward the 3/5-piece G-Rank bonus, while
   `grankOrLater` itself is untouched (still `true` for Origin everywhere else). This changes the
   displayed active-skill cap for any already-existing build using 1+ Origin pieces, as flagged above.

6. ~~**New top-level Gear levels checkboxes for pre-G-Rank / G-Rank / Zenith** -- a coarser "toggle a
   whole tier at once" layer above the existing fine-grained category tree (`GEAR_CATEGORY_GROUPS`),
   presumably checking/unchecking every leaf that tier spans. Needs deciding exactly which existing
   leaves fall under each of the 3 new buckets (e.g. does "G-Rank" include Exotic/Origin/Hiden-G? does
   "Zenith" include Road Zenith and Event Zenith?) before building.~~ **DONE** (2026-10-19): confirmed
   "G-Rank" = the whole "G Rank Armor" group (incl. Exotic, Origin, G-Hiden) and "Zenith" = the base
   Zenith Armor group plus Road Zenith and Event Zenith (and their ZF/ZY/ZX variants); "Pre-G-Rank" is
   derived as everything else, so it can't drift from `GEAR_CATEGORY_GROUPS` as categories are added
   (`gear-categories.ts`'s `GEAR_LEVEL_GRANK_CATEGORIES`/`GEAR_LEVEL_ZENITH_CATEGORIES`/
   `GEAR_LEVEL_PRE_GRANK_CATEGORIES`). Three quick-toggle checkboxes now sit above the existing
   category tree in `App.tsx`'s "Gear levels" disclosure.

7. ~~**Split Road Zenith and Event Zenith into plain/ZF**, matching the base Zenith category's existing
   `zenith_plain`/`zenith_zf` split. Confirmed as a real gap while investigating: ETL's
   `classify_equipment_category` checks for a "ZF" name token under the base Zenith branch
   (`CLASS=Zenith`, `CRE` blank) but never under the `CRE="1t"` (Road) or `CRE="1e"` (Event) Zenith
   branches, so a ZF piece from either route silently lands in the plain `road_zenith`/`event_zenith`
   bucket today. A clear, scoped ETL fix (new `road_zenith_zf`/`event_zenith_zf` categories mirroring
   the existing ZY/ZX check pattern) -- a quick win once prioritized.~~ **DONE** (2026-10-19): new
   `road_zenith_zf`/`event_zenith_zf` categories added to `gear_category.py`, confirmed against real
   cached data (60 Road + 52 Event rows reclassified), frontend taxonomy and bundle regenerated.

8. ~~**Search skills (and gear) by skill name and by tier/threshold label**, not just the skill's own
   name -- e.g. typing a tier name like "+2" or a threshold-specific label should also surface the
   skill/piece that has it. Needs checking what's actually in `SkillTierRecord.label` across the real
   catalog (today's `skills.json`/`zenith-skills.json`) to know what this search would actually match
   against.~~ **DONE** (2026-10-19): confirmed the real catalog has plenty of tier labels distinct from
   their skill's own name (e.g. Cooking's "BBQ Master"/"BBQ Expert"). Extended every existing
   skill-name search to also match tier labels: `SkillPicker.tsx`'s "Add a skill" control,
   `ArmorPicker.tsx`'s per-slot piece search (via a new `skillSearchTextById` lookup, name + every tier
   label pre-joined and lowercased), and `EquipmentExclusionPicker.tsx`'s armor/decoration/cuff/Skills
   exclusion lists (the Skills list matches its own tier labels too, not just a granted skill's, since
   its items already *are* skills). `CuffPicker.tsx`'s own "Exact cuff" search never had skill-name
   matching at all (out of scope here -- a separate gap, not extended).

9. ~~**A consistent "view full table" link/button for every category, not just overflowing ones** --
   today's "show more" link (`CategoryFilter.tsx`, added 2026-10-19) only appears once a category's
   contents exceed `MAX_CATEGORY_CONTENTS_SHOWN` (100); this asks for the same link (or an equally
   consistent affordance) on every category leaf regardless of size, so "see this as a sortable table"
   isn't conditional on how big the category happens to be. A quick win -- `CategoryTablePage.tsx`
   already handles any category key, this just needs the link always rendered.~~ **DONE** (2026-10-19):
   a "Table" link now renders next to every leaf's "View" toggle whenever it has items, regardless of
   category size.

## Round 3 (2026-10-24)

1. ~~**Several decorations need recategorizing out of "Standard Production"** -- reported via an
   attached CSV of 47 decoration names (e.g. "G Rage・Attack", "G Attack・Draw"), all clearly G-rank
   combo-skill decorations (crafted from G-rank monster materials) that were showing up as plain
   Standard-tier items instead.~~ **DONE** (2026-10-24, see
   [gear-category-taxonomy.md](gear-category-taxonomy.md)'s "Blank-`CLASS` G/GX decorations" note):
   confirmed the real bug was broader than the 47 reported -- `classify_decoration_category` only
   ever checked a decoration's name for a G/GF/GX tier token when its raw `CLASS` field was also
   G-rank-tagged (`CLASS=I`); a decoration with a blank `CLASS` (which includes all 47 reported, plus
   75 more like it) fell through to "Standard"/"Event" regardless of its own name. Fixed by running
   the same name check unconditionally; moved 122 rows from `deco_standard` to `deco_g` and all 49
   `deco_event` rows to `deco_event_g`/`deco_event_gx` (0 genuinely tier-free event decorations
   existed in the real dataset). No new category needed -- these landed in already-existing leaves.

2. ~~**Prefer a set of (Zenith) skills, not just hard-require them** -- same soft-preference family as
   the already-shipped "preferred pieces/categories" (Round 2 #2 above), but for skills instead of
   gear: mark a skill/Zenith-skill requirement as "optional" (a checkbox) so a result having it
   outranks one that doesn't, without making it infeasible to search at all when it can't be reached.
   Suggested optional extra: a priority order among the optional skills (by add-order, or a number
   field), so if only some optional skills are jointly reachable, the higher-priority ones are
   preferred over lower ones (not just "more is better" with no ordering).~~ **DONE** (2026-10-24, see
   [skill-system-roadmap.md #40](skill-system-roadmap.md)): confirmed with the project owner that
   preferred pieces still dominate this, up to 7 priority tiers get real dominance, and same-priority
   skills are interchangeable (satisfying more than one earns no more than satisfying just one).

3. **A progress/loading indicator while a search runs** -- currently there's no feedback at all beyond
   results streaming in once found; a percentage or loading bar was requested. **Not started.** Needs
   scoping what "percentage" would even mean given this is a time-boxed MIP solve, not a
   known-size enumeration -- there's no natural "N% done" signal from HiGHS mid-solve. An
   indeterminate spinner/bar (just "searching...") is a much smaller lift than a real percentage and
   may be what's actually achievable; worth confirming which the reporter would accept before
   building either.

4. **Bug report: excluding "G or GF" G-rank decorations causes a previously-successful search to find
   nothing, even though the reporter says the returned build didn't use any G/GF decoration in the
   first place.** Not yet reproduced -- no specific skill query was given. A second, maybe-unrelated
   report mentioned a cached page not producing results, which could be an entirely separate stale-
   data/service-worker issue rather than the same bug. Two working theories, both unconfirmed:
   (a) the result shown actually does use a decoration from a category wrongly believed unused (the
   reporter didn't double check), in which case excluding it is working as intended, not a bug; or
   (b) removing a large decoration category changes the MIP's structure enough that the solver no
   longer finds a feasible incumbent within its per-round time box (`engine.ts`'s `TIME_BOX_SECONDS`)
   even though a feasible build still exists -- the same class of time-box-sensitivity issue already
   hit and fixed for CI's hardest real-data test this week, just triggered by a UI toggle instead of
   slower hardware. Needs the reporter's exact skill selections/settings to actually reproduce and
   tell these apart.

5. **A browsable database page listing every registered piece/deco/cuff** -- mirror the existing gear
   category tree on a new page, showing every item and letting it be filtered down by the same active
   categories; ideally with a column naming which category each row belongs to. Also requests a
   top-level "show all" link for each of the three trees (armor, cuffs, decorations) in addition to
   the existing per-leaf "Table" links (`CategoryTablePage.tsx`, Round 1 #2/Round 2 #9). **Not
   started.** `CategoryTablePage.tsx` already does almost exactly this per-leaf -- extending it to an
   "all categories, all items, filter by category" view is a plausible, fairly contained extension of
   existing infrastructure rather than new groundwork, but the exact UI (one page per tree with a
   category filter? one unified page?) needs scoping.
