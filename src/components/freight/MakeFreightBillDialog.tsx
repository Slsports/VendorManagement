import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { makeFreightBillFromAttachment } from '@/services/freight'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Modal } from '@/components/shared/Modal'
import { CarrierPicker } from './CarrierPicker'

/**
 * "Freight bill" on a PDF in any email (Dana, Oct 8): a bill that came some other way (forwarded, sent by a
 * broker) becomes a freight bill. The mail sync fetches the PDF and Claude reads it within a minute or so.
 */
export function MakeFreightBillDialog({ attachment, carrierId, onClose }: { attachment: { id: string; file_name: string }; carrierId: string | null; onClose: () => void }) {
  const [carrier, setCarrier] = useState(carrierId ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`Make a freight bill from ${attachment.file_name}`} submitLabel="Make the bill" busy={busy} onClose={onClose} onSubmit={async () => {
      if (!carrier) { toast.error('Pick the carrier'); return }
      setBusy(true)
      try {
        const id = await makeFreightBillFromAttachment(attachment.id, carrier)
        toast((t) => (
          <span className="text-sm">Claude is reading it; it shows on <Link to={`${ROUTES.freight}/${id}`} onClick={() => toast.dismiss(t.id)} className="font-semibold text-brand hover:underline">the freight bill</Link> in a minute or so.</span>
        ), { duration: 8000 })
        onClose()
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <p className="text-sm text-stone-600">Which carrier billed it?</p>
      <CarrierPicker value={carrier} onChange={setCarrier} />
    </Modal>
  )
}
