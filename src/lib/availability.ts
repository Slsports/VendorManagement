// Ask the rep what is discontinued (Dana, Oct 21): the email that goes from the suggested order.

export interface AskItem { vid: string | null; name: string | null; qty: number }

/** The email asking the rep which items can still be ordered. Plain words; the signature is added when it is sent. */
export function availabilityEmail(vendorName: string, items: AskItem[]): { subject: string; body: string } {
  const rows = items.map((i) => `${(i.vid || '(no Vendor ID)').padEnd(14)}  ${(i.name || '').slice(0, 60)}${i.qty ? `  (we'd order ${i.qty})` : ''}`)
  return {
    subject: `Can we still order these? ${vendorName} reorder for Shaver Lake Sports`,
    body: [
      'Hi,',
      '',
      `We're putting together a reorder and want to be sure we only order what you can still ship. Could you look over the ${items.length === 1 ? 'item' : `${items.length} items`} below and let us know:`,
      '  - anything that has been discontinued, and its replacement if there is one',
      '  - anything that is out of stock, and when it will be back',
      '',
      'Vendor ID       Item',
      ...rows,
      '',
      'A quick note by item number is perfect, or mark up this list and send it back.',
      '',
      'Thank you!',
    ].join('\n'),
  }
}

export const ANSWER_WORD: Record<string, string> = {
  available: 'Rep: can order', discontinued: 'Rep: discontinued', replaced: 'Rep: replaced', out_of_stock: 'Rep: out of stock',
  unclear: 'Rep: not clear', not_mentioned: 'Rep: not answered',
}
