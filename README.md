# Frontier Set Searcher

A fast armor/skill set searcher for Monster Hunter Frontier. See
[docs/PLAN.md](docs/PLAN.md) for the full architecture and phased delivery
plan — start there before making structural changes.

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
