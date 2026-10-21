# Frontier Set Searcher — Top-Level Project Plan

## 1. Problem statement

Monster Hunter Frontier has on the order of 10,000 equipment pieces (armor, weapons,
charms, decorations), each carrying multiple attributes (slots, defense, rarity,
level/rank availability, and — most importantly — skill point contributions).
Building an optimal armor set means searching combinations of pieces (+ decorations
placed into open slots) that hit specific skill-point thresholds, optionally under
extra constraints (slot counts, unlock level, piece type, etc.).

The existing tool for this (a C#/WinForms app, `Armors.csv`-driven, no documented
algorithm) takes **hours** to produce results and presents them poorly. Our goals:

1. **Correctness**: never miss a valid combination, never return an invalid one.
2. **Speed**: results in seconds, with the best/most-flexible combinations
   (extra skills, extra open slots) surfaced first, converging toward
   exact-threshold matches — i.e. an *anytime* search that streams results.
3. **Usability**: a real web UI, not a CSV dump.
4. **Maintainability**: the data source (wiki) changes over time; re-crawling and
   re-validating must be cheap and safe.
5. **Built test-first**, with every layer (crawler, DB, search engine, API,
   frontend) covered by automated tests before/alongside implementation.

## 2. Prior art and the confirmed data source

**Confirmed source** (provided by you):
`https://xl3lackout.github.io/MHFZ-Ferias-English-Project/` — an English
translation (hosted on GitHub Pages) of the Japanese fan site
`ferias.life.coocan.jp`. Inspecting it directly changes the crawler design for
the better:

- It's a **late-90s/2000s-style frameset site** (`left.htm` nav + content
  frame), not a modern per-item wiki page. Navigation pages like
  `bougu/tree.htm` just show set hierarchies (base → F → FX → HC → HS upgrade
  chains) as text with in-page anchors (`#h013F`, `#b011C`, ...) — no stats
  visible there.
- **The actual equipment data lives in large embedded JS data files**, not
  server-rendered HTML per item. E.g. `skill/equip.js` (~11 MB) is a single
  script making calls like `SkillForm.setEquip("head", { "0001": "Leather
  Helm,0,0,1,,0,0,0,...,<flavor text>,0", ... })` — one call per piece-type
  bucket (`head`, `body`, `arm`, `wst`, `leg`, `deco`, `sozai`, plus `jpg`/
  `zeny`/`def`/`slot` side tables), each value a **positional,
  comma-delimited string** packing name, defense, slot count, per-skill
  point values, rarity, zenny cost, crafting material refs, and Japanese
  flavor text, keyed by a 4-hex-digit ID.
  There's a similar `bougu/tree.js` for set relationships and
  `sozai/item.js` for materials.
- **Consequence for Phase 2**: this is much better news than a normal
  scrape-10,000-rendered-pages job. The real work is (a) fetching a handful
  of large static files instead of thousands of HTML pages, and (b)
  **reverse-engineering the positional column schema and the skill-code
  legend** (which column index means which skill, and how its point value is
  encoded — needs cross-referencing against `skill/skillsimu.htm` /
  `skill/skillno.htm` and manual verification against a few known items).
  That reverse-engineering is itself a TDD-friendly task: write down the
  expected decoded fields for a handful of hand-verified items first, then
  build the parser to satisfy those fixtures.
- **Licensing note**: no README/LICENSE was found for the translation repo
  beyond "this is an English translation of \[the Japanese site]." Fine for a
  personal/non-commercial tool; worth re-checking if this project is ever
  published or its data redistributed (see Open Questions, §11).

**Related tools found while researching** (context, not dependencies):

