import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CategoryFilter } from './CategoryFilter'

// A small fixture tree, independent of the real (much larger) taxonomy in
// gear-categories.ts -- this component only needs to work for *some* tree
// shape, which the real constant then supplies in production.
const GROUPS = [
  {
    label: 'Guild',
    categories: [
      { key: 'guild_plain', label: 'Guild' },
      { key: 'guild_gx', label: 'Guild GX' },
    ],
  },
  {
    label: 'Tower',
    categories: [{ key: 'tower_plain', label: 'Tower Plain' }],
  },
]

describe('CategoryFilter', () => {
  it('renders a checkbox for every group and every leaf category', () => {
    render(<CategoryFilter groups={GROUPS} excludedCategories={new Set()} onChange={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'Guild (all)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Tower (all)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Guild GX' })).toBeInTheDocument()
  })

  it('checks every leaf by default when nothing is excluded', () => {
    render(<CategoryFilter groups={GROUPS} excludedCategories={new Set()} onChange={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'Guild GX' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Tower Plain' })).toBeChecked()
  })

  it('unchecks a leaf already in excludedCategories', () => {
    render(
      <CategoryFilter
        groups={GROUPS}
        excludedCategories={new Set(['guild_gx'])}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Guild GX' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Guild' })).toBeChecked()
  })

  it('unchecking a leaf adds it to excludedCategories', async () => {
    const onChange = vi.fn()
    render(<CategoryFilter groups={GROUPS} excludedCategories={new Set()} onChange={onChange} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Guild GX' }))

    expect(onChange).toHaveBeenCalledWith(new Set(['guild_gx']))
  })

  it('re-checking an excluded leaf removes it from excludedCategories', async () => {
    const onChange = vi.fn()
    render(
      <CategoryFilter
        groups={GROUPS}
        excludedCategories={new Set(['guild_gx', 'tower_plain'])}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: 'Guild GX' }))

    expect(onChange).toHaveBeenCalledWith(new Set(['tower_plain']))
  })

  it('unchecking a group header excludes every leaf under it', async () => {
    const onChange = vi.fn()
    render(<CategoryFilter groups={GROUPS} excludedCategories={new Set()} onChange={onChange} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Guild (all)' }))

    expect(onChange).toHaveBeenCalledWith(new Set(['guild_plain', 'guild_gx']))
  })

  it('checking a partially-excluded group header includes every leaf under it', async () => {
    const onChange = vi.fn()
    render(
      <CategoryFilter
        groups={GROUPS}
        excludedCategories={new Set(['guild_gx'])}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: 'Guild (all)' }))

    expect(onChange).toHaveBeenCalledWith(new Set())
  })

  it('shows a group header as indeterminate when only some of its leaves are excluded', () => {
    render(
      <CategoryFilter
        groups={GROUPS}
        excludedCategories={new Set(['guild_gx'])}
        onChange={vi.fn()}
      />,
    )

    const header = screen.getByRole('checkbox', { name: 'Guild (all)' }) as HTMLInputElement
    expect(header.indeterminate).toBe(true)
  })

  describe('itemsByCategory', () => {
    const ITEMS_BY_CATEGORY = new Map([
      ['guild_gx', [{ name: 'Guardian Mask' }, { name: 'Carnage Mask' }]],
    ])

    it('does not render a View toggle for a leaf with no itemsByCategory entry', () => {
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          itemsByCategory={ITEMS_BY_CATEGORY}
        />,
      )

      expect(screen.queryAllByRole('button')).toHaveLength(1)
    })

    it('shows a View toggle with the item count for a leaf with items', () => {
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          itemsByCategory={ITEMS_BY_CATEGORY}
        />,
      )

      expect(screen.getByRole('button', { name: 'View (2)' })).toBeInTheDocument()
    })

    it('expands to show every item name on click, and collapses again on a second click', async () => {
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          itemsByCategory={ITEMS_BY_CATEGORY}
        />,
      )

      expect(screen.queryByText(/Guardian Mask/)).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'View (2)' }))
      expect(screen.getByText(/Guardian Mask/)).toBeInTheDocument()
      expect(screen.getByText(/Carnage Mask/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Hide' }))
      expect(screen.queryByText(/Guardian Mask/)).not.toBeInTheDocument()
    })
  })
})
