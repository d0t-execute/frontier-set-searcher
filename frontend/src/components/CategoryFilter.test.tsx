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

  it("collapses and expands a group's leaves without affecting its checked state", async () => {
    render(<CategoryFilter groups={GROUPS} excludedCategories={new Set()} onChange={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'Guild GX' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Collapse Guild' }))
    expect(screen.queryByRole('checkbox', { name: 'Guild GX' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Guild (all)' })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Expand Guild' }))
    expect(screen.getByRole('checkbox', { name: 'Guild GX' })).toBeInTheDocument()
  })

  describe('defaultCollapsed', () => {
    it('renders every group expanded by default', () => {
      render(<CategoryFilter groups={GROUPS} excludedCategories={new Set()} onChange={vi.fn()} />)

      expect(screen.getByRole('checkbox', { name: 'Guild GX' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Tower Plain' })).toBeInTheDocument()
    })

    it('renders every group collapsed when defaultCollapsed is set', () => {
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          defaultCollapsed
        />,
      )

      expect(screen.queryByRole('checkbox', { name: 'Guild GX' })).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Tower Plain' })).not.toBeInTheDocument()
      // The group header itself (and its own select-all checkbox) still
      // renders regardless of collapse state.
      expect(screen.getByRole('checkbox', { name: 'Guild (all)' })).toBeInTheDocument()
    })
  })

  describe('sections (third tree level)', () => {
    const SECTIONED_GROUPS = [
      {
        label: 'Guild',
        categories: [
          { key: 'guild_plain', label: 'Guild' },
          { key: 'diva_defense', label: 'Diva Defense' },
          { key: 'diva_defense_zenith_zx', label: 'Diva Defense Zenith ZX' },
        ],
        sections: [
          { label: 'Base', categories: [{ key: 'guild_plain', label: 'Guild' }] },
          {
            label: 'Diva Defense',
            categories: [
              { key: 'diva_defense', label: 'Diva Defense' },
              { key: 'diva_defense_zenith_zx', label: 'Diva Defense Zenith ZX' },
            ],
          },
        ],
      },
    ]

    it('renders a section header and nests its own leaves under it', () => {
      render(
        <CategoryFilter groups={SECTIONED_GROUPS} excludedCategories={new Set()} onChange={vi.fn()} />,
      )

      expect(screen.getByRole('checkbox', { name: 'Guild: Diva Defense (all)' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Diva Defense' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Diva Defense Zenith ZX' })).toBeInTheDocument()
    })

    it('collapses and expands one section independently of its sibling', async () => {
      render(
        <CategoryFilter groups={SECTIONED_GROUPS} excludedCategories={new Set()} onChange={vi.fn()} />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Collapse Guild: Diva Defense' }))

      expect(screen.queryByRole('checkbox', { name: 'Diva Defense' })).not.toBeInTheDocument()
      // The sibling "Base" section is untouched.
      expect(screen.getByRole('checkbox', { name: 'Guild' })).toBeInTheDocument()
    })

    it("a section's checkbox excludes only its own leaves, not its sibling section's", async () => {
      const onChange = vi.fn()
      render(
        <CategoryFilter groups={SECTIONED_GROUPS} excludedCategories={new Set()} onChange={onChange} />,
      )

      await userEvent.click(screen.getByRole('checkbox', { name: 'Guild: Diva Defense (all)' }))

      expect(onChange).toHaveBeenCalledWith(new Set(['diva_defense', 'diva_defense_zenith_zx']))
    })

    it('starts every section collapsed too when defaultCollapsed is set', () => {
      render(
        <CategoryFilter
          groups={SECTIONED_GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          defaultCollapsed
        />,
      )

      // The group itself is collapsed, so no section header renders yet.
      expect(screen.queryByRole('checkbox', { name: 'Guild: Diva Defense (all)' })).not.toBeInTheDocument()
    })
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

      // One collapse/expand toggle per group (GROUPS has 2), plus the one
      // View toggle for "Guild GX" (the only leaf with an itemsByCategory
      // entry) -- no View toggle for any leaf without one.
      expect(screen.queryAllByRole('button')).toHaveLength(GROUPS.length + 1)
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

    it('shows a plain "N more" note with no table link, even past the cap', async () => {
      const overflowing = new Map([
        ['guild_gx', Array.from({ length: 101 }, (_, i) => ({ name: `Item ${i}` }))],
      ])
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          itemsByCategory={overflowing}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'View (101)' }))

      expect(screen.getByText(/, and 1 more/)).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('does not render a Table link when tableLinkHash is omitted', () => {
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          itemsByCategory={ITEMS_BY_CATEGORY}
        />,
      )

      expect(screen.queryByRole('link', { name: 'Table' })).not.toBeInTheDocument()
    })

    it('shows a Table link for a leaf with items, regardless of category size', () => {
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          itemsByCategory={ITEMS_BY_CATEGORY}
          tableLinkHash={(key) => `#/category/gear/${key}`}
        />,
      )

      // "Guild GX" is the only leaf with an itemsByCategory entry (2 items,
      // well under the "View" cap) -- the Table link shows up regardless.
      const link = screen.getByRole('link', { name: 'Table' })
      expect(link).toHaveAttribute('href', '#/category/gear/guild_gx')
    })

    it('does not show a Table link for a leaf with no items at all', () => {
      const emptyCategory = new Map([['guild_gx', []]])
      render(
        <CategoryFilter
          groups={GROUPS}
          excludedCategories={new Set()}
          onChange={vi.fn()}
          itemsByCategory={emptyCategory}
          tableLinkHash={(key) => `#/category/gear/${key}`}
        />,
      )

      expect(screen.queryByRole('link', { name: 'Table' })).not.toBeInTheDocument()
    })
  })
})
