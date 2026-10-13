import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'

// Settings → Lightspeed (Dana, Oct 13): the API client and the sign-in, through the lightspeed function (admin only).
// The page never sees the Client Secret or the sign-in tokens.

export interface LightspeedStatus {
  client_id: string | null; secret_saved: boolean; connected: boolean; connected_at: string | null; connected_by: string | null
  read_only: boolean | null; account_id: string | null; account_name: string | null; item_count: number | null
  checked_at: string | null; last_error: string | null; redirect_uri: string
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('lightspeed', { body })
  if (error) throw await functionError(error)
  return data as T
}

export const lightspeedStatus = () => call<LightspeedStatus>({ action: 'status' })
export const saveLightspeedClient = (clientId: string, clientSecret: string) => call<LightspeedStatus>({ action: 'save_client', client_id: clientId, client_secret: clientSecret })
export const lightspeedSignInUrl = (access: 'read' | 'full') => call<{ url: string }>({ action: 'authorize', access }).then((r) => r.url)
export const finishLightspeedSignIn = (code: string, state: string) => call<LightspeedStatus>({ action: 'exchange', code, state })
export const testLightspeed = () => call<LightspeedStatus>({ action: 'test' })
export const disconnectLightspeed = () => call<LightspeedStatus>({ action: 'disconnect' })
