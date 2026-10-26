# Search performance research (2026-10-26)

Goal: make searches dramatically faster, especially on weak client machines, without giving up
on returning the optimal build. This doc maps where the time actually goes today, the candidate
approaches, and their tradeoffs. Everything below marked **measured** was run against the real
committed data bundle (`frontend/public/data`) on the dev machine, using the same three real
queries as `engine.real-data.performance.test.ts` (4-skill, 17-skill "end-game", 17-skill tight
"sword build"). Approaches 1-4 and the exact-mode plan in 7 have since shipped (see "Status after
the second implementation pass" below); the rest is still research.

## TL;DR

The solver is not the bottleneck. The model handed to the solver is. HiGHS gets 65,000-75,000
columns per search: every armor piece in the game (~62k), plus one column per relevant
decoration _per slot per count_. On the two easier benchmark queries HiGHS solves the problem at
the **root node** (1 branch-and-bound node), so ~100% of the 14-26s per round is presolve and the
root LP over that huge column set. Solver knobs (heuristic effort, time boxes, retries) can't
fix that, which is very likely why earlier tuning attempts came out neutral or slower.

Three exact model reductions, prototyped outside the engine (1 result each):

| Query                 | Current engine                                                 | + prune dominated armor                                       | + prune dominated decorations              | + pool decorations across slots                |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| 4-skill               | 14.0s                                                          | 0.38s                                                         | 0.11s                                      | **0.09s**                                      |
| 17-skill end-game     | 26.6s                                                          | 2.5s                                                          | 1.3s                                       | **1.2s**                                       |
| 17-skill sword (hard) | first build at 81s, no proof in 300s (best 10024, bound 21746) | first build at 5.8s, no proof in 300s (best 122, bound 21515) | no proof in 300s (best 10039, bound 17965) | **valid build in 1.1s, proven optimal in 26s** |

Each variant returned the same optimal objective as the current engine where the current engine
finishes at all. The hard query shows the decoration pooling (approach 3) is what matters most once
a query is genuinely hard. Armor pruning alone fixes the "big LP" cost but leaves the
slot-symmetry problem that keeps HiGHS from closing the search tree.

On a weak client (single-threaded WASM, plausibly 3-5x slower than the dev machine), today's
26s/round x 5 default results is roughly 7-11 minutes, which matches the reported "10+ minutes."
The same arithmetic on the reformulated model is roughly 5-30s total.

## Status after the second implementation pass (2026-10-26)

**Shipped:**

- Approach 4: exact optimality gap (`engine.ts`).
- Approach 1: k-dominance armor pruning (`candidate-pruning.ts`, when `SearchOptions.maxResults`
  is set, which `App.tsx` always passes).
- Approach 3: decorations pooled across slots (`ilp-model.ts`). Results are now distinct by gear
  set, each with its best decoration fill.
- Approach 2: decoration dominance pruning, exact once pooled.
- Section 7, exact mode:
  - Strict mode's "clean first" rule is a hard constraint on the live model. Tier indicators are
    bounded to 0, then to 1 once clean builds run out. This replaces the cut-and-retry loop and its
    fallback bookkeeping.
  - `worker-handler.ts` runs exact-mode searches as:
    1. a bonus-free **ceiling** search (`withoutTierPenalties`, prunes soundly, 0.1-4s);
    2. a fast pass over a 20-per-slot pool. Results already reaching the ceiling are unbeatable
       and go out as proven; the rest are marked provisional.
    3. A full verification pass, only if anything was left provisional. Its results replace the
       provisional ones in place.
  - The model's objective now carries always-met optional-skill tiers as a constant `offset`, so
    objective values compare across differently-pruned models. This also fixes a small existing
    bug where such a tier could be rewarded twice.
- The worker client terminates and replaces the worker to cancel a running search. A posted cancel
  can't interrupt a solve in progress.

**Measured end to end, 5 results, dev machine, production time box:**

| Query, default ranking | Before today               | Now                                                                                    |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| Live app query         | 83s                        | **0.3s**                                                                               |
| 4-skill                | 84s                        | **0.3s**                                                                               |
| 17-skill end-game      | ~2 min                     | **5.6s**, 5 distinct sets                                                              |
| 17-skill sword         | nothing within the 90s box | #1 proven at 25-30s; later rounds still hit the 30s box (bonus-point tail, approach 5) |

| Query, exact mode (app default)       | Before today                                    | Now                                                                                         |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Live (Node, full dataset)             | ~60-90s                                         | **0.4s, all proven** (no verification pass needed)                                          |
| Live (in the app, default categories) | 60s+, still searching                           | provisional at **0.6s**, verified at 38s                                                    |
| 4-skill                               | 90s                                             | **0.9s, all proven**                                                                        |
| sword                                 | 300s box hit                                    | **23.9s, all proven**                                                                       |
| end-game                              | gave up at 300s, returned 3 active bonus skills | provisional at **12.1s**; verification pass done at 160s (several rounds time-boxed at 30s) |

When the verification pass is needed: whenever the best clean build has fewer open slots than the
best build overall, the ceiling can't certify it. That's common in the app, where the builds with
the most open slots usually activate bonus skills. The full model then costs ~30s per result on the
dev machine, so the provisional pass is what keeps the answer fast. A proof alone isn't fast enough
to replace it.

## Status after the first implementation pass (2026-10-26)

**Shipped:** approach 4 (`engine.ts`: `mip_rel_gap = 0`, `mip_abs_gap = 0.99`) and approach 1
(`candidate-pruning.ts`, applied when `SearchOptions.maxResults` is set, which `App.tsx` now always
passes). Pruning is skipped under `preferExactMatches` with tier data (see 7). Covered by
`candidate-pruning.test.ts`: a property test comparing top-k objective values with and without
pruning across random instances that exercise every dominance dimension. Each dimension was
mutation-checked (dropping it from the rule makes the property fail).

**Measured end to end, real engine, 5 results, production time box:**

| Query (default ranking) | Before                          | After                                                                 |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------- |
| 4-skill                 | 84s                             | **2.6s**                                                              |
| 17-skill end-game       | ~26s first result, ~2 min for 5 | **12.7s** for 5 (all 5 share one armor set, see the duplicates note)  |
| 17-skill sword (hard)   | nothing within the 90s box      | 3 results at 30s each (time-boxed, 0 open slots vs. a true best of 1) |

The hard query is still time-boxed in the per-slot layout. Only approach 3 (pooled decorations)
fixes it (prototype: valid build in 1.1s, proven optimal in 26s).

**`preferExactMatches` (exact mode), 1 result, measured:**

| Query    | Today's engine (strict mode, 300s box)                           | Prototype: pooled decorations + "clean" as hard constraints + fast pool |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 4-skill  | 90.4s, clean, 14 open                                            | clean, 14 open at **0.3s**; proven at 30s                               |
| end-game | **gave up at 300s**, returned a build with 3 active bonus skills | clean, 5 open at **2.8s**; reported proven at 46s                       |
| sword    | hit the 300s box; clean, 1 open                                  | clean, 1 open at **3.7s**; proven at 20s                                |

See 7 for what this prototype is and why it matches strict mode's semantics.

## Where the time goes (measured)

- **Model size.** Per armor slot: 12,188-12,946 candidates, all handed to HiGHS (the only filters
  are category/hunter-type/exclusions). Relevant decorations: 161 (4-skill), 616 (end-game), 1,048
  (sword). The per-slot one-hot decoration encoding multiplies that by 5 slots x up to 4 counts.
  End-game model: 74,037 columns, 3,107 rows, 213k nonzeros.
- **Root-node solves.** 4-skill and end-game both finish at node 1. All the time is the LP.
- **Multi-result rounds re-solve from scratch.** 5 results for the 4-skill query took 84s
  (12/12/12/24/24s). HiGHS doesn't warm-start branch-and-bound between rounds.
- **Duplicate results.** Result #3 of that run was result #2 with the same decoration moved from
  the legs to the chest. The no-good cut forbids the exact column set, and a decoration in a
  different slot is a different column, so the solver happily pays a full re-solve to return a
  permutation. Result #4 swapped one decoration for another with the same requested points and the
  same bonus total.
- **Slot symmetry on hard queries.** A decoration has identical skill points and objective cost in
  every slot; only capacity differs. Every feasible build has many equivalent placements, so the
  search tree is many copies of the same subtree. That's why the per-slot model, even after
  pruning, couldn't prove anything on the sword query in 300s while the pooled model closed it.
- **Data crosses the worker boundary every search.** `SearchRequestMessage.slots` structured-clones
  ~62k candidate objects per search. Small next to the solve today, but it's dead weight on weak
  machines once solves are fast.

## Approaches

Ordered roughly by payoff over cost.

### 1. Prune dominated armor per slot before building the model (exact)

A piece `c` is dominated by `c'` in the same slot when `c'` has at least as many points in every
requested skill, at least as many open slots, and at least as good an objective contribution. Any
build using `c` can swap in `c'` and stay feasible and at least as good. With multiple ranked
results, the safe rule is **k-dominance**: drop `c` only if at least `k` other pieces dominate it,
where `k` = number of results requested. Each dominator yields a distinct, at-least-as-good build,
so `c` can never reach the top `k`. Ties at the k-th rank are broken arbitrarily, which is already
true today.

- **Measured:** 62k → 283 (4-skill), 3,290 (end-game), 3,975 (sword) candidates at k=5. At k=50:
  1,820 / 12,628 / 8,827. Pruning cost: 30-500ms in JS. The end-game at k=50 still solves exactly
  in 3.0s.
- **What "dominates" must include** (or the pruning becomes inexact): every row a candidate feeds.
  Requested skills `>=`. Optional skills `>=`. Requested resistance floors `>=`. Excluded-active
  skills need _equal_ points, because those rows are two-sided. Open slots `>=`. Then the objective
  terms: default-mode bonus points, the preferred-piece flag, and preferred-category membership
  (`c'` must count toward every preferred category `c` counts toward). Pinned slots are a single
  candidate, so pruning skips them.
- **Tradeoff / limitation:** `preferExactMatches` breaks this. Its penalty depends on each bonus
  skill's _total_, which isn't monotone in any one piece's points, because a negative piece can
  cancel a positive one. Requiring an identical bonus-skill vector prunes almost nothing (~57k
  survive). A sign-aware rule (smaller-magnitude points is safe for skills that only ever appear
  with one sign) still keeps ~52-55k, because ~70 of ~200 bonus skills appear with both signs. Exact
  mode needs its own answer (see 7).
- **Effort:** small. A pure pre-filter in `engine.ts` before `buildModel`. It's property-testable
  against the unpruned model on small synthetic data with `fast-check`, which this repo already
  uses.

### 2. Prune dominated decorations (exact once decorations are pooled)

Same rule for decorations: no larger slot size, `>=` on every requested/optional skill, equal on
excluded skills, and a better-or-equal objective. With integer counts (approach 3) a decoration
can be reused freely, so plain 1-dominance is exact for every rank.

- **Measured:** 161 → 9, 616 → 55, 1,048 → 235 decorations.
- **Tradeoff:** under the _current_ per-slot binary encoding, this also removes "same armor, a
  slightly worse decoration" from lower ranks. That's arguably desirable (see the duplicate-result
  finding above). Same `preferExactMatches` caveat as approach 1.

