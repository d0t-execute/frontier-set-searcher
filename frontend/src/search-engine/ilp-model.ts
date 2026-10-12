/**
 * Builds and decodes the integer-program formulation the search engine hands
 * to HiGHS (see `engine.ts`'s module docstring for why this replaced the
 * Pareto-frontier approach). One call to `buildModel` encodes an entire
 * query -- every slot's candidates, every relevant decoration, every
 * simultaneous skill requirement -- as a single MIP, so the solver finds a
 * complete build directly instead of this engine combining partial frontiers
 * itself.
 *
 * Every column in the model is binary, including decoration placement: a
 * decoration that could be placed 0..maxCount times in a slot gets one
 * column *per count* ("place none" through "place maxCount"), constrained so
 * exactly one of them is chosen (see `decorationGroupRow`). This costs more
 * columns than a single bounded integer variable per decoration would, but
 * it's what makes `exclusionRow`'s no-good cut (the thing that lets this
 * engine return more than one ranked result -- see `engine.ts`) a single,
 * textbook-simple row: every feasible solution selects exactly one column
 * from every slot's cardinality group *and* every slot/decoration's count
 * group, so "forbid re-selecting this exact combination of columns" is
 * exactly as valid for a count-group as it already is for a candidate
 * (binary no-good cuts only work cleanly on binary variables -- forbidding
 * "z = 3" for a general bounded integer `z` by writing `z <= 2` would also
 * wrongly forbid `z = 0, 1, 2` the *next* time those are wanted again for a
 * different reason, and a general not-equal cut needs auxiliary variables
 * and big-M rows per excluded value -- the one-hot encoding sidesteps both).
 * Decoration counts are naturally small (1-3 open slots is the common real
 * case), so this is at most a handful of extra columns per relevant
 * decoration per slot, not a combinatorial blow-up.
 *
 * Columns, in order: one binary "is this candidate chosen for this slot"
 * column per (slot, candidate) pair, followed by one binary "place exactly
 * this many of this decoration in this slot" column -- for every count from
 * 0 up to however many could physically fit -- per (slot, relevant
 * decoration) pair whose size could ever fit there. `columns` (in
 * `buildModel`'s result) is a parallel array recording what each column
 * means, so a solution vector can be decoded back into a `BuildResult`
 * without the model itself carrying names.
 *
 * Rows, in order: one cardinality row per slot (exactly one candidate
 * chosen), one capacity row per slot (decorations placed there can't exceed
 * the chosen candidate's open slots), one decoration-group row per (slot,
 * relevant decoration) pair (exactly one count column chosen for it), then
 * one row per skill requirement (the summed contribution across every
 * chosen candidate and placed decoration must reach its minimum).
 */

import type { Highs, ModelData, ModelStatusCode, VariableType } from 'highs'
import type {
  Candidate,
  Decoration,
  SkillContribution,
  SkillId,
  SkillRequirement,
  SlotQuery,
} from './types'

/** How much one leftover (unused) decoration slot is worth in the objective,
 * relative to one point of a bonus skill nobody asked for -- mirrors the old
 * Pareto engine's `OPEN_SLOT_SCORE_WEIGHT` (confirmed project direction:
 * leaving decoration capacity open for the player's own choices matters far
 * more than incidental bonus points, large enough that no realistic bonus
 * total could ever outweigh a single open slot). Declared independently here
 * rather than imported, since the Pareto modules this constant used to live
 * in (dominance.ts) are dead code once this engine replaces them. */
export const OPEN_SLOT_WEIGHT = 10_000

export interface CandidateColumn {
  readonly kind: 'candidate'
  readonly slotIndex: number
  readonly slotId: string
  readonly candidate: Candidate
}

export interface DecorationColumn {
  readonly kind: 'decoration'
  readonly slotIndex: number
  readonly slotId: string
  readonly decoration: Decoration
  /** How many copies of `decoration` this column places when chosen -- 0
   * means "none of this decoration," a valid, usually-necessary member of
   * its one-hot group (see this module's own docstring). */
  readonly count: number
}

/** What a single model column represents -- parallel to the model's own
 * column order, so a solution vector (indexed the same way) can be decoded
 * back into picks and placed decorations. */
export type ColumnMeta = CandidateColumn | DecorationColumn

export interface BuiltModel {
  readonly model: ModelData
  readonly columns: readonly ColumnMeta[]
}

function pointsTowards(skills: readonly SkillContribution[], skillId: SkillId): number {
  return skills.find((s) => s.skillId === skillId)?.points ?? 0
}

/** Total points in skills nobody requested -- additive the same way summed
 * skill points always are, matching the old engine's `bonusPointsOf`
 * (expand.ts) which this replaces. */
function bonusPointsOf(
  skills: readonly SkillContribution[],
  requestedSkillIds: ReadonlySet<SkillId>,
): number {
  let bonusPoints = 0
  for (const skill of skills) {
    if (!requestedSkillIds.has(skill.skillId)) bonusPoints += skill.points
  }
  return bonusPoints
}

