/**
 * Lazily loads and caches the HiGHS WASM runtime (see `engine.ts`'s module
 * docstring). Loading compiles a ~3.5MB WASM module -- fine once, wasteful
 * per search -- so every caller within a single worker/process lifetime
 * shares the same loader promise instead of re-triggering it.
 */

import highsLoader from 'highs'
import type { Highs } from 'highs'

let cached: Promise<Highs> | undefined

export function getHighs(): Promise<Highs> {
  cached ??= highsLoader()
  return cached
}