### 3. Pool decorations across slots instead of assigning them per slot (exact)

Replace "how many of decoration D in slot S" (one-hot, per slot) with one integer "how many of D in
the whole build." Placement feasibility stays exact with three aggregate rows. Decorations are
sizes 1-3 and pieces hold 0-3, so a multiset of decorations fits the chosen pieces iff:

- (number of size-3 decorations) ≤ (chosen pieces with 3 open slots)
- (number of size-2 or size-3 decorations) ≤ (chosen pieces with ≥2 open slots)
- (total decoration size) ≤ (total open slots)

Sufficiency: put size-3s in 3-slot pieces, size-2s in the remaining ≥2-slot pieces (2-slot pieces
first), then size-1s fill whatever is left. The real data is 2,626 size-1, 30 size-2, and 2 size-3
decorations, so this is almost always just "count ≤ open slots." The per-slot placement for
display is recomputed afterwards by that same greedy rule.

- **Measured:** the decisive change for the hard sword query (above). The end-game model drops to
  25 rows.
- **Consequences / decisions needed:**
  - Results become **distinct by gear set** (armor + weapon + cuffs), each with its best decoration
    fill. That kills the permutation duplicates. The no-good cut then only touches candidate/cuff
    binaries. If "same armor, different decorations" should ever be a separate result, the counts
    would need a binary expansion again, which brings back some of the cost.
  - `pinnedSlotDecorations`: filter that slot's candidates to ones that can hold the pin, add the
    pin's points as a constant, and treat that slot's remaining capacity as the bin. Still exact.
  - Weapon slots are just one more bin. Cuffs are already a separate pool and are unaffected.
  - The decode (`decodeSolution`) and the shared-link `BuildResult` shape need a placement step.
    Display-only; no change to what's valid.

