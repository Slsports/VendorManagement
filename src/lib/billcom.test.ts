import { describe, expect, it } from 'vitest'
import { billcomRows } from './billcom'

describe('Bill.com payments export', () => {
  it('reads the columns of the export', () => {
    const rows = billcomRows([
      ['Payments'],
      ['Confirmation number', 'Vendor', 'Process date', 'Payment status', 'Payment method', 'Payment amount', 'Arrival date', 'Invoice number', 'Paid from', 'Vendor credit', 'Currency'],
      ['P26092102 - 0000001', 'Example Vendor A', 'Sep 21, 2026', 'Cleared', 'ePayment', 2639.5, 'Sep 22, 2026', '0055809-IN', 'BILL balance', '0', 'USD'],
      ['P26091502 - 0000003', 'PartnerShip LLC', 'Sep 16, 2026', 'Cleared', 'Check', '$6,510.48', 'Sep 21, 2026', 'PS00618480', 'Example Bank ****0000', '0', 'USD'],
      ['', '', '', '', '', '', '', '', '', '', ''],
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ confirmation: 'P26092102 - 0000001', payee: 'Example Vendor A', process_date: '2026-09-21', method: 'ePayment', amount: 2639.5, invoice_number: '0055809-IN' })
    expect(rows[1]).toMatchObject({ payee: 'PartnerShip LLC', amount: 6510.48, arrival_date: '2026-09-21', paid_from: 'Example Bank ****0000' })
  })
  it('says so when it is not the payments export', () => {
    expect(() => billcomRows([['Name', 'Total']])).toThrow(/Bill.com Payments export/)
  })
})
