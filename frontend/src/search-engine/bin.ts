/**
 * Executable entry point for `npm run search` -- see `cli.ts` for the
 * actual logic. Kept as a separate, unconditionally-executing file because
 * `vite-node` doesn't preserve the run file in `process.argv` the way plain
 * `node script.js` does, so the usual `import.meta.url === process.argv[1]`
 * "am I the entry point" check never matches under it.
 */

import { runSearch } from './cli'

try {
  await runSearch(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
