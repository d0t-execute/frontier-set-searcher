/**
 * Memoizing wrapper over an iterable, exposing indexed random access without
 * ever pulling further into the source than the highest index asked for so
 * far (see pareto.ts's recursive frontier merge, which needs `frontierA[i]`/
 * `frontierB[j]` for growing `i`/`j` without ever materializing the full,
 * potentially enormous, source up front).
 */
export class LazyList<T> {
  private readonly cache: T[] = []
  private readonly source: Iterator<T>
  private exhausted = false

  constructor(source: Iterable<T>) {
    this.source = source[Symbol.iterator]()
  }

  get(index: number): T | undefined {
    while (this.cache.length <= index && !this.exhausted) {
      const next = this.source.next()
      if (next.done) {
        this.exhausted = true
        break
      }
      this.cache.push(next.value)
    }
    return this.cache[index]
  }
}
