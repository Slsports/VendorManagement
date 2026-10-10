import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { withAuth } from '@/test/auth'

function renderShell(role: Parameters<typeof withAuth>[0], path = '/') {
  return render(
    withAuth(
      role,
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<p>page body</p>} />
        </Route>
      </Routes>,
      [path],
    ),
  )
}

describe('AppShell', () => {
  it('renders the main navigation and page content for an admin', () => {
    renderShell('admin')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!
    expect(within(nav).getByRole('link', { name: 'Vendors' })).toHaveAttribute('href', '/vendors')
    expect(within(nav).getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('page body')).toBeInTheDocument()
  })

  it('shows uploaders only the upload link', () => {
    renderShell('uploader', '/upload')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent?.trim())).toEqual(['Upload invoice'])
  })

  it('marks the current order status sub-item', () => {
    renderShell('buyer', '/orders?status=shipped')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]!
    expect(within(nav).getByRole('link', { name: 'Shipped' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Paid' })).not.toHaveAttribute('aria-current')
  })

  it('offers sign out from the account menu', () => {
    renderShell('viewer')
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
  })
})
