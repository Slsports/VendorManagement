import { Link } from 'react-router-dom'
import { MessagesSquare } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'

/** "Ask VMS" on a vendor or order page (Dana, Nov 5): opens a new chat that already knows this vendor or order. */
export function AskButton({ vendorId, orderId }: { vendorId?: string; orderId?: string }) {
  const { profile, isAdmin } = useAuth()
  if (!isAdmin && !profile?.ask_vms) return null
  const to = `${ROUTES.ask}?${vendorId ? `vendor=${vendorId}` : `order=${orderId}`}`
  return (
    <Link to={to} className="inline-flex h-11 items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50">
      <MessagesSquare className="size-4" aria-hidden="true" /> Ask VMS
    </Link>
  )
}
