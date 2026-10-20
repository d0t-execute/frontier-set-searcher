import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Disclosure } from './Disclosure'

describe('Disclosure', () => {
  it('is closed by default unless defaultOpen is set', () => {
    render(
      <Disclosure title="Weapon">
        <p>weapon content</p>
      </Disclosure>,
    )

    expect(screen.getByRole('button', { name: /weapon/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('renders open when defaultOpen is true', () => {
    render(
      <Disclosure title="Skills" defaultOpen>
        <p>skills content</p>
      </Disclosure>,
    )

    expect(screen.getByRole('button', { name: /skills/i })).toHaveAttribute('aria-expanded', 'true')
  })

  it('toggles open and closed when its header is clicked', async () => {
    const user = userEvent.setup()
    render(
      <Disclosure title="Weapon">
        <p>weapon content</p>
      </Disclosure>,
    )

    const header = screen.getByRole('button', { name: /weapon/i })
    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')

    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows the summary whether the section is open or closed', async () => {
    const user = userEvent.setup()
    render(
      <Disclosure title="Weapon" summary="No Zenith skill, 0 slots">
        <p>weapon content</p>
      </Disclosure>,
    )

    expect(screen.getByText('No Zenith skill, 0 slots')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /weapon/i }))

    expect(screen.getByText('No Zenith skill, 0 slots')).toBeInTheDocument()
  })

  it('keeps its content reachable even while closed', () => {
    render(
      <Disclosure title="Weapon">
        <button type="button">Do a thing</button>
      </Disclosure>,
    )

    expect(screen.getByRole('button', { name: 'Do a thing' })).toBeInTheDocument()
  })

  it('renders info next to the title, outside the toggle button, whether open or closed (2026-10-20)', async () => {
    const user = userEvent.setup()
    render(
      <Disclosure title="Weapon" info={<span>Some help text</span>}>
        <p>weapon content</p>
      </Disclosure>,
    )

    expect(screen.getByText('Some help text')).toBeInTheDocument()
    // The toggle button's accessible name is unaffected by `info` -- it
    // isn't nested inside the button (that would be invalid HTML and
    // unreachable by keyboard on its own).
    const header = screen.getByRole('button', { name: 'Weapon' })
    expect(header).not.toHaveTextContent('Some help text')

    await user.click(header)
    expect(screen.getByText('Some help text')).toBeInTheDocument()
  })
})
