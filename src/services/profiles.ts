import { supabase } from '@/lib/supabase'
import type { Organization, Profile, Store } from '@/types'

export interface CurrentUserData {
  profile: Profile
  organization: Organization
  stores: Store[]
}

/**
 * Load everything the app needs about the signed-in user in one go.
 * RLS guarantees: the profile is the caller's own, the organization is theirs,
 * and `stores` contains only the stores they may access (admins see all stores
 * in their organization).
 */
export async function getCurrentUserData(userId: string): Promise<CurrentUserData> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (profileError) throw profileError
  if (!profile.is_active) throw new Error('This account has been deactivated. Contact your administrator.')

  const [{ data: organization, error: orgError }, { data: stores, error: storesError }] =
    await Promise.all([
      supabase.from('organizations').select('*').eq('id', profile.organization_id).single(),
      supabase
        .from('stores')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .order('sort_order', { ascending: true })
        .order('code', { ascending: true }),
    ])
  if (orgError) throw orgError
  if (storesError) throw storesError

  return { profile, organization, stores: stores ?? [] }
}

export async function updateMyProfile(userId: string, changes: { full_name?: string; phone?: string | null; avatar_url?: string | null }) {
  const { data, error } = await supabase
    .from('profiles')
    .update(changes)
    .eq('id', userId)
    .select('*')
    .single()
  if (error) throw error
  return data
}
