import { defineConfig } from '@playwright/test'

/**
 * Runs against the actual built static site (docs/PLAN.md Phase 5: "Playwright
 * e2e for the full 'pick skills -> get results' flow against the actual built
 * static site"), not the dev server -- there's no backend to stand up, so
 * `vite preview` serving the real production build (including the real
 * exported data bundle in public/data) is the closest thing to how GitHub
 * Pages actually serves this app.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
