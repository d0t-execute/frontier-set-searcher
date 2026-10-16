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

4. **Force elemental resistances to be non-negative** -- as a floor on the total build (avoid a
   glaring elemental weakness), and ideally toggle-able per element (fire/water/thunder/ice/dragon)
   rather than only all-or-nothing. `ResultsList.tsx` already sums and displays per-build
   resistances (TODO #21's prerequisite work) -- this asks for that sum to become an enforced solver
   constraint, not just a display.

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

12. **A "preference"/"already owned" list** -- equipment that's nice to use but not required, only
    dropped from a result if that's the *only* way to reach a valid build. Effectively the inverse of
    pinning: "prefer this if feasible" rather than "force this regardless." Likely needs real
    `ilp-model.ts` objective-function support (a soft bonus for using a preferred item), not just a
    pre/post filter.

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

16. **Show the achievable active-skill cap given current armor/Zenith settings**, before or alongside
    running a search -- the example given: if every included piece is a Zenith piece, a build with no
    active Zenith skill of its own is capped lower than normal (e.g. 12, or 13 with a Zenith weapon
    skill) because it can't reach the usual G-Rank-piece-count cap bonus. Needs confirming this
    specific mechanic (Zenith pieces not counting toward the G-Rank piece-count bonus) against real
    game rules/data before building it.

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
