import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { listAccountingContacts, setThreadContact } from '@/services/accounting'
import { categoryLabel, contactName } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Badge, Select } from '@/components/ui'

/** On a billing@ conversation (Dana, Oct 16): whose it is, with a pick list to put it on another contact. */
export function AccountingContactLine({ threadId, organizationId }: { threadId: string; organizationId: string }) {
  const q = useSupabaseQuery(async () => {
    const { data, error } = await supabase.from('email_threads').select('accounting_contact_id, accounting_contact:accounting_contacts(id, company, person, category)').eq('id', threadId).single()
    if (error) throw error
    return data as unknown as { accounting_contact_id: string | null; accounting_contact: { id: string; company: string; person: string; category: string } | null }
  }, [threadId])
  const contacts = useSupabaseQuery(() => listAccountingContacts(organizationId), [organizationId])
  const [busy, setBusy] = useState(false)
  const c = q.data?.accounting_contact ?? null

  async function change(id: string) {
    setBusy(true)
    try {
      await setThreadContact(threadId, id || null)
      await q.refetch()
      toast.success(id ? 'Moved' : 'Taken off the contact')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm">
      <span className="text-stone-500">Who:</span>
      {c ? (
        <>
          <Link to={`${ROUTES.accountingContacts}/${c.id}`} className="font-medium text-stone-900 hover:text-brand">{contactName(c)}</Link>
          <Badge tone={c.category === 'other' ? 'neutral' : 'brand'}>{categoryLabel(c.category)}</Badge>
        </>
      ) : <span className="text-stone-500">no contact yet</span>}
      <Select aria-label="Put this conversation on a contact" className="h-9 sm:w-72" value={q.data?.accounting_contact_id ?? ''} disabled={busy} onChange={(e) => void change(e.target.value)}>
        <option value="">— pick a contact —</option>
        {(contacts.data ?? []).filter((x) => x.status !== 'ignored').map((x) => <option key={x.id} value={x.id}>{contactName(x)}</option>)}
      </Select>
    </div>
  )
}
