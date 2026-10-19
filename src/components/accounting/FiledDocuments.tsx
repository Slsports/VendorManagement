import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useLiveTable } from '@/hooks/useLiveTable'
import { listDocumentsFor } from '@/services/accountingDocuments'
import { ROUTES } from '@/lib/constants'
import { Spinner } from '@/components/ui'
import { DocumentRows } from './DocumentRows'

/** The papers filed to a policy or a contract (Dana, Oct 16), on its page. */
export function FiledDocuments({ policyId, contractId, className }: { policyId?: string; contractId?: string; className?: string }) {
  const [tick, setTick] = useState(0)
  useLiveTable('accounting_documents', null, () => setTick((t) => t + 1))
  const docs = useSupabaseQuery(() => listDocumentsFor(policyId ? { policy_id: policyId } : { contract_id: contractId ?? '' }), [policyId, contractId, tick])
  return (
    <section className={className ?? 'mt-6 rounded-2xl border border-stone-200 bg-white'}>
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-900">Documents</h2>
        <Link to={ROUTES.accountingDocuments} className="text-xs text-brand hover:underline">All documents</Link>
      </div>
      {docs.isLoading ? <Spinner label="Loading…" className="m-4 text-brand" /> : <DocumentRows docs={docs.data ?? []} onChanged={() => setTick((t) => t + 1)} empty="Nothing filed here yet. Papers from billing@ that belong to this land here on their own; the pencil on any document can point it here too." />}
    </section>
  )
}