- **`matthe815/mhfz-ass`** (GitHub, C#/WinForms, ships an `Armors.csv`): this
  is almost certainly (or shares lineage with) the "current software" that
  takes hours. No documented algorithm or performance notes. Useful only as a
  secondary cross-check for our parsed data (diff against its CSV for
  overlapping pieces), not something to build on top of.
- **`DorielRivalet/wycademy`**: an open-source MHF-Z knowledge base using
  Supabase/Postgres. Since we now have direct access to the real structured
  source data above, this is no longer a likely shortcut — worth a brief
  look only if the reverse-engineered schema turns out to be harder than
  expected.

## 3. Guiding principles

- **Test-driven, every layer.** Red-green-refactor for parser functions, DB
  repository methods, search algorithm correctness, and API handlers. UI gets
  component tests + a thin layer of end-to-end tests over the real stack.
- **No test ever depends on live network access.** The crawler is tested against
  recorded HTML fixtures. This keeps the suite fast, deterministic, and immune to
  upstream site changes breaking CI.
- **Data correctness is a first-class deliverable.** Scraped data is validated
  (schema + plausibility checks) before it reaches the database. A bad scrape
  must fail loudly, not silently corrupt the search results.
- **Design the algorithm before scaling the data.** The search/optimization
  engine is the highest-risk, highest-value component (it's *why* the existing
  tool is bad). It gets a dedicated spike with synthetic data and a benchmark
  target before we wire it to the full 10k-item dataset.
- **Incremental, demoable phases.** Every phase ends with something runnable,
  not just code committed.

## 4. Architecture overview

**Decided**: fully static deployment on GitHub Pages (§8/§11). There is no
production server and no live database — the search runs entirely in the
user's browser. This splits the system into an **offline pipeline** (runs on
your machine / in GitHub Actions, produces a data bundle) and an **online
app** (pure static site, GitHub Pages):

```
OFFLINE — your machine / GitHub Actions (never shipped to users)
┌───────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐
│  Fetcher  │──▶│   Parser +   │──▶│ SQLite (ETL     │──▶│  Static data       │
│ (httpx,   │   │  Validation  │   │ staging: joins, │   │  export — JSON/    │
│ saves raw │   │  (pydantic)  │   │ dedup, diffing  │   │  binary bundle,     │
│ JS files) │   │              │   │ against last     │   │  versioned,         │
└───────────┘   └──────────────┘   │ published data) │   │  committed/published│
     ▲ fixtures for offline tests  └─────────────────┘   └──────────┬──────────┘
                                                                     │
ONLINE — GitHub Pages (fully static, nothing runs server-side)      │
                                          ┌──────────────────────┐  │
                                          │  React/TS frontend     │◀┘
                                          │  (skill picker, result  │
                                          │  list, streamed output) │
                                          └───────────┬───────────┘
                                                       │ postMessage
                                          ┌───────────▼───────────┐
                                          │  Search engine, run in   │
                                          │  a Web Worker (TS first;  │
                                          │  Rust→WASM only if a      │
                                          │  Phase 3 benchmark shows  │
                                          │  it's needed)             │
                                          └──────────────────────┘
```

Python/SQLite only ever run offline. The only artifact that crosses from
offline to online is the static data bundle — at query time there is nothing
to call, no server, no database round trip; the Web Worker keeps the heavy
combinatorial search off the UI thread.

## 5. Technology choices and rationale

