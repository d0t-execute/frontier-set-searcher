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
  ("bonus") skills first or most bonus points first.
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
  point for a new search. Each result can also be exported as a downloadable image.
- Search inputs persist across page reloads (`localStorage`), and the form remembers per-section
  state in a collapsible, searchable UI.

## Technology

- **Frontend**: React 19 + TypeScript, built with Vite, styled with Bootstrap 5.3 plus a custom
  light/dark theme. Fetches a prebuilt static data bundle (`frontend/public/data/*.json`) — no
  server, no database.
- **Search engine**: the equipment-selection problem is formulated as a mixed-integer program and
  solved with [HiGHS](https://highs.dev/) (via its WebAssembly build), running in a Web Worker so
  the UI stays responsive. Multiple ranked results come from repeatedly solving and excluding the
  previous answer ("no-good cuts"), not a precomputed solution pool.
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
