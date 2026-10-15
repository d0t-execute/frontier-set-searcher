/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Playwright owns ./e2e (its specs import from @playwright/test, not
    // vitest, and run against a built/served app, not jsdom).
    exclude: [...configDefaults.exclude, './e2e/**'],
    // A blanket upper bound for any test that doesn't declare its own
    // (real-data engine tests already set a tighter per-test timeout where
    // they need one -- see engine.real-data.performance.test.ts) -- observed
    // directly: a full run once hung well past every individual test's own
    // timeout (a one-off environment fluke, not reproduced on immediate
    // retry), so this is a safety net against the whole run never
    // terminating, not a claim that any test legitimately needs 2 minutes.
    testTimeout: 120_000,
  },
})
