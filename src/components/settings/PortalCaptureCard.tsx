import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Bookmark, ListChecks, Trash2, Upload } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { captureBookmarklet, readAllBookmarklet } from '@/lib/portalCapture'
import { errorMessage } from '@/lib/utils'
import { Alert } from '@/components/ui'

/**
 * Worldwide portal → VMS (Dana, Oct 16): WWD's IT won't export the vendor directory, so a "Send to VMS" bookmark sends
 * the portal page she is on. Step 1: the Vendors list and one vendor's page, so the reader that pulls every vendor is
 * written from the real pages.
 */
export function PortalCaptureCard() {
  const [key, setKey] = useState<string | null>(null)
  const link = useRef<HTMLAnchorElement>(null)
  const allLink = useRef<HTMLAnchorElement>(null)
  const pages = useSupabaseQuery(async () => {
    const { data, error } = await supabase.from('portal_captures').select('id, url, title, size, how, source, created_at').order('created_at', { ascending: false }).limit(50)
    if (error) throw error
    return data ?? []
  }, [])

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc('portal_capture_key')
      if (error) toast.error(errorMessage(error))
      else setKey(data)
    })()
  }, [])

  // React will not render a javascript: link, so it is set on the element directly
  useEffect(() => {
    const fn = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
    if (link.current && key) link.current.setAttribute('href', captureBookmarklet(fn, key))
    if (allLink.current && key) allLink.current.setAttribute('href', readAllBookmarklet(fn, key))
  }, [key])

  async function upload(file: File) {
    try {
      const html = await file.text()
      const { error } = await supabase.rpc('portal_capture_upload', { p_url: '', p_title: file.name, p_html: html })
      if (error) throw error
      toast.success('Page received')
      await pages.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from('portal_captures').delete().eq('id', id)
    if (error) toast.error(errorMessage(error))
    else await pages.refetch()
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Worldwide portal → VMS</h2>
      <p className="mt-1 text-sm text-stone-600">WWD can't export their vendor directory, so VMS reads it from the portal pages you send with this bookmark.</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-700">
        <li>Drag <strong>Read all vendors</strong> to your browser's bookmarks bar (on a computer).</li>
        <li>Sign in to the Worldwide portal and open the <strong>Vendors</strong> tab.</li>
        <li>Click the <strong>Read all vendors</strong> bookmark. A green box shows how far it is; leave the page open until it says <strong>Done</strong>.</li>
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {key ? (
          <a ref={allLink} onClick={(e) => { e.preventDefault(); toast('Drag this to your bookmarks bar, then click it on the Vendors tab of the Worldwide portal.') }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm">
            <ListChecks className="size-4" aria-hidden="true" /> Read all vendors
          </a>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-stone-500"><strong>Send to VMS</strong> sends just the page you are on.</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {key ? (
          <a ref={link} onClick={(e) => { e.preventDefault(); toast('Drag this to your bookmarks bar, then click it on a Worldwide portal page.') }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-3 py-1.5 text-sm font-medium text-brand">
            <Bookmark className="size-4" aria-hidden="true" /> Send to VMS
          </a>
        ) : <span className="text-sm text-stone-500">Getting your bookmark…</span>}
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-brand hover:underline">
          <Upload className="size-4" aria-hidden="true" /> Upload a saved page
          <input type="file" accept=".html,.htm,text/html" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        </label>
      </div>
      <p className="mt-1 text-xs text-stone-500">If the portal doesn't let the page go, it downloads as <strong>wwd-page.html</strong>: upload it here. The bookmark is yours alone; don't share it.</p>
      {pages.error ? <Alert variant="error" className="mt-3">{pages.error}</Alert> : null}
      {(pages.data ?? []).length ? (
        <ul className="mt-3 divide-y divide-stone-100 text-sm">
          {(pages.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0"><span className="font-medium text-stone-900">{p.source === 'wwd_vendors' ? 'Vendor details (a batch)' : p.source === 'wwd_vendor_list' ? 'The vendor list' : p.title || p.url || 'Page'}</span><span className="ml-2 text-xs text-stone-500">{new Date(p.created_at).toLocaleString()} · {Math.round((p.size ?? 0) / 1024)} KB · {p.how === 'upload' ? 'uploaded' : 'sent'}</span></span>
              <button type="button" onClick={() => void remove(p.id)} aria-label="Remove this page" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600"><Trash2 className="size-4" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-stone-500">No pages received yet.</p>}
    </section>
  )
}
