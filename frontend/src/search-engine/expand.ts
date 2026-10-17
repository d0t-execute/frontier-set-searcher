import type { Cuff, Decoration, SkillId, SkillRequirement } from './types'

/**
 * A decoration that contributes to none of the requested skills can never
 * change whether a requirement is met or how a build is ranked -- only
 * relevant decorations are worth giving the solver a column for
 * (`ilp-model.ts`'s `buildModel`). This isn't just an optimization: without
 * it, every slot gets decoration columns for *every* decoration in the
 * catalog (hundreds in the real dataset) regardless of relevance, which
 * inflates the model with columns that can only ever sit at "place none."
 *
 * `extraSkillIds` (docs/skill-system-roadmap.md TODO #25) widens "relevant"
 * beyond the requested skills -- a cuff pinned to a skill by
 * `SearchOptions.pinnedCuffSkillIds` needs its own matching cuffs to reach
 * `buildModel` as real columns even when that skill was never also asked for
 * as a search requirement, since it's the *only* way the solver could ever
 * satisfy that pin. Decorations have no equivalent pin-by-skill feature
 * today, so every `filterRelevantDecorations` call site simply omits this.
 */
export function filterRelevantDecorations(
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
  extraSkillIds: readonly SkillId[] = [],
): Decoration[] {
  const requestedSkillIds = new Set([...requirements.map((r) => r.skillId), ...extraSkillIds])
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
  extraSkillIds: readonly SkillId[] = [],
): Cuff[] {
  return filterRelevantDecorations(cuffs, requirements, extraSkillIds)
}
