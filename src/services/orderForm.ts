import { supabase } from '@/lib/supabase'

/** One cell a person types into on the vendor's form: a color (or size) column on an item row. */
export interface FormInput { ref: string; col: string; header: string | null; value: number | null }
export interface FormRow {
  row: number
  model: string
  description: string
  section: string | null
  inputs: FormInput[]
  price: number | null
  cpq: number | null
  cases: number | null
  units: number | null
  total: number | null
}
export interface FormModel {
  editable: boolean
  why?: string
  /** 'cases': the inputs are cases per color and the form multiplies by the case pack; 'units': the inputs are the quantity itself */
  mode: 'cases' | 'units'
  rows: FormRow[]
  total: number | null
}
export interface FormLine { row: number; vendor_item_id: string; description: string; quantity: number; unit_cost: number | null; colors: string | null }
export interface OrderFormView {
  file_name: string
  link_id: string
  form: FormModel
  lines: FormLine[]
  /** the email the order went out in: where the reply with the changes goes */
  sent: { email_id: string; thread_id: string | null; on: string; to: string[]; cc: string[] } | null
}
export interface FormEdit { ref: string; value: number | null }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('order-form', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let msg = error.message
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error } catch { /* keep the message */ }
    throw new Error(msg)
  }
  return data as T
}

/** The vendor's own order form we emailed, read as rows (Dana, Nov 13: edit an order and resend without downloading). */
export const readOrderForm = (orderId: string) => invoke<OrderFormView>({ action: 'read', order_id: orderId })

/**
 * Write the new numbers into the same form, file it as a revised copy, bring the order's lines up to date, and draft the
 * reply (revised form attached) in the conversation the order went out in. Returns the draft to open.
 */
export const sendOrderFormChanges = (orderId: string, edits: FormEdit[], note: string) =>
  invoke<{ draft_id: string; link_id: string; file_name: string; changes: string[]; total: number | null }>({ action: 'send', order_id: orderId, edits, note })
