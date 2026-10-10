import { useParams } from 'react-router-dom'
import { ComingSoon } from '@/components/shared/ComingSoon'

const COPY: Record<string, { phase: number; text: string }> = {
  users: { phase: 6, text: 'Invite people, set roles (admin, manager, buyer, viewer, uploader), grant stores, deactivate.' },
  'payment-terms': { phase: 6, text: 'Your list of terms: Net 30, due on receipt, early-payment discounts, fixed due day of month. One marked default.' },
  categories: { phase: 6, text: 'Categories synced from Lightspeed, with the standard category report definition.' },
  integrations: { phase: 4, text: 'Lightspeed, Gmail, Google Drive and the Claude API key, each per organization. Excluded Bill.com payees live here too.' },
  branding: { phase: 6, text: 'Logo, app name and accent color for this organization.' },
}

export default function PlaceholderSettings() {
  const { tab = '' } = useParams()
  const copy = COPY[tab] ?? { phase: 6, text: '' }
  return <ComingSoon phase={copy.phase}>{copy.text}</ComingSoon>
}
