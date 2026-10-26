import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreferredCategoryPicker } from './PreferredCategoryPicker'

function renderPicker(counts: ReadonlyMap<string, number> = new Map(), onChange = vi.fn()) {
  return render(<PreferredCategoryPicker counts={counts} onChange={onChange} />)
}

describe('PreferredCategoryPicker', () => {
  it('shows no rows when nothing is preferred', () => {
    renderPicker()

    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  })

  it('adds a category at count 1 when picked from the search results', () => {
    const onChange = vi.fn()
    renderPicker(new Map(), onChange)

    fireEvent.change(screen.getByLabelText('Search gear categories to prefer'), {
      target: { value: 'Package F' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'Package F' }))

    expect(onChange).toHaveBeenCalledWith(new Map([['paid_package_f', 1]]))
  })

  it('offers each whole gear-level tier as a category to prefer (2026-10-26)', () => {
    const onChange = vi.fn()
    renderPicker(new Map(), onChange)

    fireEvent.change(screen.getByLabelText('Search gear categories to prefer'), {
      target: { value: 'G-Rank' },
    })
    fireEvent.click(screen.getByRole('option', { name: 'All G-Rank gear' }))

    expect(onChange).toHaveBeenCalledWith(new Map([['level:grank', 1]]))
  })

  it('shows an already-preferred category as a row with its count and a remove button', () => {
    renderPicker(new Map([['paid_package_f', 3]]))

    expect(screen.getByText('Package F')).toBeInTheDocument()
    expect(screen.getByLabelText('Number of pieces to prefer from Package F')).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'Remove Package F' })).toBeInTheDocument()
  })

  it('removes a category from the preferred set when its row remove button is clicked', () => {
    const onChange = vi.fn()
    renderPicker(new Map([['paid_package_f', 2]]), onChange)

    fireEvent.click(screen.getByRole('button', { name: 'Remove Package F' }))

    expect(onChange).toHaveBeenCalledWith(new Map())
  })

  it('updates a category count when its select is changed', () => {
    const onChange = vi.fn()
    renderPicker(new Map([['paid_package_f', 1]]), onChange)

    fireEvent.change(screen.getByLabelText('Number of pieces to prefer from Package F'), {
      target: { value: '4' },
    })

    expect(onChange).toHaveBeenCalledWith(new Map([['paid_package_f', 4]]))
  })

  it('does not offer an already-preferred category again in the search results', () => {
    renderPicker(new Map([['paid_package_f', 1]]))

    fireEvent.change(screen.getByLabelText('Search gear categories to prefer'), {
      target: { value: 'Package' },
    })

    expect(screen.queryByRole('option', { name: 'Package F' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Package' })).toBeInTheDocument()
  })
})
