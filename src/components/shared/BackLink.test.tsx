import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BackLink } from './BackLink'

afterEach(() => window.history.replaceState(null, ''))

describe('BackLink', () => {
  it('on a cold open links to the section list', () => {
    window.history.replaceState({ idx: 0 }, '')
    render(<MemoryRouter><BackLink fallback="/vendors" fallbackLabel="Vendors" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /Vendors/ })).toHaveAttribute('href', '/vendors')
  })
  it('after moving around the app it is a Back button to the previous page', () => {
    window.history.replaceState({ idx: 3 }, '')
    render(<MemoryRouter><BackLink fallback="/vendors" fallbackLabel="Vendors" /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