### 4. Make "optimal" actually mean optimal: gap tolerances (exact, nearly free)

HiGHS stops when the relative gap is ≤ `mip_rel_gap`, default **1e-4**, and the engine never
changes it. With objectives in the 10^5 range, that's a few bonus points. **Measured:** two
prototype runs stopped at objective 100183 vs bound 100192, and at 10055 vs bound 10056, both
"optimal" by HiGHS's definition but not proven. Worse, once a preferred piece is used the
objective is ~10^9 (`PREFERRED_ITEM_WEIGHT`), so the tolerance becomes ~10^5. That's **ten open
slots' worth**, meaning today's engine can legitimately return a build several open slots worse
than the best one whenever preferred pieces are in play.

- Fix: `mip_rel_gap = 0`, `mip_abs_gap = 0.99` (every objective coefficient is an integer).
- **Measured cost:** none on the pruned/pooled models (end-game 1.18s vs 1.16s). The sword query
  needed 26s for a full proof vs 24.8s stopping at the default tolerance.
- Related: the 1 / 10^4 / 10^6-6.4x10^7 / 10^9 weight hierarchy spans 9 orders of magnitude, which
  shows up as float noise in the objectives (e.g. 100183.00000002861). See 5 for the clean
  alternative.

### 5. Lexicographic objectives for the long tail (tradeoff between rigor and speed)

