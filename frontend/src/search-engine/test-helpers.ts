/** Drains an async generator into an array -- `search()` became async once it
 * started delegating to the HiGHS WASM runtime (see `engine.ts`'s module
 * docstring), so every test that used to do `[...search(...)]` needs this in
 * its place. */
export async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of generator) out.push(item)
  return out
}
