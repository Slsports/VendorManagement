/**
 * Which reminders come by text (Dana, Nov 4: "I would like to be able to tell the system what types of alerts I want to my
 * texts … categories of things so I can just get them for my most important tasks"). Each person ticks categories in
 * Settings (profiles.text_categories; empty = every category, as before); a task's own Text me switch (tasks.text_me) wins.
 * Unticked categories still reach the dashboard and email. Used by task-reminders and by the Settings screen.
 */
export const TEXT_CATEGORIES = [
  { key: 'price_lists', label: 'Price lists and catalogs arrived', example: 'A rep sent what you asked for' },
  { key: 'payments', label: 'Payments due and discounts', example: 'WWD due and discount dates, Bill.com, autopay, sales tax' },
  { key: 'insurance', label: 'Insurance and contracts', example: 'Renewals, proof of insurance, contract payments' },
  { key: 'orders', label: 'Orders and shipping', example: 'Cancellations, backorders and delays, shipping problems' },
  { key: 'freight', label: 'Freight', example: 'Freight quotes to send or approve, freight bills to split' },
  { key: 'proofs', label: 'Proofs and artwork', example: 'Proofs to approve' },
  { key: 'credits', label: 'Credits and returns', example: 'Credits owed, credits we asked for' },
  { key: 'questions', label: 'Questions waiting on you', example: 'A vendor asked you something, promises, deadlines, replies' },
  { key: 'from_person', label: 'Tasks from a person', example: 'Tasks someone gave you or you made, and when a task you gave is done' },
  { key: 'admin', label: 'Weekly and admin work', example: 'WWD weekly upload, Edenred files, backorder follow-ups, everything else' },
] as const

export type TextCategory = (typeof TEXT_CATEGORIES)[number]['key']

/** Dana's picks (Nov 4), also offered to anyone turning texts on. */
export const SUGGESTED_TEXT_CATEGORIES: TextCategory[] = ['price_lists', 'payments', 'insurance', 'questions']

const BY_KIND: Record<string, TextCategory> = {
  pricelist: 'price_lists',
  wwd: 'payments', billcom: 'payments', billcom_enter: 'payments', autopay: 'payments', autopay_sched: 'payments', cdtfa: 'payments', cdtfa_mbs: 'payments',
  policy_renewal: 'insurance', policy_send: 'insurance', policy_bill: 'insurance', proof_due: 'insurance',
  contract_payment: 'insurance', contract_renewal: 'insurance', contract_followup: 'insurance',
  order: 'orders', shipupd: 'orders', wfs_bo_ask: 'orders', lspo: 'orders', create_po: 'orders', ship: 'orders', shipcheck: 'orders',
  shipdispute: 'orders', shipdispute_cc: 'orders', shipreq: 'orders', shipreq_noemail: 'orders',
  freight_quote: 'freight', fqask: 'freight', freight_share: 'freight', freightbill: 'freight',
  proof: 'proofs',
  credit: 'credits', credit_req: 'credits',
  ask: 'questions', promise: 'questions', reply: 'questions', deadline: 'questions', vmscmd: 'questions',
}

/** The category of a task from its automatic key ("wwd:123:due" → payments); a task a person made has none. */
export function textCategory(autoKey: string | null | undefined): TextCategory {
  if (!autoKey) return 'from_person'
  return BY_KIND[autoKey.split(':')[0]!] ?? 'admin'
}

/** Whether this reminder goes by text: the task's own switch, else the person's categories (none chosen = all). */
export function textWanted(category: TextCategory | null, chosen: readonly string[] | null | undefined, taskTextMe?: boolean | null): boolean {
  if (taskTextMe != null) return taskTextMe
  if (!category || !chosen || !chosen.length) return true
  return chosen.includes(category)
}