/**
 * Encodes `slots`/`decorations`/`requirements` as a single MIP (see this
 * module's own docstring for the column/row layout). `decorations` is
 * expected to already be filtered to ones relevant to `requirements` (same
 * precondition `expand.ts`'s `filterRelevantDecorations` existed for) --
 * irrelevant decorations would only add dead columns the solver has to carry
 * for no benefit.
 *
 * Takes a live `Highs` instance not to solve anything here, but because
 * `ModelData`'s unbounded-row sentinel and objective sense are themselves
 * values the runtime defines (`highs.infinity`, a branded
 * `highs.constants.objectiveSense`), not plain JS constants -- there's no way
 * to build a valid `ModelData` without them.
 */
export function buildModel(
  highs: Highs,
  slots: readonly SlotQuery[],
  decorations: readonly Decoration[],
  requirements: readonly SkillRequirement[],
): BuiltModel {
  const requestedSkillIds = new Set(requirements.map((r) => r.skillId))
  const numSlots = slots.length

  const slotMaxCapacity = slots.map((slot) =>
    slot.candidates.reduce((max, c) => Math.max(max, c.openSlotCount ?? 0), 0),
  )
  const slotDecorationGroups = slots.map((_slot, s) =>
    slotMaxCapacity[s] > 0
      ? decorations.filter((d) => d.slotSize > 0 && d.slotSize <= slotMaxCapacity[s])
      : [],
  )

  const cardinalityRow = (slotIndex: number): number => slotIndex
  const capacityRow = (slotIndex: number): number => numSlots + slotIndex

  let rowCursor = 2 * numSlots
  const groupRowOf: number[][] = slotDecorationGroups.map((group) => group.map(() => rowCursor++))
  const skillRowBase = rowCursor
  const skillRow = (requirementIndex: number): number => skillRowBase + requirementIndex
  const numRows = skillRowBase + requirements.length

  const rowLower = new Array<number>(numRows)
  const rowUpper = new Array<number>(numRows)
  for (let s = 0; s < numSlots; s++) {
    rowLower[cardinalityRow(s)] = 1
    rowUpper[cardinalityRow(s)] = 1
    rowLower[capacityRow(s)] = -highs.infinity
    rowUpper[capacityRow(s)] = 0
    for (const row of groupRowOf[s]) {
      rowLower[row] = 1
      rowUpper[row] = 1
    }
  }
  requirements.forEach((req, r) => {
    rowLower[skillRow(r)] = req.minPoints
    rowUpper[skillRow(r)] = highs.infinity
  })

  const columns: ColumnMeta[] = []
  const colCost: number[] = []
  const integrality: VariableType[] = []
  const starts: number[] = [0]
  const indices: number[] = []
  const values: number[] = []

  function addColumn(cost: number, entries: ReadonlyMap<number, number>): void {
    colCost.push(cost)
    integrality.push(highs.constants.variableType.integer)
    for (const [row, value] of entries) {
      indices.push(row)
      values.push(value)
    }
    starts.push(indices.length)
  }

  slots.forEach((slot, s) => {
    for (const candidate of slot.candidates) {
      const capacity = candidate.openSlotCount ?? 0
      const entries = new Map<number, number>([[cardinalityRow(s), 1]])
      if (capacity !== 0) entries.set(capacityRow(s), -capacity)
      requirements.forEach((req, r) => {
        const points = pointsTowards(candidate.skills, req.skillId)
        if (points !== 0) entries.set(skillRow(r), points)
      })

      columns.push({ kind: 'candidate', slotIndex: s, slotId: slot.slotId, candidate })
      addColumn(
        OPEN_SLOT_WEIGHT * capacity + bonusPointsOf(candidate.skills, requestedSkillIds),
        entries,
      )
    }

    slotDecorationGroups[s].forEach((decoration, groupIndex) => {
      const maxCapacity = slotMaxCapacity[s]
      const maxCount = Math.floor(maxCapacity / decoration.slotSize)
      const groupRow = groupRowOf[s][groupIndex]
      const decorationBonus = bonusPointsOf(decoration.skills, requestedSkillIds)

      for (let count = 0; count <= maxCount; count++) {
        const entries = new Map<number, number>([[groupRow, 1]])
        if (count > 0) {
          entries.set(capacityRow(s), count * decoration.slotSize)
          requirements.forEach((req, r) => {
            const points = pointsTowards(decoration.skills, req.skillId)
            if (points !== 0) entries.set(skillRow(r), count * points)
          })
        }

        columns.push({ kind: 'decoration', slotIndex: s, slotId: slot.slotId, decoration, count })
        const cost =
          count === 0 ? 0 : count * (-OPEN_SLOT_WEIGHT * decoration.slotSize + decorationBonus)
        addColumn(cost, entries)
      }
    })
  })

  const model: ModelData = {
    numCols: columns.length,
    numRows,
    sense: highs.constants.objectiveSense.maximize,
    colCost,
    colLower: new Array<number>(columns.length).fill(0),
    colUpper: new Array<number>(columns.length).fill(1),
    rowLower,
    rowUpper,
    integrality,
    matrix: {
      format: 'csc',
      numRows,
      numCols: columns.length,
      starts,
      indices,
      values,
    },
  }

  return { model, columns }
}

