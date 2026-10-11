/**
 * Phase 3 exit criteria (docs/PLAN.md): "a small Node CLI that takes a
 * query (skills + constraints) and prints ranked results." Run via
 * `npm run search -- --require <skillId>=<minPoints> [options]` in
 * /frontend (the executable entry point is `bin.ts`, which just calls
 * `runSearch` below -- kept separate so this module stays side-effect-free
 * and safely importable from tests).
 *
 * There's no real equipment dataset wired up yet (that's Phase 4's data
 * export) -- this generates the same kind of synthetic dataset the
 * benchmarks use (`bench/generate.ts`), sized and seeded by flags, so it's
 * for trying out and sanity-checking the *search algorithm*, not real
 * Monster Hunter Frontier builds.
 */

import { generateDecorations, generateSlots } from './bench/generate'
import { search } from './engine'
import type { BuildResult, SkillRequirement } from './types'

export interface CliOptions {
  slotCount: number
  candidatesPerSlot: number
  skillCount: number
  decorationCount: number
  maxOpenSlots: number
  seed: number
  take: number
  requirements: SkillRequirement[]
}

const DEFAULTS = {
  slotCount: 7,
  candidatesPerSlot: 100,
  skillCount: 6,
  decorationCount: 15,
  maxOpenSlots: 2,
  seed: 42,
  take: 10,
} as const

const FLAG_TO_KEY: Record<string, keyof typeof DEFAULTS> = {
  '--slots': 'slotCount',
  '--candidates': 'candidatesPerSlot',
  '--skills': 'skillCount',
  '--decorations': 'decorationCount',
  '--max-open-slots': 'maxOpenSlots',
  '--seed': 'seed',
  '--take': 'take',
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { ...DEFAULTS, requirements: [] }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[++i]

    if (flag === '--require') {
      const match = /^(\d+)=(\d+)$/.exec(value ?? '')
      if (!match) {
        throw new Error(`--require expects <skillId>=<minPoints>, got: ${String(value)}`)
      }
      options.requirements.push({ skillId: Number(match[1]), minPoints: Number(match[2]) })
      continue
    }

    const key = FLAG_TO_KEY[flag]
    if (key === undefined) {
      throw new Error(`Unknown flag: ${flag}`)
    }
    options[key] = Number(value)
  }

  if (options.requirements.length === 0) {
    throw new Error('At least one --require <skillId>=<minPoints> is required')
  }

  return options
}

export function formatResult(result: BuildResult, index: number): string {
  const lines = [`#${index}`]
  for (const [slotId, candidate] of result.picks) {
    const decorations = result.decorations.get(slotId)
    const suffix = decorations ? ` [+ ${decorations.map((d) => d.id).join(', ')}]` : ''
    lines.push(`  ${slotId}: ${candidate.id}${suffix}`)
  }
  const skills = [...result.skillTotals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([skillId, points]) => `skill ${skillId}: ${points}`)
  lines.push(`  ${skills.join(', ')}`)
  return lines.join('\n')
}

export function runSearch(argv: readonly string[]): void {
  const options = parseArgs(argv)

  console.log(
    `Synthetic dataset: ${options.slotCount} slots x ${options.candidatesPerSlot} candidates, ` +
      `${options.skillCount} skills, ${options.decorationCount} decorations, seed ${options.seed}.`,
  )
  console.log(
    `Query: ${options.requirements.map((r) => `skill ${r.skillId} >= ${r.minPoints}`).join(', ')}`,
  )
  console.log('')

  const slots = generateSlots(options)
  const decorations = generateDecorations(options)

  const start = performance.now()
  const generator = search(slots, options.requirements, decorations)
  let count = 0
  for (const result of generator) {
    count++
    console.log(formatResult(result, count))
    if (count >= options.take) break
  }
  const elapsedMs = performance.now() - start

  if (count === 0) {
    console.log('No valid combination found.')
  }
  console.log(`\n${count} result(s) in ${elapsedMs.toFixed(0)}ms.`)
}
