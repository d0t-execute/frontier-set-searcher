import type { SkillContribution, SkillId } from './types'

/**
 * "Skill: points, Skill: points" rendering of a piece/decoration/cuff's own
 * skill contributions, resolved against a skill-name lookup -- shared by
 * every place that shows this on hover: `ResultsList.tsx`'s result-card
 * picks (where this originated), and the pin/exclude pickers' own search
 * dropdowns and already-chosen item chips (2026-10-17, per user feedback:
 * "hovering over it would also show the skills that it has").
 */
export function contributionSummary(
  contributions: readonly SkillContribution[],
  skillNames: ReadonlyMap<SkillId, string>,
): string | undefined {
  if (contributions.length === 0) return undefined
  return contributions
    .map((c) => `${skillNames.get(c.skillId) ?? `Skill ${c.skillId}`}: ${c.points}`)
    .join(', ')
}
