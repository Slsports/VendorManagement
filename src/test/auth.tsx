import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '@/context/AuthContext'
import { DEFAULT_BRANDING } from '@/lib/theme'
import type { UserRole } from '@/lib/constants'

/** Test helper: an AuthContext with a signed-in user of the given role, inside a MemoryRouter. */
export function withAuth(role: UserRole, ui: ReactNode, initialEntries: string[] = ['/']) {
  const value: AuthContextValue = {
    session: { user: { id: 'u1' } } as AuthContextValue['session'],
    user: { id: 'u1' } as AuthContextValue['user'],
    profile: {
      id: 'u1',
      organization_id: 'o1',
      email: 'test@example.com',
      email_signature: null,
      full_name: 'Test Person',
      role,
      avatar_url: null,
      phone: null,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
    organization: {
      id: 'o1',
      name: 'Test Org',
      slug: 'test',
      legal_name: null,
      app_name: null,
      logo_url: null,
      logo_dark_url: null,
      accent_color: '#00b050',
      settings: {},
      is_active: true,
      created_at: '',
      updated_at: '',
    },
    stores: [],
    role,
    isAdmin: role === 'admin',
    branding: DEFAULT_BRANDING,
    isLoading: false,
    profileError: null,
    passwordRecoveryPending: false,
    signIn: async () => {},
    signOut: async () => {},
    sendPasswordReset: async () => {},
    updatePassword: async () => {},
    refreshProfile: async () => {},
  }
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AuthContext.Provider value={value}>{ui}</AuthContext.Provider>
    </MemoryRouter>
  )
}
