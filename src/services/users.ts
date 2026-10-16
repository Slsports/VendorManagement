import { supabase } from '@/lib/supabase'
import { TEST_LOGIN_PATTERN } from '@/services/reviews'
import type { Profile, UserRole } from '@/types'

/** Roles the admin can give. Admin is never offered: only Dana is admin (CLAUDE.md). */
export const GRANTABLE_ROLES: UserRole[] = ['manager', 'buyer', 'viewer', 'uploader']

export interface SignInInfo { id: string; google: boolean; password: boolean; last_sign_in_at: string | null }
export interface StoreGrant { user_id: string; store_id: string }

export async function listUsers(organizationId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('organization_id', organizationId)
    .not('email', 'ilike', TEST_LOGIN_PATTERN)
    .order('full_name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listStoreGrants(): Promise<StoreGrant[]> {
  const { data, error } = await supabase.from('user_store_access').select('user_id, store_id')
  if (error) throw error
  return data ?? []
}

async function adminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    // The function answers errors as JSON { error }; surface that text instead of "non-2xx status code".
    const ctx = (error as { context?: Response }).context
    const detail = ctx ? await ctx.json().then((j: { error?: string }) => j.error ?? null).catch(() => null) : null
    throw new Error(detail ?? error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}

export async function listSignIns(): Promise<SignInInfo[]> {
  const { rows } = await adminUsers<{ rows: SignInInfo[] }>({ action: 'sign_ins' })
  return rows
}

export async function createUser(input: { email: string; full_name: string; role: UserRole; store_codes: string[] }): Promise<Profile> {
  const { profile } = await adminUsers<{ profile: Profile }>({ action: 'create', ...input })
  return profile
}

export async function setUserRole(id: string, role: UserRole) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
  if (error) throw error
}

export async function setUserActive(id: string, is_active: boolean) {
  const { error } = await supabase.from('profiles').update({ is_active }).eq('id', id)
  if (error) throw error
}

/** The Accounting tick (Dana, Oct 16): sees the Accounting area. Admin alone is not enough; only admins set it. */
export async function setUserAccounting(id: string, sees_accounting: boolean) {
  const { error } = await supabase.from('profiles').update({ sees_accounting }).eq('id', id)
  if (error) throw error
}

export async function setStoreGrants(userId: string, storeIds: string[]) {
  const { error: delError } = await supabase.from('user_store_access').delete().eq('user_id', userId)
  if (delError) throw delError
  if (storeIds.length) {
    const { error } = await supabase.from('user_store_access').insert(storeIds.map((store_id) => ({ user_id: userId, store_id })))
    if (error) throw error
  }
}

/** Emails the person a link to choose a password (the Forgot-password flow); Google sign-in needs none. */
export async function sendSetPasswordEmail(email: string) {
  const appUrl = import.meta.env.VITE_APP_URL?.trim() || window.location.origin
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/reset-password` })
  if (error) throw error
}
