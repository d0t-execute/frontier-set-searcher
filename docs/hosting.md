# Hosting on GitHub Pages

This app is a static, client-only SPA (`frontend/public/data/*.json`, no backend -- see
`docs/PLAN.md`), so GitHub Pages is a direct fit: `frontend/dist` (the `vite build` output) is
everything the app needs to run.

## One-time setup (do this once, in the repo's GitHub settings)

1. Go to the repo's **Settings -> Pages**.
2. Under **Build and deployment -> Source**, choose **GitHub Actions** (not "Deploy from a
   branch").

That's it -- `.github/workflows/deploy-pages.yml` (added 2026-10-15) handles everything else from
here on.

## How it works

- Every push to `main` builds the frontend and deploys `frontend/dist` to Pages automatically (also
  runnable by hand via the workflow's "Run workflow" button -- `workflow_dispatch`).
- The site ends up at `https://<github-username>.github.io/frontier-set-searcher/` -- a **project
  page** (repo name in the path), not a user page, since the repo isn't named
  `<username>.github.io`.
- Because of that subpath, `frontend/vite.config.ts`'s `base` is conditional on a `GH_PAGES` env var
  (set only by the deploy workflow's build step) rather than always on -- local `npm run dev` /
  `npm run build` / `npm test` are all unaffected and still serve/run at the root. See that file's
  own comment for why this couldn't just key off `command === 'build'` (a local `vite preview` of a
  production build hits the same subpath mismatch otherwise -- confirmed directly while setting this
  up).
- `frontend/src/data/useDataBundle.ts` reads `import.meta.env.BASE_URL` (Vite's own resolved `base`)
  rather than a hardcoded `/data` root path, so the data bundle fetch also resolves correctly under
  the subpath.
- The app's shareable-build-result links (`docs/skill-system-roadmap.md` TODO #9) use a hash
  fragment (`#/result/<encoded>`), not a real path -- that works unmodified on GitHub Pages' static
  file serving, with no server-side rewrite rule needed for a deep link to survive a refresh or a
  direct visit.

## Testing a production build locally before pushing

```bash
cd frontend
GH_PAGES=true npm run build
npx vite preview --base /frontier-set-searcher/
```

(On Windows PowerShell: `$env:GH_PAGES='true'; npm run build`.) Plain `npm run build` /
`npx vite preview` (no `GH_PAGES`, no `--base`) also works and is what local dev/testing should use
day to day -- the above is only for specifically reproducing what GitHub Pages will serve.
