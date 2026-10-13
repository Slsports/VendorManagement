import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listLsVendors, setVendorLs, syncLsVendors } from '@/services/lightspeed'
import { errorMessage } from '@/lib/utils'
import { FoldSection } from '@/components/shared/FoldSection'
import { Button, FormField, Input } from '@/components/ui'

const today = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getFullYear()).slice(2)}` }
const defaultCode = (name: string) => {
  const s = name.replace(/\s*[-(]\s*(wwd|faire).*$/i, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().trim()
  const squeezed = s.replace(/\s+/g, '')
  return squeezed.length <= 12 ? squeezed : (s.split(/\s+/)[0]!.length >= 4 ? s.split(/\s+/)[0]! : squeezed.slice(0, 12))
}

/**
 * Lightspeed on the vendor page (Dana, Oct 13): the PO code our PO numbers start with (YAKIMA → YAKIMA080626) and which
 * Lightspeed vendor this is, so "Create PO in LS" can make the PO.
 */
export function VendorLightspeedBox({ vendor, canEdit, onChange }: { vendor: { id: string; name: string; po_code: string | null; lightspeed_vendor_id: string | null; lightspeed_name: string | null }; canEdit: boolean; onChange: () => void }) {
  const { organization } = useAuth()
  const ls = useSupabaseQuery(async () => (organization ? listLsVendors(organization.id) : []), [organization?.id])
  const [code, setCode] = useState(vendor.po_code ?? '')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const current = (ls.data ?? []).find((v) => v.ls_vendor_id === vendor.lightspeed_vendor_id) ?? null
  const shown = useMemo(() => {
    const words = pick.trim().toLowerCase()
    return words.length < 2 ? [] : (ls.data ?? []).filter((v) => v.name.toLowerCase().includes(words)).slice(0, 8)
  }, [pick, ls.data])
  const usedCode = (code.trim() || defaultCode(vendor.name)).toUpperCase().replace(/[^A-Z0-9]/g, '')

  async function save(lsId: string | null, poCode: string) {
    setBusy('save')
    try {
      await setVendorLs(vendor.id, lsId, poCode)
      toast.success('Saved')
      setPick('')
      onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  async function refresh() {
    setBusy('sync')
    try {
      const r = await syncLsVendors()
      toast.success(`${r.vendors} Lightspeed vendors; ${r.matched} newly matched`)
      await ls.refetch()
      onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <FoldSection title="Lightspeed" summary={vendor.lightspeed_vendor_id ? `${current?.name ?? vendor.lightspeed_name ?? 'Matched'} · PO ${usedCode}${today()}` : 'Not matched yet'}>
      <div className="space-y-3 text-sm">
        <p className="text-stone-700">In Lightspeed as: <strong>{vendor.lightspeed_vendor_id ? current?.name ?? vendor.lightspeed_name ?? `vendor ${vendor.lightspeed_vendor_id}` : 'not matched yet'}</strong></p>
        {canEdit ? (
          <div>
            <FormField label={vendor.lightspeed_vendor_id ? 'Change it' : 'Find it in Lightspeed'} htmlFor={`ls-pick-${vendor.id}`}>
              <Input id={`ls-pick-${vendor.id}`} value={pick} onChange={(e) => setPick(e.target.value)} placeholder={(ls.data ?? []).length ? 'Type part of the name' : 'Click Refresh from Lightspeed first'} />
            </FormField>
            {shown.length ? (
              <ul className="mt-1 divide-y divide-stone-100 rounded-lg border border-stone-200">
                {shown.map((v) => (
                  <li key={v.ls_vendor_id}><button type="button" disabled={!!busy} onClick={() => void save(v.ls_vendor_id, code)} className="w-full px-3 py-1.5 text-left hover:bg-stone-50">{v.name}{v.archived ? ' (archived)' : ''}</button></li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="PO code" htmlFor={`po-code-${vendor.id}`}>
            <Input id={`po-code-${vendor.id}`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={defaultCode(vendor.name)} disabled={!canEdit} className="w-40" />
          </FormField>
          {canEdit && code !== (vendor.po_code ?? '') ? <Button size="sm" loading={busy === 'save'} onClick={() => void save(vendor.lightspeed_vendor_id, code)}>Save</Button> : null}
          <p className="pb-2 text-xs text-stone-500">Our PO for an order today: <strong>{usedCode}{today()}</strong></p>
        </div>
        {canEdit ? <Button size="sm" variant="ghost" loading={busy === 'sync'} onClick={() => void refresh()} leftIcon={<RefreshCw className="size-4" aria-hidden="true" />}>Refresh from Lightspeed</Button> : null}
      </div>
    </FoldSection>
  )
}
