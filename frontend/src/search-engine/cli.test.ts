import { describe, expect, it } from 'vitest'
import { formatResult, parseArgs } from './cli'
import type { BuildResult, Decoration } from './types'

describe('parseArgs', () => {
  it('applies defaults when only --require is given', () => {
    const options = parseArgs(['--require', '1=15'])

    expect(options).toEqual({
      slotCount: 7,
      candidatesPerSlot: 100,
      skillCount: 6,
      decorationCount: 15,
      maxOpenSlots: 2,
      seed: 42,
      take: 10,
      requirements: [{ skillId: 1, minPoints: 15 }],
    })
  })

  it('accepts multiple --require flags', () => {
    const options = parseArgs(['--require', '1=15', '--require', '2=8'])

    expect(options.requirements).toEqual([
      { skillId: 1, minPoints: 15 },
      { skillId: 2, minPoints: 8 },
    ])
  })

  it('overrides defaults from flags', () => {
    const options = parseArgs([
      '--require',
      '1=5',
      '--slots',
      '5',
      '--candidates',
      '50',
      '--skills',
      '4',
      '--decorations',
      '8',
      '--max-open-slots',
      '3',
      '--seed',
      '7',
      '--take',
      '3',
    ])

    expect(options).toEqual({
      slotCount: 5,
      candidatesPerSlot: 50,
      skillCount: 4,
      decorationCount: 8,
      maxOpenSlots: 3,
      seed: 7,
      take: 3,
      requirements: [{ skillId: 1, minPoints: 5 }],
    })
  })

  it('throws a clear error when no --require is given', () => {
    expect(() => parseArgs([])).toThrow(/--require/)
  })

  it('throws a clear error for a malformed --require value', () => {
    expect(() => parseArgs(['--require', 'nonsense'])).toThrow(/--require/)
  })
})

describe('formatResult', () => {
  it('formats a result with picks, decorations, and skill totals', () => {
    const decoration: Decoration = {
      id: 'deco-3',
      slotSize: 2,
      skills: [{ skillId: 1, points: 5 }],
    }
    const result: BuildResult = {
      picks: new Map([
        ['slot-0', { id: 'item-A', skills: [{ skillId: 1, points: 10 }] }],
        ['slot-1', { id: 'item-B', skills: [{ skillId: 2, points: 8 }] }],
      ]),
      decorations: new Map([['slot-0', [decoration]]]),
      cuffs: [],
      skillTotals: new Map([
        [1, 15],
        [2, 8],
      ]),
    }

    const text = formatResult(result, 1)

    expect(text).toContain('#1')
    expect(text).toContain('slot-0: item-A [+ deco-3]')
    expect(text).toContain('slot-1: item-B')
    expect(text).toContain('skill 1: 15')
    expect(text).toContain('skill 2: 8')
  })

  it('omits the decoration suffix for a slot with none placed', () => {
    const result: BuildResult = {
      picks: new Map([['slot-0', { id: 'item-A', skills: [] }]]),
      decorations: new Map(),
      cuffs: [],
      skillTotals: new Map(),
    }

    const text = formatResult(result, 1)

    expect(text).toContain('slot-0: item-A')
    expect(text).not.toContain('[+')
  })
})