On the sword query, a valid build appears at 1.1s and proving the open-slot count optimal takes
5.8s (bound 19,990 < 20,000). The remaining ~20s goes to proving no build exists with _one more
incidental bonus point_, the lowest-priority tiebreaker.

Options:

- **a. Fully exact** (approach 4). Worst case so far 26s on the dev machine. Typical queries ~1s.
- **b. Exact on every tier that matters, best-effort on bonus points.** Set `mip_abs_gap` just
  under `OPEN_SLOT_WEIGHT`, or solve in stages. Measured 5.8s on the sword query. Preferred pieces,
  optional skills, and open slots stay provably optimal; bonus points may be a few short.
- **c. HiGHS native lexicographic multi-objective.** The `highs` package exposes
  `LinearObjectiveInput` with priorities. It replaces the big-M weight hierarchy with real
  priority levels and per-level tolerances, so each tier gets a clean, well-scaled objective.
  This is the principled version of b; it needs a measurement before committing to it.

### 6. Cheaper multi-result rounds

After 1-3, each round is a small model, so the existing re-solve loop is already cheap (sub-second
for typical queries). Further options, in decreasing value:

- Feed round _r_'s other improving incumbents (`mipImprovingSolution` callback) into round _r+1_
  via `setSolution`. They're feasible for the next round unless they're the excluded build, which
  gives HiGHS an immediate incumbent and earlier pruning.
- Bound round _r+1_'s objective by round _r_'s value. Low value: the LP bound already implies it.

### 7. `preferExactMatches` (exact mode) needs its own plan

Measured on 2026-10-26. What doesn't work, and why:

- **Armor pruning (approach 1) can't be made strong.** The penalty depends on each bonus skill's
  _total_, and another piece's negative points can cancel a positive one, so swapping a piece is
  only safe when its bonus points match or provably don't matter. The best sound rule found clips
  each bonus skill to the range the rest of a build can reach. It still kept 36k-49k of ~62k pieces
  and cost 10-13s, a net slowdown, so it isn't shipped. About 70 of ~200 bonus skills appear with
  both signs, which is what defeats it.
