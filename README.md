# Frontier Set Searcher

A fast armor/skill set searcher for Monster Hunter Frontier: pick the skills you want, and it
searches the full equipment catalog for builds that reach them, in seconds instead of hours. Runs
entirely in the browser — a static site with no backend. See [docs/PLAN.md](docs/PLAN.md) for the
full architecture and phased delivery plan — start there before making structural changes, and
[docs/skill-system-roadmap.md](docs/skill-system-roadmap.md) for the detailed history of every
feature below.

## Features

- **Combinatorial build search** over the full armor/decoration/cuff/weapon catalog, requesting any
  combination of regular and Zenith skills at specific levels, ranked by fewest unrequested
  ("bonus") skills first or most bonus points first. See
  [How the search works](#how-the-search-works) below for the full priority order and the
  multi-pass process behind a single search.
- **Optional, prioritized skills** — alongside hard "Required" skills, request up to 7 ranked tiers
  of soft preferences ("Option 1" through "Option 7") the solver tries to satisfy only after every
  required skill and every higher tier is met, without ever failing a search over them the way a
  missed requirement would.
- **Accurate game-rule modeling**, not just raw point totals: the active-skill cap (base 10, plus
  G-Rank-armor-piece and "Skill Slots Up" bonuses), per-skill tier crossing (including negative
  "penalty" tiers), Hiden/cuff and Exotic-armor cap exemptions, Blademaster/Gunner Hunter Type
  exclusivity, and an at-most-one-Hiden-cuff rule.
- **Pin specific gear** — force a particular armor piece (with chosen decorations), a decoration on
  its own, or a cuff into the result, with the rest of the build optimized around it.
- **Prefer specific gear** — name armor pieces or set a target piece-count per gear category that
  the solver should favor using, outranking any other difference in a build without forcing an
  exact slot the way pinning does.
- **Exclude specific gear** — rule out individual armor pieces, decorations, or cuffs by name, on
  top of broader category-level filters (gear level/rank, Poogie cuff tier, decoration tier); a pin
  always overrides an exclusion.
- **Hunter Type, weapon Zenith skill, and weapon slot controls**, G-Rank/Hiden/Exotic/etc. category
  filters for armor, cuffs, and decorations, a configurable number of ranked results, and a
  sortable/filterable reference table for every item in a gear category.
- **Shareable build links** — a generated link fully reproduces one exact result (including all its
  picks, decorations, and cuffs) without re-running the solver, and can be used as the starting
  point for a new search. Each result can also be saved or copied as an image (always rendered in
  its desktop layout, regardless of the device that made it) or copied as plain text.
- Search inputs persist across page reloads (`localStorage`), and the form remembers per-section
  state in a collapsible, searchable UI.

## How the search works

Every search is formulated as a single [mixed-integer program](https://en.wikipedia.org/wiki/Integer_programming)
(one "choose a piece per slot, plus which decorations to place" problem, covering every armor
slot, the weapon, and cuffs at once) and solved with [HiGHS](https://highs.dev/). Every skill
marked "Required" — at whatever level you set — is a hard constraint: a result is never shown
unless it genuinely reaches every one of them. Everything else below is a *preference* the solver
ranks results by, not a requirement it can fail to meet.

### What gets prioritized, and in what order

When more than one valid build exists (almost always), the solver picks the single best one
according to this strict pecking order — each tier below completely outranks everything beneath
it, so a build that's better on tier 2 always wins over one that's only better on tier 3, no matter
how much better:

1. **Preferred pieces and categories.** A build using one of your named "Preferred pieces", or
   meeting a preferred category's target piece count, always outranks one that doesn't — even a
   build that's otherwise worse in every other way.
2. **Optional skills, by their own priority.** "Option 1" skills are satisfied before "Option 2"
   skills, which are satisfied before "Option 3", and so on through "Option 7" — satisfying even
   one higher-priority option always outweighs satisfying every lower-priority one combined.
   Skills sharing the same option number are interchangeable: satisfying any one of them counts
   the same as satisfying all of them.
3. **Leaving decoration slots open.** Among builds tied on everything above, the solver favors
   using fewer decorations and leaving more slots free for your own later use — it only spends a
   slot when a requirement, an optional skill, or a preferred piece actually needs it.
4. **Bonus skills** — skills your build ends up with that you didn't ask for. This tier works one
   of two ways, depending on the "Prefer exact matches" toggle:
   - **Off (more bonus points):** the solver rewards raw bonus skill points, so among otherwise-tied
     builds it favors the one picking up the most incidental extra skill value.
   - **On (fewest bonus skills, default):** the solver instead penalizes each *distinct* bonus skill
     that ends up active at all, regardless of how many points it has — so a build with zero
     unrequested skills always ranks above one with any, and among the rest, fewer unrequested
     skills always beats more. A clean build with no bonus skills active is proven to be the actual
     best such build, not just the first one found.

The active-skill cap (how many skills can be active on a build at once — a base of 10, plus bonuses
for G-Rank gear and Zenith's "Skill Slots Up") isn't part of this ranking at all: it's calculated
*after* a result comes back, purely to show you which of its skills the game would actually
disable, not to steer the search toward avoiding the cap in the first place.

### Getting more than one result

There's no way to ask a solver for "the top 5 answers" directly, so each additional ranked result
comes from solving again: find the best build, note down its exact combination of armor pieces,
weapon, and cuffs (not which decorations went where), forbid that exact combination, and solve
again for the next-best one. Results are distinct by *that* combination — the same gear with a
decoration moved to a different open slot never shows up twice.

### Time limits and "Search longer"

Each individual solve gets a time budget (30 seconds, tried twice) before settling for the best
build it's found so far rather than continuing to search for a better one. If a search comes back
completely empty, it's retried automatically once with a slightly bigger budget; if it's *still*
empty, a "Search longer" button offers a much larger one-time budget (several minutes) for queries
that are simply hard to prove one way or the other, instead of silently taking that long on every
search. If a shown result's round had to stop before HiGHS could *prove* it the best possible, it's
flagged as unproven — still a fully valid, correct build, just not guaranteed to be the best one
achievable.

### "Prefer exact matches" in more detail

With this on (the default), the search doesn't just penalize bonus skills in the ranking above —
it also checks its own answer: a quick first pass checks whether a result can already be proven
unbeatable (no bonus skills possible at all, given the requirements), which skips the slower
verification step entirely for most queries. The moment a result *can't* be proven that way, it's
shown once as an unconfirmed guess, and every result after it — that one included — is found and
confirmed by the slower, exact pass before the next spot is even attempted, rather than guessing
the whole list first and correcting it afterward.

## Technology

- **Frontend**: React 19 + TypeScript, built with Vite, styled with Bootstrap 5.3 plus a custom
  light/dark theme. Fetches a prebuilt static data bundle (`frontend/public/data/*.json`) — no
  server, no database.
- **Search engine**: runs as a mixed-integer program solved with [HiGHS](https://highs.dev/) (via
  its WebAssembly build), in a Web Worker so the UI stays responsive. See
  [How the search works](#how-the-search-works) above for the full process.
- **ETL pipeline**: an offline Python 3.12 pipeline (`httpx` + `pydantic` + `beautifulsoup4`) fetches
  and parses the source data, stages it in SQLite for validation/diffing, and exports the static
  JSON bundle the frontend ships with.
- **Testing**: Vitest + Testing Library + `fast-check` (property-based tests) for the frontend,
  Playwright for end-to-end coverage, and pytest + Hypothesis for the ETL pipeline; `oxlint`/
  `prettier` and `ruff`/`mypy` keep both sides linted and typed.
- **Hosting**: a fully static GitHub Pages deployment — every push to `main` builds and publishes
  automatically (see [docs/hosting.md](docs/hosting.md)).

## Feedback

Found a bug, or have an idea for a feature? [Open an issue](https://github.com/d0t-execute/frontier-set-searcher/issues/new/choose) — feature requests have their own template.

## Credits

- **[mertna](https://mertna.github.io/MHFZ-Skills/)** — skill-priority and active-skill-cap
  reference info and explanations this search engine's rules are built on.
- **[Ferias/xl3lackout](https://xl3lackout.github.io/MHFZ-Ferias-English-Project/)** — the
  equipment/skill/decoration data this project's ETL pipeline is built against.
- The makers and maintainers of **MHSX2G** — sanity checks, categorization, and a basis to work
  from.
- **[Nenrikido](https://github.com/Nenrikido/MH-Optimizer)** — whose Monster Hunter Wilds build
  optimizer (also solver-based) is what made framing this project's search as a solvable
  mixed-integer program possible in the first place.

Much of this project was built by or with the help of AI, in a strict test-driven-development
workflow.

## Layout

- `etl/` — offline Python pipeline: fetch the source data, parse it,
  validate it, and export a static data bundle for the frontend.
- `frontend/` — React + TypeScript app (Vite), including the client-side
  search engine that runs the actual combinatorial search in the browser.
- `docs/` — the project plan, ADRs, and runbooks.

## Development

**ETL (Python 3.12):**

```bash
cd etl
python -m venv .venv
.venv/Scripts/activate   # .venv/bin/activate on macOS/Linux
pip install -e ".[dev]"
pytest
ruff check .
mypy src tests
```

**Frontend (Node 24):**

```bash
cd frontend
npm install
npm run test
npm run lint
npm run format:check
npm run dev
```

**Pre-commit hooks** (ruff/format for Python, prettier/oxlint for the
frontend) run automatically on `git commit` once installed:

```bash
pip install pre-commit
pre-commit install
```
