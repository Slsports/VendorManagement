import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import BulkImportPage from './BulkImportPage'

const { fileImportedDocument, stageImportFile } = vi.hoisted(() => ({
  fileImportedDocument: vi.fn(async () => undefined),
  stageImportFile: vi.fn(async () => 'o1/import/x.pdf'),
}))
vi.mock('@/services/documentImport', () => ({
  listVendorsForMatching: vi.fn(async () => [{ id: 'stan', name: 'STANSPORT', aliases: [], is_active: true }, { id: 'pc', name: 'Planet Cotton', aliases: [], is_active: true }]),
  listExistingDocKeys: vi.fn(async () => new Set(['pc|old.pdf|3'])),
  docKey: (v: string, n: string, s: number | null) => `${v}|${n.toLowerCase()}|${s ?? ''}`,
  fileImportedDocument, stageImportFile, askClaudeWhere: vi.fn(), removeStagedFiles: vi.fn(),
}))
vi.mock('@/services/mail', () => ({ listVendorNames: vi.fn(async () => []), clearPickerCache: vi.fn() }))

function file(path: string, body = 'abc') {
  const f = new File([body], path.split('/').pop()!, { type: 'application/pdf', lastModified: new Date('2022-05-01').getTime() })
  Object.defineProperty(f, 'webkitRelativePath', { value: path })
  return f
}

describe('BulkImportPage', () => {
  it('sorts dropped folders by vendor, folder and year, skips what is in VMS, and files the ready ones', async () => {
    const { container } = render(withAuth('buyer', <BulkImportPage />))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeEnabled())
    const input = container.querySelector('input[webkitdirectory]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file('Stansport/Invoices/2024/INV 1.pdf'), file('Stansport/scan.pdf'), file('Planet Cotton/Catalogs/old.pdf'), file('Stansport/.DS_Store')] } })
    expect(await screen.findByText(/Need a look \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Ready to file \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 already in VMS/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'File 1 document' }))
    await waitFor(() => expect(fileImportedDocument).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'stan', kind: 'invoice', year: 2024, originalPath: 'Stansport/Invoices/2024/INV 1.pdf' })))
    expect(await screen.findByText(/Filed \(1\)/)).toBeInTheDocument()
  })
})
