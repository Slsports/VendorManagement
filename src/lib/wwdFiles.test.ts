import { describe, expect, it } from 'vitest'
import { dateInTitle, htmlTableRows, parseWwdTable, scanToInvoices, wwdMoney } from './wwdFiles'
import { allowanceState } from './wwdAllowance'

describe('WWD files', () => {
  it('reads the Payment History export (an HTML table)', () => {
    const html = `<table><tr><td><strong>Check #</strong></td><td>Check Date</td><td>Check Amount</td><td>Invoice/Credit #</td><td>Invoice Date</td></tr>
      <tr><td>PB109559</td><td>09/15/2026</td><td>2183.95</td><td align="right">TOTAL</td><td>09/15/2026</td></tr>
      <tr><td>PB109559</td><td>09/15/2026</td><td>-169.77</td><td>7428960</td><td>08/28/2026</td></tr>
      <tr><td>PB109559</td><td>09/15/2026</td><td>0.00</td><td>7428960</td><td>08/28/2026</td></tr></table>`
    const { kind, batch } = parseWwdTable(htmlTableRows(html), 'Payment-History.xls')
    expect(kind).toBe('history')
    expect(batch.payments).toEqual([{ ref: 'PB109559', pay_date: '2026-09-15', total: 2183.95 }])
    expect(batch.lines).toEqual([{ ref: 'PB109559', pay_date: '2026-09-15', seq: '7428960', amount: -169.77, wwd_date: '2026-08-28' }])
  })

  it('reads the EdenRed export with PO, vendor and their invoice number', () => {
    const t = [
      ['Invoice Type', 'Seq No / AR Invoice No', 'PO Number', 'Vendor Name', 'Received Date', 'Invoice Number', 'Invoice Date', 'Invoice Amount', 'Free Freight Allowed', 'Freight Amount', 'Terms Text', 'AP Terms', 'Hard Due Date (AR)'],
      ['CM', '07202949', 'RAPALA-FALL8-17-2025', 'NORMARK CORP / RAPALA', '11/04/2025', '1856719', '10/22/2025', -256.95, 'N', '', '6% 30', 'ASAP', ''],
    ]
    const { kind, batch } = parseWwdTable(t, 'ER.xlsx')
    expect(kind).toBe('edenred')
    expect(batch.invoices[0]).toMatchObject({ seq: '7202949', kind: 'credit', po_number: 'RAPALA-FALL8-17-2025', vendor_name: 'NORMARK CORP / RAPALA', wwd_date: '2025-11-04', vendor_invoice_number: '1856719', amount: -256.95 })
  })

  it('reads a payment sheet: title date, discount, a total row skipped', () => {
    const t = [
      ['WORLDWIDE PAYMENT 1/16/26   $15,483.81'],
      ['Invoice #', 'Disc Date', 'Date Inv', 'Date Due', 'Desc', 'Vendor', 'Inv Amt', 'Disc Avail', 'Amt Due'],
      [3735964, '2/10/2026', '10/13/2025', '2/11/2026', 'INV', 'Normark Corp / Rapala', 334.8, 20.09, 314.71],
      [1773414, '', '12/30/2025', '1/29/2026', 'INV', '', 275, 0, 275],
      ['', '', '', '', '', '', '', 'TOTAL', 15483.81],
    ]
    const { kind, batch } = parseWwdTable(t, 'x.xlsx')
    expect(kind).toBe('sheet')
    expect(batch.invoices).toHaveLength(2)
    expect(batch.invoices[0]).toMatchObject({ seq: '3735964', vendor_name: 'Normark Corp / Rapala', discount: 20.09, sheet_paid_date: '2026-01-16', kind: 'invoice' })
    expect(batch.invoices[1]).toMatchObject({ seq: '1773414', vendor_name: null, amount: 275 })
  })

  it('reads a sheet pasted without headers, and a vendor typed into the invoice cell', () => {
    const noHead = [['WORLDWIDE PAYMENT    11/14/24   - $34,695.64'], ['', 5874787, 45588, 45589, 'CRD', 'California Mango Bath & Body', -527.2, 0, -527.2]]
    expect(parseWwdTable(noHead, 'WWD_PAYMENT_11-14-24.xlsx').batch.invoices[0]).toMatchObject({ seq: '5874787', kind: 'credit', vendor_name: 'California Mango Bath & Body', amount: -527.2, wwd_date: '2024-10-23', sheet_paid_date: '2024-11-14' })
    const typed = [['PAID 3/19/24 $5,957.42'], ['Invoice #', 'Date Inv', 'Desc', 'Inv Amt', 'Amt Due'], ['Troll  6875730', '2/6/24', 'INV', '$1,959.75', '$1959.75']]
    expect(parseWwdTable(typed, 'a.docx').batch.invoices[0]).toMatchObject({ seq: '6875730', vendor_name: 'Troll', amount: 1959.75, sheet_paid_date: '2024-03-19' })
  })

  it('reads money and dates the way the sheets write them', () => {
    expect(wwdMoney('($170.56)')).toBe(-170.56)
    expect(wwdMoney('$1,296.00')).toBe(1296)
    expect(dateInTitle('10-8-26_WORLDWIDE_PAYMENT_96778.41')).toBe('2026-10-08')
    expect(dateInTitle('WORLDWIDE PAYMENT 12-5-25 TOTAL PAID: $52,987.96')).toBe('2025-12-05')
  })

  it('turns what Claude read from a scan into rows', () => {
    const rows = scanToInvoices({ payments: [{ paid_date: '2024-05-27', lines: [{ seq: '6911153', kind: 'invoice', vendor_name: 'ORB', wwd_date: '2024-05-06', due_date: '2024-06-05', amount: 570.9, discount: null }] }] })
    expect(rows[0]).toMatchObject({ seq: '6911153', vendor_name: 'ORB', sheet_paid_date: '2024-05-27', source: 'scan' })
  })
})

describe('freight allowance reminder', () => {
  const today = '2026-10-09'
  it('counts down to the pay-by date and turns red in the last week', () => {
    expect(allowanceState({ freight_allowance_pay_by: '2026-11-30', freight_allowance_received: null, paid_date: null }, today).tone).toBe('neutral')
    expect(allowanceState({ freight_allowance_pay_by: '2026-10-20', freight_allowance_received: null, paid_date: null }, today).tone).toBe('warning')
    expect(allowanceState({ freight_allowance_pay_by: '2026-10-12', freight_allowance_received: null, paid_date: null }, today)).toEqual({ tone: 'danger', text: 'Pay within 3 days to keep it.' })
    expect(allowanceState({ freight_allowance_pay_by: '2026-10-01', freight_allowance_received: null, paid_date: null }, today).text).toMatch(/passed 8 days ago/)
  })
  it('knows when it was paid late or the credit came', () => {
    expect(allowanceState({ freight_allowance_pay_by: '2026-10-01', freight_allowance_received: null, paid_date: '2026-10-05' }, today).tone).toBe('danger')
    expect(allowanceState({ freight_allowance_pay_by: '2026-10-01', freight_allowance_received: '2026-10-07', paid_date: '2026-09-30' }, today).text).toBe('Credit received.')
  })
})
