import type { Cuff, Decoration, SkillRequirement } from './types'

/**
 * A decoration that contributes to none of the requested skills can never
 * change whether a requirement is met or how a build is ranked -- only
 * relevant decorations are worth giving the solver a column for
 * (`ilp-model.ts`'s `buildModel`). This isn't just an optimization: without
 * it, every slot gets decoration columns for *every* decoration in the
 * catalog (hundreds in the real dataset) regardless of relevance, which
 * inflates the model with columns that can only ever sit at "place none."
 */
export function filterRelevantDecorations(
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): Decoration[] {
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
  return decorations.filter((d) => d.skills.some((s) => requestedSkillIds.has(s.skillId)))
}

/** Same filter as `filterRelevantDecorations`, under its own name for
 * clarity at call sites -- a cuff is shaped identically to a Decoration (see
 * types.ts's `Cuff` alias), and the real cuff catalog (~3,332 entries) is
 * large enough that the same "don't give the solver a dead column" rationale
 * applies equally here. */
export function filterRelevantCuffs(
  cuffs: readonly Cuff[],
  requirements: readonly SkillRequirement[],
): Cuff[] {
  return filterRelevantDecorations(cuffs, requirements)
}
