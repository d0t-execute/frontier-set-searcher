import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultsList } from './ResultsList'
import type { NamedBuildResult } from './types'

const skillNames = new Map([
  [1, 'Attack'],
  [2, 'Defense'],
])

function result(overrides: Partial<NamedBuildResult> = {}): NamedBuildResult {
  return {
    picks: new Map([['head', { id: 'head:0001', name: 'Leather Helm', skills: [] }]]),
    decorations: new Map(),
    skillTotals: new Map([[1, 15]]),
    surplus: 5,
    ...overrides,
  }
}

describe('ResultsList', () => {
  it('renders one entry per result, in the given order', () => {
    render(
      <ResultsList
        results={[
          result({
            surplus: 10,
            picks: new Map([['head', { id: 'a', name: 'Helm A', skills: [] }]]),
          }),
          result({
            surplus: 5,
            picks: new Map([['head', { id: 'b', name: 'Helm B', skills: [] }]]),
          }),
        ]}
        skillNames={skillNames}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Helm A')
    expect(items[1]).toHaveTextContent('Helm B')
  })

  it("shows each result's surplus", () => {
    render(<ResultsList results={[result({ surplus: 7 })]} skillNames={skillNames} />)

    expect(screen.getByText(/surplus:\s*7/i)).toBeInTheDocument()
  })

  it('shows the pick for each slot by name', () => {
    render(
      <ResultsList
        results={[
          result({
            picks: new Map([
              ['head', { id: 'head:0001', name: 'Leather Helm', skills: [] }],
              ['chest', { id: 'body:0001', name: 'Leather Vest', skills: [] }],
            ]),
          }),
        ]}
        skillNames={skillNames}
      />,
    )

    expect(screen.getByText(/leather helm/i)).toBeInTheDocument()
    expect(screen.getByText(/leather vest/i)).toBeInTheDocument()
  })

  it('shows decorations placed in a slot, when present', () => {
    render(
      <ResultsList
        results={[
          result({
            decorations: new Map([
              ['head', [{ id: 'D001', name: 'Attack Jewel', slotSize: 1, skills: [] }]],
            ]),
          }),
        ]}
        skillNames={skillNames}
      />,
    )

    expect(screen.getByText(/attack jewel/i)).toBeInTheDocument()
  })

  it('resolves skill totals to their names', () => {
    render(
      <ResultsList
        results={[
          result({
            skillTotals: new Map([
              [1, 20],
              [2, 8],
            ]),
          }),
        ]}
        skillNames={skillNames}
      />,
    )

    expect(screen.getByText(/attack/i)).toBeInTheDocument()
    expect(screen.getByText(/20/)).toBeInTheDocument()
    expect(screen.getByText(/defense/i)).toBeInTheDocument()
    expect(screen.getByText(/8/)).toBeInTheDocument()
  })

  it('renders nothing when there are no results', () => {
    const { container } = render(<ResultsList results={[]} skillNames={skillNames} />)

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(container.querySelector('ul')).not.toBeInTheDocument()
  })
})
