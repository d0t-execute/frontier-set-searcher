import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreferredArmorPicker } from './PreferredArmorPicker'

const armorCandidates = [
  { id: 'head:0001', name: 'Leather Helm', skills: [{ skillId: 1, points: 5 }] },
  { id: 'head:0002', name: 'Iron Helm', skills: [] },
]

const skillNameById = new Map([[1, 'Attack']])
const skillSearchTextById = new Map([[1, 'attack expert']])

function renderPicker(preferredIds: ReadonlySet<string> = new Set(), onChange = vi.fn()) {
  return render(
    <PreferredArmorPicker
      armorCandidates={armorCandidates}
      preferredIds={preferredIds}
      onChange={onChange}
      skillNameById={skillNameById}
      skillSearchTextById={skillSearchTextById}
    />,
  )
}

describe('PreferredArmorPicker', () => {
  it('shows no badges when nothing is preferred', () => {
    renderPicker()

    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  })

  it('adds a piece to the preferred set when picked from the search results', () => {
    const onChange = vi.fn()
    renderPicker(new Set(), onChange)

    fireEvent.change(screen.getByLabelText('Search armor pieces to prefer'), {
      target: { value: 'Leather' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'Leather Helm' }))

    expect(onChange).toHaveBeenCalledWith(new Set(['head:0001']))
  })

  it('shows an already-preferred piece as a badge with a remove button', () => {
    renderPicker(new Set(['head:0001']))

    expect(screen.getByText('Leather Helm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Leather Helm' })).toBeInTheDocument()
  })

  it('removes a piece from the preferred set when its badge remove button is clicked', () => {
    const onChange = vi.fn()
    renderPicker(new Set(['head:0001']), onChange)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Leather Helm' }))

    expect(onChange).toHaveBeenCalledWith(new Set())
  })

  it('does not offer an already-preferred piece again in the search results', () => {
    renderPicker(new Set(['head:0001']))

    fireEvent.change(screen.getByLabelText('Search armor pieces to prefer'), {
      target: { value: 'Helm' },
    })

    expect(screen.queryByRole('option', { name: 'Leather Helm' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Iron Helm' })).toBeInTheDocument()
  })

  it('matches a piece by a granted skill tier label, not just its own name (docs/feedback.md Round 2 #8)', () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search armor pieces to prefer'), {
      target: { value: 'attack expert' },
    })

    expect(screen.getByRole('option', { name: 'Leather Helm' })).toBeInTheDocument()
  })

  it('shows a hover summary of the skills the hovered piece grants', () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('Search armor pieces to prefer'), {
      target: { value: 'Leather' },
    })
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'Leather Helm' }))

    expect(screen.getByText('Attack: 5')).toBeInTheDocument()
  })
})
