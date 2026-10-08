import { supabase } from '@/lib/supabase'
import type { ReviewAssignmentRule } from '@/types'
import type { TablesInsert, TablesUpdate } from '@/types/database'

export interface Person { id: string; full_name: string; email: string; role: string }

/** Claude's test login (scripts/create-test-login.mjs) signs in to preview screens; it is never a person to pick. */
export const TEST_LOGIN_PATTERN = 'claude-test@%'

/** Active people in the organization, for assignee pickers. RLS limits this to the caller's org. */
export async function listPeople(organizationId: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .not('email', 'ilike', TEST_LOGIN_PATTERN)
    .order('full_name', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** People who place orders, for a vendor's Assigned to (Dana and Jarrett; more at go-live). */
export async function listOrderers(organizationId: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .eq('places_orders', true)
    .order('full_name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listReviewRules(organizationId: string): Promise<ReviewAssignmentRule[]> {
  const { data, error } = await supabase
    .from('review_assignment_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createReviewRule(row: TablesInsert<'review_assignment_rules'>): Promise<ReviewAssignmentRule> {
  const { data, error } = await supabase.from('review_assignment_rules').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function updateReviewRule(id: string, changes: TablesUpdate<'review_assignment_rules'>): Promise<void> {
  const { error } = await supabase.from('review_assignment_rules').update(changes).eq('id', id)
  if (error) throw error
}

export async function deleteReviewRule(id: string): Promise<void> {
  const { error } = await supabase.from('review_assignment_rules').delete().eq('id', id)
  if (error) throw error
}

/** Hand a review item to someone, or to nobody. */
export async function assignReviewItem(itemId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_review_item', { p_item: itemId, p_profile: profileId })
  if (error) throw error
}

/** Run the rules over waiting items. Unassigned only by default; every pending item with overwrite. Returns how many changed. */
export async function applyReviewRules(organizationId: string, overwrite = false): Promise<number> {
  const { data, error } = await supabase.rpc('apply_review_rules', { p_org: organizationId, p_overwrite: overwrite })
  if (error) throw error
  return data ?? 0
}

/** Lightspeed categories on file (top levels and "Top/Sub" subcategories), for the category rule's suggestions. */
export async function listCategoryNames(organizationId: string): Promise<string[]> {
  const { data, error } = await supabase.from('categories').select('name').eq('organization_id', organizationId).eq('is_active', true).order('name')
  if (error) throw error
  return (data ?? []).map((c) => c.name)
}

/** After a category rule is added: "who orders from it?" cards for its vendors nobody orders from yet. */
export async function proposeCategoryAssignments(ruleId: string): Promise<number> {
  const { data, error } = await supabase.rpc('propose_category_assignments', { p_rule: ruleId })
  if (error) throw error
  return data ?? 0
}
