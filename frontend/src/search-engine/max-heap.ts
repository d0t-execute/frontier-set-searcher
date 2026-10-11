/**
 * A standard binary max-heap, keyed by a caller-supplied priority function.
 * Used by the search engine's best-first exploration (see `engine.ts`) to
 * always expand the most-promising partial build next, which is what lets
 * it yield results in approximately best-first order without enumerating
 * everything first.
 */
export class MaxHeap<T> {
  private readonly items: T[] = []
  private readonly priorityOf: (item: T) => number

  constructor(priorityOf: (item: T) => number) {
    this.priorityOf = priorityOf
  }

  get size(): number {
    return this.items.length
  }

  push(item: T): void {
    this.items.push(item)
    this.bubbleUp(this.items.length - 1)
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined

    const top = this.items[0]
    const last = this.items.pop() as T
    if (this.items.length > 0) {
      this.items[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(index: number): void {
    let i = index
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.priorityOf(this.items[parent]) >= this.priorityOf(this.items[i])) break
      this.swap(i, parent)
      i = parent
    }
  }

  private bubbleDown(index: number): void {
    let i = index
    for (;;) {
      const left = 2 * i + 1
      const right = 2 * i + 2
      let largest = i

      if (
        left < this.items.length &&
        this.priorityOf(this.items[left]) > this.priorityOf(this.items[largest])
      ) {
        largest = left
      }
      if (
        right < this.items.length &&
        this.priorityOf(this.items[right]) > this.priorityOf(this.items[largest])
      ) {
        largest = right
      }
      if (largest === i) break

      this.swap(i, largest)
      i = largest
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a]
    this.items[a] = this.items[b]
    this.items[b] = tmp
  }
}
