import type { ShipmentRequest } from '@/types'

export const SHIPMENT_STATUS: Record<ShipmentRequest['status'], { text: string; tone: 'warning' | 'danger' | 'success' | 'neutral' | 'info' }> = {
  ready: { text: 'To send', tone: 'neutral' },
  sent: { text: 'Waiting on the vendor', tone: 'warning' },
  opened: { text: 'Opened, not answered', tone: 'warning' },
  answered: { text: 'Answered', tone: 'success' },
  confirmed: { text: 'Terms confirmed', tone: 'success' },
  disputed: { text: 'Freight will be charged', tone: 'danger' },
  skipped: { text: 'Not needed', tone: 'neutral' },
  cancelled: { text: 'Cancelled', tone: 'neutral' },
}

export function shipmentKindLabel(k: ShipmentRequest['kind']): string {
  return k === 'details' ? 'Shipment details and quote' : k === 'free_check' ? 'Free freight check' : k === 'half_check' ? 'Half freight check' : 'Freight cap check'
}
export function shipmentMethodLabel(m: ShipmentRequest['method']): string {
  return m === 'pallet' ? 'Pallet (LTL)' : m === 'parcel' ? 'Parcel (UPS/FedEx)' : '—'
}
export const FREIGHT_TERMS_LABELS: Record<'free' | 'half' | 'capped' | 'charged', string> = { free: 'Free freight', half: 'Half freight', capped: 'Capped at a %', charged: 'We pay freight' }
