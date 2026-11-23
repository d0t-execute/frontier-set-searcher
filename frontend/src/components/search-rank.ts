/**
 * One shared match-and-rank rule for every gear search that matches an item
 * by its own name *or* by the skills it grants (ArmorPicker's piece and
 * decoration searches, CuffPicker, EquipmentExclusionPicker,
 * PreferredArmorPicker) -- each used to carry its own copy of a plain
 * `name.includes(q) || skillText.includes(q)` check, which returned matches in
 * raw catalog order.
 *
 * Reworked 2026-11-23 after a user bug report: typing "G attack" to find the
 * "G Attack・…" decoration series listed every decoration granting a skill
 * with "attack" in it instead. Three rules, per the project owner:
 *
 * 1. A skill match needs the *whole* query as a phrase starting on a word
 *    boundary of the skill's name or tier labels -- "g attack" never matches
 *    the Attack skill, since "g" is no part of it. (Mid-word substrings like
 *    "ttack" no longer match a skill either.)
 * 2. Every name match ranks above every skill match.
 * 3. Within each group, a match at the very start ranks above one later on --
 *    "attack" lists the Attack skill's gear before Strong Attack's, since
 *    someone after Strong Attack would have typed "strong".
 *
 * Punctuation and separators ("-", "・", "(", ...) count as spaces on both
 * sides, so "g-attack" finds "G Attack・Vamp".
 */

/** Lower is better; `false` is no match. A caller's `matches` may also return
 * a plain boolean (`true` ranks as 0) when it has nothing to rank by. */
export type MatchRank = number | false

/** Name-match ranks (0-3) all sort ahead of every skill-match rank. */
const SKILL_RANK_OFFSET = 10

const normalizedCache = new Map<string, string>()

/** Lowercased, with every run of non-letter/non-digit characters (except `+`,
 * which tier labels like "Strong Attack +1" rely on) collapsed to one space.
 * Cached -- the same ~62,000 catalog names get re-normalized on every
 * keystroke otherwise. */
export function normalizeSearchText(text: string): string {
  let normalized = normalizedCache.get(text)
  if (normalized === undefined) {
    normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+]+/gu, ' ')
      .trim()
    normalizedCache.set(text, normalized)
  }
  return normalized
}

/** How well `name` matches `query`: exact (0), at the start (1), at a later
 * word's start (2), anywhere else in the name (3), or -- for a multi-word
 * query -- each query word starting some name word, in order, with other
 * words allowed in between (4). That last one lets "g rush" find
 * "G Attack・Rush" (2026-11-23, per the project owner); it only ever adds
 * results below every contiguous match, and needs every word to line up with
 * a word start, so it can't drag in names a single-word query wouldn't. */
export function rankName(name: string, query: string): MatchRank {
  const q = normalizeSearchText(query)
  if (q.length === 0) return false
  const n = normalizeSearchText(name)
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.includes(` ${q}`)) return 2
  if (n.includes(q)) return 3
  if (q.includes(' ') && wordsInOrder(n, q.split(' '))) return 4
  return false
}

/** True when each of `queryWords` is a prefix of a word of `normalized`,
 * each one a later word than the last. */
function wordsInOrder(normalized: string, queryWords: readonly string[]): boolean {
  const words = normalized.split(' ')
  let i = 0
  for (const qw of queryWords) {
    while (i < words.length && !words[i].startsWith(qw)) i++
    if (i === words.length) return false
    i++
  }
  return true
}

/** How well one skill's search text (its name, then its tier labels -- see
 * `skillSearchTextById` in App.tsx) matches `query`: starting the skill's own
 * name (0), or starting some later word (1). Nothing else matches -- see this
 * module's rule 1. */
export function rankSkillText(skillText: string, query: string): MatchRank {
  const q = normalizeSearchText(query)
  if (q.length === 0) return false
  const t = normalizeSearchText(skillText)
  if (t.startsWith(q)) return 0
  if (t.includes(` ${q}`)) return 1
  return false
}

/** True when `skillText` would match `query` under `rankSkillText` -- for
 * highlighting the matched skill (HoveredSkillSummary) by the same rule the
 * search itself used. */
export function skillTextMatches(skillText: string, query: string): boolean {
  return rankSkillText(skillText, query) !== false
}

/** The best of `name`'s own rank and every skill text's rank, with any name
 * match always beating any skill match. */
export function rankNameOrSkills(
  name: string,
  skillTexts: Iterable<string>,
  query: string,
): MatchRank {
  const nameRank = rankName(name, query)
  if (nameRank !== false) return nameRank
  let best: MatchRank = false
  for (const text of skillTexts) {
    const r = rankSkillText(text, query)
    if (r !== false && (best === false || r < best)) {
      best = r
      if (best === 0) break
    }
  }
  return best === false ? false : SKILL_RANK_OFFSET + best
}

/** `true` -> 0, `false` stays `false`, numbers pass through. */
export function toRank(result: MatchRank | boolean): MatchRank {
  return result === true ? 0 : result
}

/** Every item that matches, best rank first; equal ranks keep catalog order
 * (Array#sort is stable). */
export function rankedMatches<T>(
  items: readonly T[],
  query: string,
  matches: (item: T, query: string) => MatchRank | boolean,
): T[] {
  const ranked: { item: T; rank: number }[] = []
  for (const item of items) {
    const rank = toRank(matches(item, query))
    if (rank !== false) ranked.push({ item, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank)
  return ranked.map((r) => r.item)
}
