import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CuffPicker } from './CuffPicker'
import type { NamedCuff } from '../search-engine/load-bundle'

const cuffs: readonly NamedCuff[] = [
  { id: 'cuff:0001', name: 'Sharpening PC1', slotSize: 1, skills: [{ skillId: 1, points: 5 }], category: 'cuff_standard_plain' },
  { id: 'cuff:0002', name: 'Guard Up SZ', slotSize: 2, skills: [{ skillId: 2, points: 5 }], category: 'cuff_standard_plain' },
]

const skillNameById = new Map([
  [1, 'Sharpening'],
  [2, 'Guard Up'],
])

describe('CuffPicker', () => {
  it('renders one unpinned search box per cuff slot by default', () => {
    render(<CuffPicker cuffs={cuffs} pinned={[]} onChange={() => {}} skillNameById={skillNameById} />)

    expect(screen.getByLabelText('Search cuffs for Cuff slot 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Search cuffs for Cuff slot 2')).toBeInTheDocument()
  })

  it('shows the pinned cuff name instead of the search box once a slot is pinned', () => {
    render(<CuffPicker cuffs={cuffs} pinned={['cuff:0001']} onChange={() => {}} skillNameById={skillNameById} />)

    expect(screen.getByText('Sharpening PC1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search cuffs for Cuff slot 1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search cuffs for Cuff slot 2')).toBeInTheDocument()
  })

  it('pins a cuff into the given slot once picked from the filtered list', () => {
    const onChange = vi.fn()
    render(<CuffPicker cuffs={cuffs} pinned={[]} onChange={onChange} skillNameById={skillNameById} />)

    fireEvent.change(screen.getByLabelText('Search cuffs for Cuff slot 1'), {
      target: { value: 'Sharp' },
    })
    fireEvent.change(screen.getByLabelText('Cuffs matching search for Cuff slot 1'), {
      target: { value: 'cuff:0001' },
    })

    expect(onChange).toHaveBeenCalledWith(['cuff:0001'])
  })

  it('allows the same cuff id to be pinned into both slots at once', () => {
    const onChange = vi.fn()
    render(<CuffPicker cuffs={cuffs} pinned={['cuff:0001']} onChange={onChange} skillNameById={skillNameById} />)

    fireEvent.change(screen.getByLabelText('Search cuffs for Cuff slot 2'), {
      target: { value: 'Sharp' },
    })
    fireEvent.change(screen.getByLabelText('Cuffs matching search for Cuff slot 2'), {
      target: { value: 'cuff:0001' },
    })

    expect(onChange).toHaveBeenCalledWith(['cuff:0001', 'cuff:0001'])
  })

  it('clears a pinned slot without disturbing the other one', () => {
    const onChange = vi.fn()
    render(<CuffPicker cuffs={cuffs} pinned={['cuff:0001', 'cuff:0002']} onChange={onChange} skillNameById={skillNameById} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0])

    expect(onChange).toHaveBeenCalledWith(['cuff:0002'])
  })

  it('shows the skills a pinned cuff grants as a hover tooltip', () => {
    render(<CuffPicker cuffs={cuffs} pinned={['cuff:0001']} onChange={() => {}} skillNameById={skillNameById} />)

    expect(screen.getByText('Sharpening PC1')).toHaveAttribute('title', 'Sharpening: 5')
  })

  it('shows the skills a cuff grants as a hover tooltip on its search option', () => {
    render(<CuffPicker cuffs={cuffs} pinned={[]} onChange={() => {}} skillNameById={skillNameById} />)

    fireEvent.change(screen.getByLabelText('Search cuffs for Cuff slot 1'), {
      target: { value: 'Sharp' },
    })

    const option = screen.getByRole('option', { name: 'Sharpening PC1' })
    expect(option).toHaveAttribute('title', 'Sharpening: 5')
  })

  describe('keyboard-only picking', () => {
    it('pins the top-matching cuff when Enter is pressed in the search', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<CuffPicker cuffs={cuffs} pinned={[]} onChange={onChange} skillNameById={skillNameById} />)

      await user.type(screen.getByLabelText('Search cuffs for Cuff slot 1'), 'Sharp{Enter}')

      expect(onChange).toHaveBeenCalledWith(['cuff:0001'])
    })

    it('does nothing on Enter when there is no match in the search', async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<CuffPicker cuffs={cuffs} pinned={[]} onChange={onChange} skillNameById={skillNameById} />)

      await user.type(screen.getByLabelText('Search cuffs for Cuff slot 1'), 'zzz{Enter}')

      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
