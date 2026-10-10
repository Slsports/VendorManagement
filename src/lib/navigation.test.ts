import { describe, expect, it } from 'vitest'
import { homeRouteForRole, navForRole } from './navigation'
import { ROUTES } from './constants'

const labels = (role: Parameters<typeof navForRole>[0]) => navForRole(role).flatMap((g) => g.items.map((i) => i.label))

describe('navForRole', () => {
  it('gives admins everything', () => {
    const l = labels('admin')
    expect(l).toContain('Settings')
    expect(l).toContain('Payments')
    expect(l).toContain('Dashboard')
  })

  it('hides Settings from managers but keeps Payments', () => {
    const l = labels('manager')
    expect(l).not.toContain('Settings')
    expect(l).toContain('Payments')
  })

  it('hides Settings and Payments from buyers and viewers', () => {
    for (const role of ['buyer', 'viewer'] as const) {
      const l = labels(role)
      expect(l).not.toContain('Settings')
      expect(l).not.toContain('Payments')
      expect(l).toContain('Vendors')
    }
  })

  it('shows uploaders only the upload screen', () => {
    expect(labels('uploader')).toEqual(['Upload invoice'])
  })

  it('returns nothing when signed out', () => {
    expect(navForRole(null)).toEqual([])
  })

  it('lists one Orders sub-item per status plus All', () => {
    const orders = navForRole('admin').flatMap((g) => g.items).find((i) => i.label === 'Orders')
    expect(orders?.children?.length).toBe(10)
    expect(orders?.children?.[0]?.to).toBe(ROUTES.orders)
  })
})

describe('homeRouteForRole', () => {
  it('sends uploaders to upload and others to the dashboard', () => {
    expect(homeRouteForRole('uploader')).toBe(ROUTES.upload)
    expect(homeRouteForRole('admin')).toBe(ROUTES.dashboard)
    expect(homeRouteForRole(null)).toBe(ROUTES.dashboard)
  })
})
