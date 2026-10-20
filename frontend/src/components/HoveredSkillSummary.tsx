/**
 * A persistent line beneath a search's results showing the skills of
 * whichever result is currently hovered, with the skill(s) matching the
 * active search query highlighted -- replaces having to hover each result
 * individually and wait for its native tooltip (2026-10-18, per the project
 * owner: tedious to do that one piece at a time when scanning a long list).
 * Originally built inline in `ArmorPicker.tsx`; pulled out here once
 * `EquipmentExclusionPicker.tsx` wanted the same thing for its armor/
 * decoration/cuff lists (2026-10-19, per the project owner).
 */

import type { SkillContribution, SkillId } from '../search-engine/types'

export function HoveredSkillSummary({
  hovered,
  skillNameById,
  skillSearchTextById,
  query,
}: {
  hovered: { readonly skills: readonly SkillContribution[] } | null
  skillNameById: ReadonlyMap<SkillId, string>
  /** Every skill id's own name plus its tier labels, pre-joined and
   * lowercased -- lets a skill highlight here the same way a search result
   * itself was matched, by a tier/threshold name (e.g. "BBQ Master") and not
   * just the skill's own name (e.g. "Cooking") (2026-10-20, per the project
   * owner: searching "bbq" finds the right pieces already, but didn't
   * highlight the matching skill in this summary the way searching "cooking"
   * does). Optional, same convention as every other caller of this same map
   * -- a caller with nothing meaningful to give (none exist today) would
   * fall back to matching on `skillNameById` alone. */
  skillSearchTextById?: ReadonlyMap<SkillId, string>
  query: string
}) {
  if (!hovered) {
    return <div className="hovered-skill-summary text-muted">Hover a result to see its skills.</div>
  }
  if (hovered.skills.length === 0) {
    return <div className="hovered-skill-summary text-muted">No skills.</div>
  }
  const q = query.trim().toLowerCase()
  return (
    <div className="hovered-skill-summary">
      {hovered.skills.map((c, i) => {
        const name = skillNameById.get(c.skillId) ?? `Skill ${c.skillId}`
        const text = `${name}: ${c.points}`
        const searchText = skillSearchTextById?.get(c.skillId) ?? name.toLowerCase()
        const highlighted = q.length > 0 && searchText.includes(q)
        return (
          <span key={c.skillId}>
            {i > 0 && ', '}
            {highlighted ? <mark>{text}</mark> : text}
          </span>
        )
      })}
    </div>
  )
}
