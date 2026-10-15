import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FilterableOptions } from './FilterableOptions'

const items = [
  { id: '1', name: 'Leather Helm' },
  { id: '2', name: 'Iron Helm' },
]

describe('FilterableOptions', () => {
  it('renders nothing below the minimum search length', () => {
    const { container } = render(
      <FilterableOptions items={items} search="l" onPick={() => {}} ariaLabel="Matches" />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders an open listbox (size >= 2) even when exactly one match is found', () => {
    render(
      <FilterableOptions items={items} search="leather" onPick={() => {}} ariaLabel="Matches" />,
    )

    const select = screen.getByLabelText('Matches')
    expect(select).toHaveTextContent('Leather Helm')
    expect(select).not.toHaveAttribute('size', '1')
    expect(Number((select as HTMLSelectElement).size)).toBeGreaterThanOrEqual(2)
  })

  it('sizes the listbox to the number of matches, up to 8', () => {
    render(
      <FilterableOptions items={items} search="helm" onPick={() => {}} ariaLabel="Matches" />,
    )

    const select = screen.getByLabelText('Matches') as HTMLSelectElement
    expect(select.size).toBe(2)
  })
})
