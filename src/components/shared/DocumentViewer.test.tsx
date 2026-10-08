import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocumentViewer } from './DocumentViewer'

describe('DocumentViewer', () => {
  it('shows a spreadsheet as a table without downloading', async () => {
    const csv = new Blob(['Vendor ID,Item,Cost\nTY-1,Beanie Boo,4.50\n'], { type: 'text/csv' })
    render(<DocumentViewer doc={{ name: 'prices.csv', load: async () => csv }} onClose={vi.fn()} />)
    expect(await screen.findByText('Beanie Boo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  })
  it('offers the download for files it cannot show', async () => {
    render(<DocumentViewer doc={{ name: 'old letter.doc', load: async () => new Blob(['x']) }} onClose={vi.fn()} />)
    expect(await screen.findByText(/can't show this kind of file/)).toBeInTheDocument()
  })
})
