import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// @testing-library/react's own auto-cleanup detects a global `afterEach`,
// which doesn't exist under this project's `globals: false` vitest config
// (see vite.config.ts) -- without this, every render in a test file piles
// up in the same jsdom `document`, since nothing unmounts the previous one.
afterEach(cleanup)