export interface BuildResultLike {
  readonly picks: Map<string, Candidate>
  readonly decorations: Map<string, Decoration[]>
  readonly skillTotals: Map<SkillId, number>
}

/** Decodes a solved model's primal column values back into a `BuildResult`
 * shape. Every column is binary, so "chosen" is read as the value rounding
 * above 0.5 (floating-point solver output is never exactly 0/1). A chosen
 * decoration column with `count > 0` is expanded back into that many
 * individual `Decoration` entries, matching the old engine's flat
 * `decorationsUsed` list (duplicates allowed); `count === 0` ("none of this
 * decoration") is a normal, silently-skipped outcome, not a special case. */
export function decodeSolution(
  columns: readonly ColumnMeta[],
  colValue: ArrayLike<number>,
): BuildResultLike {
  const picks = new Map<string, Candidate>()
  const decorationsBySlot = new Map<string, Decoration[]>()
  const skillTotals = new Map<SkillId, number>()

  function addSkills(skills: readonly SkillContribution[], times: number): void {
    for (const { skillId, points } of skills) {
      skillTotals.set(skillId, (skillTotals.get(skillId) ?? 0) + points * times)
    }
  }

  columns.forEach((column, j) => {
    if (colValue[j] <= 0.5) return

    if (column.kind === 'candidate') {
      picks.set(column.slotId, column.candidate)
      addSkills(column.candidate.skills, 1)
      return
    }

    if (column.count <= 0) return
    const placed = decorationsBySlot.get(column.slotId) ?? []
    for (let i = 0; i < column.count; i++) placed.push(column.decoration)
    decorationsBySlot.set(column.slotId, placed)
    addSkills(column.decoration.skills, column.count)
  })

  return { picks, decorations: decorationsBySlot, skillTotals }
}

export interface RowSpec {
  readonly lower: number
  readonly upper: number
  readonly indices: readonly number[]
  readonly values: readonly number[]
}

/**
 * A "no-good cut" forbidding the exact combination of chosen columns in
 * `colValue` from being re-selected -- the standard technique for getting a
 * ranked list of distinct results out of a MIP solver, which (unlike
 * commercial solvers) has no built-in solution pool: solve, cut out the
 * answer just found, re-solve (see `engine.ts`).
 *
 * This is the textbook binary no-good cut (`sum(previously chosen columns)
 * <= chosen count - 1`), valid here across *every* column -- candidate and
 * decoration-count alike -- specifically because every column is binary and
 * every feasible solution picks exactly one column from each cardinality,
 * capacity-group, and decoration-group (see this module's own docstring for
 * why decoration counts are one-hot-encoded for exactly this reason). A
 * general bounded-integer column would need auxiliary variables and
 * big-M rows per excluded value to forbid just one count without also
 * forbidding every other value on one side of it -- the one-hot encoding
 * avoids that entirely, at the cost of a few extra columns up front.
 */
export function exclusionRow(
  highs: Highs,
  columns: readonly ColumnMeta[],
  colValue: ArrayLike<number>,
): RowSpec {
  const indices: number[] = []
  const values: number[] = []
  let chosenCount = 0

  columns.forEach((_column, j) => {
    if (colValue[j] > 0.5) {
      indices.push(j)
      values.push(1)
      chosenCount++
    }
  })

  return { lower: -highs.infinity, upper: chosenCount - 1, indices, values }
}

/**
 * Whether a round's solver outcome is usable as a yielded `BuildResult` (see
 * `engine.ts`'s per-round time box). Every skill requirement is a hard
 * constraint on the model, never part of the objective -- so *any* primal
 * feasible solution already satisfies every one of them exactly, whether or
 * not the solver ever finished proving it's the single best-ranked one.
 * `interrupted` with a feasible incumbent is therefore just as usable a
 * result as `optimal`, only possibly not the best-ranked one; `interrupted`
 * with no incumbent yet (or genuine `infeasible`) means there's nothing
 * valid to yield this round.
 */
export function isUsableResult(
  highs: Highs,
  modelStatus: ModelStatusCode,
  primalSolutionStatus: number,
): boolean {
  if (modelStatus === highs.constants.modelStatus.optimal) return true
  return (
    modelStatus === highs.constants.modelStatus.interrupted &&
    primalSolutionStatus === highs.constants.solutionStatus.feasible
  )
}
