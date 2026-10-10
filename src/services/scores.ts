import { supabase } from '@/lib/supabase'
import type { ScoreDimension, VendorScorecard } from '@/types'

export async function listScorecards(organizationId: string): Promise<VendorScorecard[]> {
  const { data, error } = await supabase.rpc('vendor_scorecards', { p_org: organizationId })
  if (error) throw error
  return data ?? []
}

export async function getScorecard(organizationId: string, vendorId: string): Promise<VendorScorecard | null> {
  const { data, error } = await supabase.rpc('vendor_scorecards', { p_org: organizationId, p_vendor: vendorId })
  if (error) throw error
  return data?.[0] ?? null
}

/** Add a hand rating (1 to 5). The latest per dimension is the one that counts; history stays. */
export async function rateVendor(input: { organization_id: string; vendor_id: string; dimension: ScoreDimension; score: number; note: string | null; rated_by: string | null }): Promise<void> {
  const { error } = await supabase.from('vendor_ratings').insert(input)
  if (error) throw error
}
