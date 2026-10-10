import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getCurrentUserData, type CurrentUserData } from '@/services/profiles'
import { applyBranding, brandingFromOrganization, type Branding } from '@/lib/theme'
import { errorMessage } from '@/lib/utils'
import type { Organization, Profile, Store, UserRole } from '@/types'

export interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  organization: Organization | null
  /** Stores the user may access. Admins get every store in their organization. */
  stores: Store[]
  role: UserRole | null
  isAdmin: boolean
  branding: Branding
  /** True until the initial session check and, when signed in, the profile fetch complete. */
  isLoading: boolean
  /** Set when a session exists but the profile could not be loaded (missing or deactivated). */
  profileError: string | null
  /** True after the user arrives via a password-recovery link, until they set a new password. */
  passwordRecoveryPending: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  refreshProfile: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

const appUrl = import.meta.env.VITE_APP_URL?.trim() || (typeof window !== 'undefined' ? window.location.origin : '')

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = not yet known; null = signed out
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<CurrentUserData | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false)
  const loadId = useRef(0)
  const lastUserId = useRef<string | null>(null)

  // 1. Track the Supabase session. onAuthStateChange emits INITIAL_SESSION on subscribe,
  //    so no separate getSession() call is needed.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Never await Supabase calls inside this callback (it can deadlock the auth client);
      // the profile fetch is driven by the userId effect below instead.
      const nextUserId = nextSession?.user.id ?? null
      if (nextUserId !== lastUserId.current) {
        // Different user (or signed out): drop everything tied to the previous one.
        lastUserId.current = nextUserId
        loadId.current++
        setData(null)
        setProfileError(null)
      }
      if (!nextSession) setPasswordRecoveryPending(false)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecoveryPending(true)
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  // 2. Load profile, organization and stores whenever the signed-in user changes.
  //    State is only touched in promise callbacks, i.e. asynchronously after the fetch settles.
  const loadProfile = useCallback((id: string) => {
    const myLoad = ++loadId.current
    return getCurrentUserData(id).then(
      (result) => {
        if (myLoad !== loadId.current) return
        setData(result)
        setProfileError(null)
      },
      (err: unknown) => {
        if (myLoad !== loadId.current) return
        setData(null)
        setProfileError(errorMessage(err, 'Could not load your profile.'))
      },
    )
  }, [])

  const userId = session?.user.id ?? null
  useEffect(() => {
    if (userId) void loadProfile(userId)
  }, [userId, loadProfile])

  // 3. Apply tenant branding.
  const branding = useMemo(() => brandingFromOrganization(data?.organization), [data?.organization])
  useEffect(() => {
    applyBranding(branding)
  }, [branding])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${appUrl}/reset-password`,
    })
    if (error) throw error
  }, [])

  const updatePassword = useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
    setPasswordRecoveryPending(false)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId)
  }, [userId, loadProfile])

  const value = useMemo<AuthContextValue>(
    () => ({
      session: session ?? null,
      user: session?.user ?? null,
      profile: data?.profile ?? null,
      organization: data?.organization ?? null,
      stores: data?.stores ?? [],
      role: data?.profile.role ?? null,
      isAdmin: data?.profile.role === 'admin',
      branding,
      isLoading: session === undefined || (!!session && !data && !profileError),
      profileError,
      passwordRecoveryPending,
      signIn,
      signOut,
      sendPasswordReset,
      updatePassword,
      refreshProfile,
    }),
    [session, data, branding, profileError, passwordRecoveryPending, signIn, signOut, sendPasswordReset, updatePassword, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
