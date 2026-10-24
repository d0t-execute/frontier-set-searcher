import { afterEach, describe, expect, it } from 'vitest'
import { categoryRouteFromLocation, categoryRouteHash } from './category-route'

afterEach(() => {
  window.location.hash = ''
})

describe('categoryRouteHash', () => {
  it('builds a hash encoding the kind and category key', () => {
    expect(categoryRouteHash('gear', 'grank_g')).toBe('#/category/gear/grank_g')
  })

  it('percent-encodes a category key with special characters', () => {
    expect(categoryRouteHash('decorations', 'a/b')).toBe('#/category/decorations/a%2Fb')
  })
})

describe('categoryRouteFromLocation', () => {
  it('returns null when the location has no category hash', () => {
    window.location.hash = ''
    expect(categoryRouteFromLocation()).toBeNull()
  })

  it('returns null for an unrelated hash', () => {
    window.location.hash = '#/result/abc'
    expect(categoryRouteFromLocation()).toBeNull()
  })

  it('returns null for an unknown kind', () => {
    window.location.hash = '#/category/weapons/foo'
    expect(categoryRouteFromLocation()).toBeNull()
  })

  it('parses a valid category hash', () => {
    window.location.hash = '#/category/cuffs/standard_plain'
    expect(categoryRouteFromLocation()).toEqual({ kind: 'cuffs', categoryKey: 'standard_plain' })
  })

  it('round-trips a key built with categoryRouteHash', () => {
    window.location.hash = categoryRouteHash('gear', 'a/b')
    expect(categoryRouteFromLocation()).toEqual({ kind: 'gear', categoryKey: 'a/b' })
  })

  it('parses a "show all" hash with no category key as categoryKey: null (docs/feedback.md Round 3 #5)', () => {
    window.location.hash = '#/category/decorations'
    expect(categoryRouteFromLocation()).toEqual({ kind: 'decorations', categoryKey: null })
  })

  it('returns null for a "show all" hash with an unknown kind', () => {
    window.location.hash = '#/category/weapons'
    expect(categoryRouteFromLocation()).toBeNull()
  })
})

describe('categoryRouteHash with no category key', () => {
  it('builds the "show all" hash for a kind', () => {
    expect(categoryRouteHash('cuffs')).toBe('#/category/cuffs')
  })
})
