import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocumentViewer } from './DocumentViewer'

describe('DocumentViewer', () => {
  it('shows a spreadsheet as a table without downloading', async () => {
    const csv = new Blob(['Vendor ID,Item,Cost\nTY-1,Beanie Boo,4.50\n'], { type: 'text/csv' })
    render(<DocumentViewer doc={{ name: 'prices.csv', load: async () => csv }} onClose={vi.fn()} />)
    expect(await screen.findByText('Beanie Boo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled()
  })
  it('keeps a report\'s frozen header rows on screen', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Size summary')
    ws.addRow(['Planet Cotton sales'])
    ws.addRow(['Item', 'Size', 'Sold'])
    ws.addRow(['Tee', 'M', 4])
    ws.views = [{ state: 'frozen', ySplit: 2 }]
    const buf = await wb.xlsx.writeBuffer()
    const { container } = render(<DocumentViewer doc={{ name: 'report.xlsx', load: async () => new Blob([buf]) }} onClose={vi.fn()} />)
    expect(await screen.findByText('Tee')).toBeInTheDocument()
    const head = document.body.querySelector('thead')
    expect(head?.textContent).toContain('Planet Cotton sales')
    expect(head?.textContent).toContain('Sold')
    expect(head?.textContent).not.toContain('Tee')
    expect(container).toBeTruthy()
  })
  it('offers the download for files it cannot show', async () => {
    render(<DocumentViewer doc={{ name: 'old letter.doc', load: async () => new Blob(['x']) }} onClose={vi.fn()} />)
    expect(await screen.findByText(/can't show this kind of file/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
  })
})
