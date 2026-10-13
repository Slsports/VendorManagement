import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui'

interface Receipt { vendor: string; version: number; received_at: string | null; file_name: string; url: string | null }

/**
 * The page a vendor opens from the routing letter email (Dana, Oct 13): "I received the routing instructions". No login;
 * opening it records the receipt for that person, and offers the letter to download.
 */
export default function RoutingReceiptPage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<{ receipt?: Receipt; error?: string }>({})
  useEffect(() => {
    supabase.functions.invoke('vendor-public', { body: { action: 'receipt', token } })
      .then(({ data, error }) => setState(error ? { error: 'This link is not valid. Please email orders@shaverlakesports.com.' } : { receipt: data as Receipt }))
      .catch(() => setState({ error: 'Something went wrong. Please email orders@shaverlakesports.com.' }))
  }, [token])
  const r = state.receipt
  return (
    <main className="min-h-dvh bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <img src="/brand/sls/email-logo@2x.png" alt="Shaver Lake Sports" width={240} height={31} className="mb-6 h-auto w-60" />
        {!r && !state.error ? <div className="flex justify-center py-6"><Spinner label="One moment…" className="text-brand" /></div> : null}
        {state.error ? <p className="text-stone-700">{state.error}</p> : null}
        {r ? (
          <>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-900"><CheckCircle2 className="size-6 text-green-600" aria-hidden="true" />Thank you!</h1>
            <p className="mt-3 text-stone-700">We've recorded that {r.vendor} received our freight routing instructions{r.version > 1 ? ` (updated version ${r.version})` : ''}.</p>
            <p className="mt-2 text-stone-700">Please share them with your shipping department. No order ships until we approve a freight quote.</p>
            {r.url ? <a href={r.url} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"><Download className="size-4" aria-hidden="true" />Download the routing instructions</a> : null}
            <p className="mt-6 text-xs text-stone-500">Questions: orders@shaverlakesports.com · 559-841-2740</p>
          </>
        ) : null}
      </div>
    </main>
  )
}