| Concern | Choice | Why |
|---|---|---|
| Fetcher & ETL | Python 3.12, `httpx` (plain file fetches, not HTML scraping — see §2) | Fast to write parsers for the positional/custom data format, huge ecosystem, easy to unit-test pure functions |
| Data validation | `pydantic` v2 | Schema validation at the ETL boundary; the same field definitions double as documentation of the reverse-engineered column schema |
| ETL staging store | SQLite, accessed via plain `sqlite3`/SQLAlchemy core | No server to run — it's a file. Enough relational power for joins/dedup/diffing while building the export; since nothing in production talks to a database anymore, Postgres would be unnecessary operational weight |
| Data export format | Versioned static JSON (or a compact binary, e.g. MessagePack, if size/parse-time benchmarks demand it) | This is the only artifact that crosses from offline ETL to the online app — needs to be small (GitHub Pages serves gzip/brotli automatically) and fast to parse in-browser |
| Search engine | TypeScript first, hand-written bitmask/DP + branch-and-bound (see §6), run in a Web Worker; Rust→WASM considered only if a Phase 3 benchmark shows TS isn't fast enough | Keeps one language (TS) across frontend+engine unless proven necessary to drop to WASM — avoids a second toolchain by default, per the "benchmark before you scale complexity" principle in §3. **Superseded, see the status note at the top of §6.** |
| Correctness oracle (dev-only) | A small Python brute-force/`ortools` CP-SAT script, used offline to generate expected results for test fixtures | Never shipped; exists purely so the TS engine's test suite has a trustworthy "ground truth" to compare against on representative cases |
| Frontend | React + TypeScript + Vite, TanStack Query (for loading the static data bundle) | Component-testable, large ecosystem; keep the already-vendored Bootstrap for styling, revisit Tailwind if Bootstrap gets in the way (no functional impact either way) |
| Hosting | GitHub Pages, built by a GitHub Actions workflow on push | Free, matches the "ease of hosting" goal, no server to keep alive or pay for |
| ETL/engine tests | `pytest` + `hypothesis` (Python, offline pipeline); Vitest + `fast-check` (TS, property-based tests for the search algorithm's correctness invariants) | "Never return a set that fails the constraints" / "never omit one that satisfies them" are properties, not examples — worth property-based testing on both sides of the language split |
| Frontend tests | Vitest + React Testing Library (unit/component), Playwright (e2e against the built static site) | Standard, fast, CI-friendly; e2e runs against `vite preview` or the actual Pages build, no backend to stand up |
| CI/CD | GitHub Actions: test → build → export data bundle → deploy to GitHub Pages; a separate scheduled workflow re-runs the fetch/parse step and opens a PR with any data diff for review | Free for this scale; keeps data updates reviewable rather than silently auto-publishing (see §10 risks) |
| Lint/format | `ruff` + `mypy` (Python), `eslint` + `prettier` (TS) | Enforced in pre-commit + CI |

## 6. The search algorithm (the hard part)

> **Status note:** the bitmask/DP + branch-and-bound + meet-in-the-middle design
> below is the original plan, kept here as a historical record — it was built,
> then replaced. That Pareto-dominance approach hit a real "curse of
> dimensionality" wall once many skills are requested at once (a single
> decoration-filling sub-problem's frontier grew from 294 to 32,093 entries
> between adjacent slot capacities on a real ~17-skill query, and the search
> never completed). The engine now formulates the whole query as a single
> mixed-integer program and solves it with [HiGHS](https://highs.dev/)
> (WebAssembly build) — see
> [`frontend/src/search-engine/engine.ts`](../frontend/src/search-engine/engine.ts)'s
> module docstring for the current algorithm, including how multiple ranked
> results and per-round time-boxing work.

This is the component responsible for the "hours → seconds" improvement, so it
gets a dedicated design pass and its own spike (Phase 3) before full integration.

**Problem shape**: choose at most one piece per equipment slot (head, chest, arms,
waist, legs, weapon, charm) plus decorations placed into each piece's open
slots, such that the summed skill points meet or exceed the user's requested
thresholds, subject to extra constraints (level/rank availability, minimum open
slots remaining, specific piece exclusions, etc.). This is a variant of
multi-dimensional knapsack / exact-cover with bonus objectives — NP-hard in
general, but very tractable in practice because:

- The number of *distinct* skills that matter to a given query is small
  (typically < 10), so skill-point vectors can be represented as small integer
  tuples or packed into machine words, not sparse maps.
- Each equipment slot (head/chest/arms/waist/legs/weapon/charm) has a bounded
  number of realistic candidates after filtering by the query's hard
  constraints (level, type), which prunes the search space drastically before
  combination even starts.

**Planned approach**:

1. **Filter** candidate pieces per slot by hard constraints (level/rank, type)
   — this alone should cut 10,000 pieces down to a few hundred per slot per query.
2. **Vectorize** each candidate's skill contribution as a fixed-size tuple over
   only the skills relevant to the query.
3. **Branch and bound across slots** (head → chest → arms → waist → legs →
   weapon → charm → decorations), maintaining a running skill vector and
   pruning any branch whose *best possible remaining contribution* (precomputed
   per remaining slot) cannot reach the threshold.
4. **Meet-in-the-middle**: split the 7 slots into two halves, enumerate/bucket
   each half's achievable skill vectors, then join — turns an exponential
   enumeration into two smaller exponentials plus a join, which is the
   standard trick for this class of problem and is what makes "search all
   combinations" tractable at this scale.
5. **Anytime/streaming output**: emit results ordered by "surplus" (extra
   skill points / extra open slots beyond the requirement) first, falling back
   to exact-threshold matches — the UI can start rendering before the full
   search completes, and a user can cancel once satisfied.
6. **Correctness oracle**: for small synthetic datasets, cross-check results
   against a brute-force enumeration and an `ortools` CP-SAT model, run
   offline in Python to generate fixtures; the TS engine's own test suite
   (Vitest + `fast-check` for property-based cases) asserts against those
   fixtures plus its own invariants.

Performance target to validate in the Phase 3 spike: sub-5-second first-results
for a typical query against the full dataset, full enumeration for a bounded
query under ~30s, on a single consumer machine — i.e., not reliant on
server-farm horsepower.

## 7. Data model (first cut — refined by tests in Phase 1)

- `Equipment`: id, name, type (head/chest/arms/waist/legs/weapon/charm),
  rarity, defense, slot_count, min level/rank/quest availability, source URL
  (for provenance/re-crawl diffing).
- `Skill`: id, name, category.
- `EquipmentSkill`: equipment_id, skill_id, points (many-to-many).
- `Decoration`: id, name, slot_size required.
- `DecorationSkill`: decoration_id, skill_id, points.

This shape lives in the offline SQLite staging store while building/validating
the data, and is **flattened into the static export bundle** (e.g. one JSON
file per piece-type, plus a skills lookup table) that the frontend downloads.
Builds/results are always **computed on demand in the browser**, never
persisted — there's no server-side cache to speak of; if a future need for
caching repeated queries shows up, `localStorage`/IndexedDB in the browser is
the right place for it, not a backend (there is no backend).

## 8. Phased delivery plan

Each phase ends with a demo-able artifact and a passing test suite; nothing
moves forward on red tests.

**Phase 0 — Project scaffolding**
- Repo layout (see §9): `/etl` (Python) and `/frontend` (TS, houses both the
  UI and the search engine), pre-commit hooks, a GitHub Actions CI skeleton
  that runs (empty) test suites for each package. No Docker/Postgres needed —
  SQLite is just a file.
- Exit criteria: `pytest` and `vitest` both run green on an empty repo, in CI.

**Phase 1 — Data model**
- Write schema/constraint tests first (e.g., "an EquipmentSkill row requires
  an existing Equipment and Skill"), then the SQLite schema (plain SQL
  migration scripts, or a lightweight tool like `sqlite-utils`/SQLAlchemy
  core — no need for a full Alembic setup for a single-file ETL-time store)
  to satisfy them.
- Exit criteria: schema applies cleanly from scratch; repository/query layer
  has unit tests against a real (temp-file) SQLite database.

**Phase 2 — Fetcher & parser** (not a classic page-by-page crawler — see §2)
- Save local snapshots of the handful of relevant files (`skill/equip.js`,
  `bougu/tree.js`, `sozai/item.js`, plus the skill-legend pages) as fixtures.
- Reverse-engineer the positional column schema: hand-decode a small, diverse
  set of known items (e.g. a few from each piece type/rarity tier) into
  expected structured records *first*, then write the parser to satisfy those
  fixtures (classic TDD — the fixtures ARE the spec here, since there's no
  documented format).
- Decode the skill-code legend (cross-reference `skill/skillsimu.htm`/
  `skill/skillno.htm`) into a `Skill` lookup table.
- Add a thin, polite fetch layer (caching the raw files to disk, re-run
  idempotency, conditional re-fetch via ETag/Last-Modified) — tested via a
  mocked HTTP layer, separate from parsing logic.
- Exit criteria: running the fetch+parse pipeline against the real site
  (manually, not in CI) populates the database with a full, validated
  equipment set; parser unit tests run offline in CI against saved fixtures
  only, with no network access required.

**Phase 3 — Search engine spike** (TypeScript, runs via Node for the spike —
wiring into a Web Worker happens in Phase 4)
- Build the algorithm from §6 against small synthetic datasets first, with
  `fast-check` property-based tests plus the Python-generated oracle fixtures
  proving correctness.
- Benchmark against the full real dataset from Phase 2 (exported to a plain
  JSON fixture for this spike); tune pruning until the performance target is
  met, in a Node environment representative of a browser's JS engine.
- Exit criteria: a small Node CLI that takes a query (skills + constraints)
  and prints ranked results within the performance target, with a test suite
  proving no missed/invalid combinations on representative cases.

**Phase 4 — Data export & client integration**
- Build the ETL→static-bundle export step (versioned JSON, chunked by piece
  type so the initial page load is small), and load it in the frontend.
- Move the Phase 3 search engine into a Web Worker behind a small typed
  message-passing interface (request a query, receive a stream of ranked
  results); validate the interface with its own unit tests (no DOM needed).
- Exit criteria: the frontend can load the real exported data and run a query
  end-to-end in the browser, off the main thread, within the performance
  target.

**Phase 5 — Frontend UI**
- Skill picker, constraint inputs (open slots, level cap, etc.), streaming
  results list ranked best-surplus-first, result detail view (which pieces +
  decorations).
- Component tests per interactive piece; Playwright e2e for the full
  "pick skills → get results" flow against the actual built static site
  (`vite preview` or a real Pages deploy) in CI — no backend to stand up.
- Exit criteria: a usable, demoable website end to end.

**Phase 6 — Hardening, CI/CD & ops**
- GitHub Actions workflow: test → build → export data bundle → deploy to
  GitHub Pages on push to main.
- Separate scheduled workflow re-runs the fetch/parse step, diffs the result
  against the last published bundle, and opens a PR with the diff for human
  review rather than silently auto-publishing changed data.
- Exit criteria: a documented runbook for "the source site changed, how do we
  safely refresh and re-publish the data."

## 9. Repository structure

```
/etl                     Python package: fetch + parse + validate + SQLite + export
  /fixtures              Recorded source files + hand-verified expected records
/frontend                React + TS app (Vite)
  /src/search-engine      The search algorithm + Web Worker wrapper (own test suite,
                           no React/DOM dependency — stays independently testable)
  /src/components          UI
  /public/data             Published static data bundle (generated by /etl, not
                           hand-edited)
/docs                     This plan, ADRs, data-source/schema notes, runbooks
/.github/workflows        CI (test+build+deploy) and the scheduled re-crawl workflow
```

No `docker-compose.yml` is needed — SQLite is a file, and there's no backend
service to containerize. (The existing vendored `css/`/`js/` Bootstrap assets
move under `/frontend` once the scaffold exists in Phase 5.)

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Source site's HTML structure changes or is inconsistent across equipment types | Fixture-based parser tests catch regressions immediately; validation layer rejects malformed records instead of silently storing garbage |
| Combinatorial explosion even after pruning | Phase 3 is an isolated spike with a hard benchmark gate before any integration work proceeds |
| Scraped data has errors the wiki itself has (bad skill values, typos) | Cross-check sample against `mhfz-ass`'s `Armors.csv` and spot-check manually; keep source URL per record for manual verification |
| Crawling is impolite/overloads the site | We're fetching a handful of large static files, not thousands of pages — still cache locally, use conditional requests, and run it manually/on a schedule rather than continuously |
| Scope creep before the algorithm is proven | Phases are ordered so the highest-risk/highest-value piece (search engine) is validated in Phase 3, before frontend polish |
| Client-side search means performance varies with the user's device, unlike a controlled server | Runs in a Web Worker (keeps the UI responsive even in the worst case); the same benchmark-driven pruning from Phase 3 is validated against representative low-end hardware, not just the dev machine |
| Static data bundle could bloat page load as the dataset grows | Chunk the export by piece type/category and lazy-load on demand; rely on GitHub Pages' automatic gzip/brotli compression; revisit a binary format (MessagePack) only if JSON proves too large |

## 11. Decisions log

Resolved before Phase 0 starts:

1. **Data provenance/licensing**: personal use among friends, no official
   affiliation claimed by any fan tool/wiki in this space anyway — not a
   blocker. Revisit only if this project is ever published more broadly or
   the parsed dataset itself is redistributed.
2. **Deployment target**: fully static on **GitHub Pages**. This means no
   backend/database in production — the search engine runs client-side in a
   Web Worker against a static data bundle produced by the offline ETL
   pipeline. This is reflected throughout §4–§10 above (architecture, tech
   choices, phases, repo structure, risks all updated accordingly).
3. **Frontend styling**: keep Bootstrap (already vendored in the repo) as the
   default; swapping to Tailwind later is a style-only change with no
   architectural impact, so it isn't decided now.

No open questions remain before starting Phase 0.
