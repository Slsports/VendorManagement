import { supabase } from '@/lib/supabase'

// Dana's wording for the paragraph under a page's title (Nov 13), read once per session and kept in step after a save.

let cache: { org: string; texts: Promise<Map<string, string>> } | null = null
const listeners = new Set<() => void>()

/** The page's address without record ids, so every vendor page shares one wording (and ?view= keeps its own). */
export function pageKeyFor(pathname: string, search = ''): string {
  const path = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id').replace(/\/$/, '') || '/'
  const view = new URLSearchParams(search).get('view')
  return view ? `${path}?view=${view}` : path
}

/** True when the address names one record (a vendor, an order): those paragraphs are built from the record, not edited. */
export const isRecordPage = (key: string) => key.includes('/:id')

export function loadPageTexts(organizationId: string): Promise<Map<string, string>> {
  if (cache?.org !== organizationId) {
    cache = {
      org: organizationId,
      texts: (async () => {
        const { data, error } = await supabase.from('page_texts').select('page_key, description').eq('organization_id', organizationId)
        if (error) return new Map<string, string>()
        return new Map((data ?? []).map((r) => [r.page_key, r.description]))
      })(),
    }
  }
  return cache.texts
}

export function onPageTextsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

async function refresh(organizationId: string) {
  cache = null
  await loadPageTexts(organizationId)
  for (const fn of listeners) fn()
}

export async function savePageText(organizationId: string, pageKey: string, description: string): Promise<void> {
  const { error } = await supabase.from('page_texts').upsert({ organization_id: organizationId, page_key: pageKey, description }, { onConflict: 'organization_id,page_key' })
  if (error) throw error
  await refresh(organizationId)
}

/** Back to the built-in wording. */
export async function resetPageText(organizationId: string, pageKey: string): Promise<void> {
  const { error } = await supabase.from('page_texts').delete().eq('organization_id', organizationId).eq('page_key', pageKey)
  if (error) throw error
  await refresh(organizationId)
}
