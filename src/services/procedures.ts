import { supabase } from '@/lib/supabase'
import type { AccountingCategory, AccountingProcedure } from '@/types'

/** The handbook (Dana, Oct 16): one procedure per job, so someone else could do it. */
export async function listProcedures(organizationId: string): Promise<AccountingProcedure[]> {
  const { data, error } = await supabase.from('accounting_procedures').select('*').eq('organization_id', organizationId).order('category').order('title')
  if (error) throw error
  return data ?? []
}

export async function getProcedure(id: string): Promise<AccountingProcedure | null> {
  const { data, error } = await supabase.from('accounting_procedures').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'procedure'
}

export async function saveProcedure(organizationId: string, id: string | null, input: { title: string; category: AccountingCategory; summary: string; body: string }, userId: string): Promise<string> {
  const row = { title: input.title.trim(), category: input.category, summary: input.summary.trim(), body: input.body, updated_by: userId }
  if (id) {
    const { error } = await supabase.from('accounting_procedures').update(row).eq('id', id)
    if (error) throw error
    return id
  }
  const { data, error } = await supabase.from('accounting_procedures').insert({ organization_id: organizationId, slug: `${slugify(row.title)}-${Date.now().toString(36)}`, ...row }).select('id').single()
  if (error) throw error
  return data.id
}

export async function deleteProcedure(id: string) {
  const { error } = await supabase.from('accounting_procedures').delete().eq('id', id)
  if (error) throw error
}
