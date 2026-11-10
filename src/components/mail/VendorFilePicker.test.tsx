import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VendorFilePicker } from './VendorFilePicker'

describe('VendorFilePicker', () => {
  it('offers any vendor\'s files and keeps the chips of files picked from another vendor', () => {
    const other = vi.fn()
    render(<VendorFilePicker links={[]} selected={['l1']} onChange={vi.fn()} labels={new Map([['l1', 'Invoice 555']])} onOtherVendor={other} />)
    expect(screen.getByText('Invoice 555')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Attach from any vendor's files" }))
    expect(other).toHaveBeenCalled()
  })
})
