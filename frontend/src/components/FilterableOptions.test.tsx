import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('renders every match as a clickable option, even when only one is found', () => {
    render(
      <FilterableOptions items={items} search="leather" onPick={() => {}} ariaLabel="Matches" />,
    )

    const listbox = screen.getByRole('listbox', { name: 'Matches' })
    expect(listbox).toHaveTextContent('Leather Helm')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('calls onPick with the clicked item', () => {
    const onPick = vi.fn()
    render(<FilterableOptions items={items} search="helm" onPick={onPick} ariaLabel="Matches" />)

    fireEvent.click(screen.getByRole('option', { name: 'Iron Helm' }))

    expect(onPick).toHaveBeenCalledWith(items[1])
  })

  it('reports the hovered item, and null once the pointer leaves it', () => {
    const onHoverChange = vi.fn()
    render(
      <FilterableOptions
        items={items}
        search="helm"
        onPick={() => {}}
        ariaLabel="Matches"
        onHoverChange={onHoverChange}
      />,
    )

    const option = screen.getByRole('option', { name: 'Iron Helm' })
    fireEvent.mouseEnter(option)
    expect(onHoverChange).toHaveBeenCalledWith(items[1])

    fireEvent.mouseLeave(option)
    expect(onHoverChange).toHaveBeenCalledWith(null)
  })

  it('shows a note when more matches exist than fit', () => {
    const manyItems = Array.from({ length: 205 }, (_, i) => ({ id: `${i}`, name: `Helm ${i}` }))
    render(
      <FilterableOptions items={manyItems} search="helm" onPick={() => {}} ariaLabel="Matches" />,
    )

    expect(screen.getAllByRole('option')).toHaveLength(200)
    expect(screen.getByText(/205 matches/)).toBeInTheDocument()
  })
})
