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
  },
})