- **LP reduced-cost fixing** (drop any piece whose LP bound can't beat a known build) is too weak
  at the root. The root LP overestimates by about 4 open slots (138,202 vs. 99,997 on the
  end-game), mostly because fractional decorations round away per-skill deficits.
- **A warm start alone doesn't help.** Even handed the optimal build, the full per-slot model
  still spends ~40s in presolve and root cut rounds before it can prove anything.

Where exact mode's time actually goes (HiGHS log, end-game, full model): 11.8s presolve, ~26s of
root cut rounds over 41k columns, a heuristic finds the optimum at 45.6s, and then HiGHS's _own_
reduced-cost fixing discards 97% of columns and finishes in about a second. So the solver's
pruning is strong once it has a good build and a cut-strengthened bound. The expense is getting
there on a model this size.

**What works (prototype, `pooled-exact.ts` in the scratchpad):**

1. **Pool decorations across slots (approach 3).** Exact for exact mode too. Full exact-mode solve
   drops from 46.7s to 24.8s on the end-game (3,502 rows → 420).
2. **Model strict mode's "clean" rule as hard constraints.** Today, `runTimeBoxed`'s strict mode
   finds an optimal build, cuts it out if any bonus skill is active, and re-solves. That's
   potentially hundreds of rounds, and is why the end-game gave up at 300s. Strict mode's
   semantics are "the best build with no bonus tier active, if one exists," which is exactly the
   model with each bonus skill's total bounded to its inactive band (no indicator columns, no
   big-Ms, no cut loop). If that model is infeasible, fall back to today's penalty model. Tighter
   LP, one solve.
3. **Fast answer from a pruned pool, then proof on the full model.** Solve the same exact-mode
   model on a pool pruned with the default rule (objective without bonus points, k=20; this is a
   heuristic for exact mode, not a guarantee). On all three queries it found the true optimum in
   0.3-3.7s. The full model then proves it in 16-43s. The UI could show the answer immediately as
   "verifying..." and confirm (or replace) it when the proof completes. Players get the answer in
   seconds, and the guarantee is never given up, only delivered later.

Open question: the end-game "clean" proof reported optimal with a dual bound of 56,000 against an
objective of 50,000. Confirm the proof status carefully during implementation before trusting it.

### 8. Keep the data bundle resident in the worker

Load the bundle once inside the worker and send only the query (filters, pins, requirements).
This saves a large structured clone per search. Minor on the dev machine, more noticeable on
low-end ones. Independent of everything above.

### 9. Parallel portfolio across Web Workers (reserve option)

Run 2-4 workers with different `random_seed`s and take the first proof. This trims heavy-tailed
runtimes but gives little on 2-core machines, and memory scales with worker count. Only worth it
if hard queries remain slow after 1-5. A partitioned search (split one slot's candidates across
workers, merge top-k) scales better but is more work.

### Not recommended

- **Custom branch-and-bound / returning to Pareto frontiers.** The old engine's frontier explosion
  is documented (`engine.ts`). Once the model is small, HiGHS's presolve and cutting planes beat
  anything hand-rolled here.
- **Multi-threaded HiGHS WASM.** Needs `SharedArrayBuffer`, which needs cross-origin-isolation
  headers that GitHub Pages can't set (a service-worker shim exists, but it's fragile). HiGHS's MIP
  parallelism is modest anyway.
- **Server-side solving.** Breaks the static GitHub Pages hosting model.
- **Another solver.** No maintained JS/WASM build of CP-SAT; nothing else clearly beats HiGHS for
  this shape once the model is right.
- **Larger time boxes.** Already rejected in `engine.ts` for good reasons, and unnecessary once
  solves are short.

## Suggested order

1. ~~Approaches 1-4 and section 7.~~ Shipped 2026-10-26.
2. Re-measure on a throttled/low-end machine.
3. The exact-mode verification pass (~30s per result on the full model) is now the slowest common
   path. Candidates: a tighter certificate than the bonus-free ceiling, or verifying fewer than all
   results.
4. The default-ranking bonus-point tail on hard queries (approach 5, options a/b/c).
5. Approach 8 opportunistically; approach 9 only if needed.

## Reproducing the measurements

Prototype harness (not part of the repo; research only):
`C:\Users\Toph\AppData\Local\Temp\claude\C--Users-Toph-Documents-Frontier-Set-Searcher-FrontierSetSearcher\5dce85b7-2858-4963-a8a7-f40e0e24a6ff\scratchpad\profile.ts`.
Run from `frontend/` with
`node node_modules/vite-node/dist/cli.mjs <path> -- <four|endgame|sword> <variant> <seconds> <k>`.
The variant flags combine: `prune`, `decoprune`, `agg`, `exact`, `slotgap`, `log`.
It only covers the default ranking mode with no cuffs, pins, or preferences. The same folder has
`measure.ts` (real engine end to end), `exactlog.ts` (HiGHS log for a full exact-mode solve), and
`pooled-exact.ts` (the exact-mode prototype in 7: `<query> <seconds> quiet <poolK> <penalty|clean>`).
