import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FoldSection } from './FoldSection'

describe('FoldSection', () => {
  it('starts closed with its count, opens and closes on the title bar, and actions do not toggle it', () => {
    const onNew = vi.fn()
    render(
      <FoldSection title="Mail" summary="142 conversations" actions={<button type="button" onClick={onNew}>New email</button>}>
        <p>The mail list</p>
      </FoldSection>,
    )
    const bar = screen.getByRole('button', { name: /Mail\s*142 conversations/ })
    expect(bar).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('142 conversations')).toBeInTheDocument()
    expect(screen.queryByText('The mail list')).not.toBeInTheDocument()

    fireEvent.click(bar)
    expect(bar).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('The mail list')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New email' }))
    expect(onNew).toHaveBeenCalled()
    expect(bar).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(bar)
    expect(screen.queryByText('The mail list')).not.toBeInTheDocument()
  })
})
