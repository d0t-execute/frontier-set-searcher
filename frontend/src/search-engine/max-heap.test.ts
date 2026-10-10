import { describe, expect, it } from 'vitest'
import { MaxHeap } from './max-heap'

describe('MaxHeap', () => {
  it('is empty when newly created', () => {
    const heap = new MaxHeap<number>((n) => n)
    expect(heap.size).toBe(0)
    expect(heap.pop()).toBeUndefined()
  })

  it('pops the single pushed item', () => {
    const heap = new MaxHeap<number>((n) => n)
    heap.push(5)
    expect(heap.pop()).toBe(5)
    expect(heap.size).toBe(0)
  })

  it('always pops the largest key first', () => {
    const heap = new MaxHeap<number>((n) => n)
    for (const n of [3, 1, 4, 1, 5, 9, 2, 6]) heap.push(n)

    const popped: number[] = []
    while (heap.size > 0) popped.push(heap.pop() as number)

    expect(popped).toEqual([9, 6, 5, 4, 3, 2, 1, 1])
  })

  it('orders by a key function, not the natural value ordering', () => {
    const heap = new MaxHeap<{ id: string; priority: number }>((item) => item.priority)
    heap.push({ id: 'low', priority: 1 })
    heap.push({ id: 'high', priority: 10 })
    heap.push({ id: 'mid', priority: 5 })

    expect(heap.pop()?.id).toBe('high')
    expect(heap.pop()?.id).toBe('mid')
    expect(heap.pop()?.id).toBe('low')
  })

  it('handles negative and duplicate keys correctly', () => {
    const heap = new MaxHeap<number>((n) => n)
    for (const n of [-5, 0, -5, 3, -1]) heap.push(n)

    const popped: number[] = []
    while (heap.size > 0) popped.push(heap.pop() as number)

    expect(popped).toEqual([3, 0, -1, -5, -5])
  })

  it('remains correct under interleaved pushes and pops', () => {
    const heap = new MaxHeap<number>((n) => n)
    heap.push(10)
    heap.push(20)
    expect(heap.pop()).toBe(20)
    heap.push(5)
    heap.push(30)
    expect(heap.pop()).toBe(30)
    expect(heap.pop()).toBe(10)
    expect(heap.pop()).toBe(5)
    expect(heap.pop()).toBeUndefined()
  })
})
