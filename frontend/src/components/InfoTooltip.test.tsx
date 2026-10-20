import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InfoTooltip } from './InfoTooltip'

describe('InfoTooltip', () => {
  it('renders the icon with the given accessible label', () => {
    render(<InfoTooltip label="About pinning armor">Some help text</InfoTooltip>)

    expect(screen.getByRole('button', { name: 'About pinning armor' })).toBeInTheDocument()
  })

  it('renders its content in the DOM (shown via CSS on hover/focus, not JS state)', () => {
    render(
      <InfoTooltip label="About pinning armor">
        Pins a specific piece. <b>You can also search by skill name.</b>
      </InfoTooltip>,
    )

    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Pins a specific piece. You can also search by skill name.',
    )
  })
})
