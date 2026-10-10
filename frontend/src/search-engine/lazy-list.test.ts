import { describe, expect, it, vi } from 'vitest'
import { LazyList } from './lazy-list'

function* numbers(upTo: number, onProduce?: (n: number) => void) {
  for (let i = 0; i <= upTo; i++) {
    onProduce?.(i)
    yield i
  }
}

describe('LazyList', () => {
  it('returns elements by index in source order', () => {
    const list = new LazyList(numbers(5))

    expect(list.get(0)).toBe(0)
    expect(list.get(3)).toBe(3)
    expect(list.get(5)).toBe(5)
  })

  it('returns undefined past the end of the source', () => {
    const list = new LazyList(numbers(2))

    expect(list.get(5)).toBeUndefined()
  })

  it('never re-invokes the source generator for an index it already produced', () => {
    const produced: number[] = []
    const list = new LazyList(numbers(10, (n) => produced.push(n)))

    list.get(2)
    expect(produced).toEqual([0, 1, 2])

    list.get(1) // already produced -- must not pull more from the source
    expect(produced).toEqual([0, 1, 2])
  })

  it('only pulls as far into the source as the highest index requested so far', () => {
    const produced: number[] = []
    const list = new LazyList(numbers(100, (n) => produced.push(n)))

    list.get(3)

    expect(produced).toEqual([0, 1, 2, 3])
  })

  it('remembers exhaustion instead of re-querying the source once drained', () => {
    const generator = numbers(1)
    const next = vi.fn(generator.next.bind(generator))
    const list = new LazyList({ [Symbol.iterator]: () => ({ next }) })

    list.get(10)
    const callsAfterFirstDrain = next.mock.calls.length
    list.get(10)

    // Once the source reports done, a further out-of-range query must be
    // answered from cached exhaustion state, not by calling the iterator's
    // `.next()` again.
    expect(next.mock.calls.length).toBe(callsAfterFirstDrain)
  })

  it('supports jumping straight to a high index without asking for earlier ones first', () => {
    const list = new LazyList(numbers(20))

    expect(list.get(15)).toBe(15)
    expect(list.get(5)).toBe(5)
  })
})
