import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FileSpreadsheet } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { readSalesExport, saveSalesReport, type ReadReport } from '@/services/ordering'
import { errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { Button, FormField, Input, Select } from '@/components/ui'

/**
 * "Upload sales report" (Dana, Oct 11): the raw LS Analytics export for this vendor. VMS formats it as a Vendor Sales
 * Report (spec v49), files it in Sales reports and opens the suggested order.
 */
export function SalesReportUpload({ vendor, onSaved, label = 'Upload sales report', variant = 'secondary' }: {
  vendor: { id: string; name: string; aliases?: string[] }
  onSaved: () => void
  label?: string
  variant?: 'primary' | 'secondary'
}) {
  const { organization, profile } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const [read, setRead] = useState<ReadReport | null>(null)
  const [fileName, setFileName] = useState('')
  const [lsVendor, setLsVendor] = useState('')
  const [days, setDays] = useState('365')
  const [busy, setBusy] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const r = await readSalesExport(file, vendor.name, vendor.aliases ?? [])
      setRead(r)
      setFileName(file.name)
      setLsVendor(r.guess ?? '')
      const m = file.name.match(/(\d{2,4})\s*DAYS/i)
      if (m) setDays(m[1]!)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function save() {
    if (!organization || !profile || !read) return
    if (!lsVendor) { toast.error('Pick which LS vendor in the file is ' + vendor.name); return }
    const n = Math.round(Number(days))
    setBusy(true)
    try {
      await saveSalesReport({ organizationId: organization.id, vendor, items: read.items.filter((x) => x.lsVendor === lsVendor), lsVendor, days: n > 0 ? n : 365, profile })
      toast.success('Sales report filed in Sales reports')
      setRead(null)
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const count = read?.lsVendors.find((v) => v.name === lsVendor)?.count ?? 0
  return (
    <>
      <Button size="sm" variant={variant} loading={busy && !read} onClick={() => input.current?.click()} leftIcon={<FileSpreadsheet className="size-4" aria-hidden="true" />}>{label}</Button>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="LS sales report file" onChange={(e) => void pick(e.target.files?.[0])} />
      {read ? (
        <Modal title={`Sales report · ${vendor.name}`} submitLabel="Make the report" busy={busy} onSubmit={save} onClose={() => setRead(null)}>
          <p className="text-stone-600">{fileName}: {read.items.length} item{read.items.length === 1 ? '' : 's'}{read.lsVendors.length > 1 ? ` from ${read.lsVendors.length} LS vendors` : ''}.</p>
          {read.lsVendors.length > 1 || !read.guess ? (
            <FormField label={`Which LS vendor is ${vendor.name}?`} htmlFor="sr-ls">
              <Select id="sr-ls" value={lsVendor} onChange={(e) => setLsVendor(e.target.value)}>
                <option value="">Pick one</option>
                {read.lsVendors.map((v) => <option key={v.name} value={v.name}>{v.name || '(no vendor)'} — {v.count} items</option>)}
              </Select>
            </FormField>
          ) : null}
          <FormField label="Sales period (days)" htmlFor="sr-days" hint="Goes in the file name, e.g. SALES 365 DAYS.">
            <Input id="sr-days" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
          </FormField>
          {lsVendor ? <p className="text-xs text-stone-500">{count} items for {lsVendor}. VMS formats them to the sales report spec, files the report in Sales reports and works out a suggested order.</p> : null}
        </Modal>
      ) : null}
    </>
  )
}
