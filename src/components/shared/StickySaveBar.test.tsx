import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StickySaveBar } from './StickySaveBar'

describe('StickySaveBar', () => {
  it('submits the form, cancels, and shows saving and the error on the bar', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    const onCancel = vi.fn()
    const { rerender } = render(<form onSubmit={onSubmit}><StickySaveBar saving={false} onCancel={onCancel} /></form>)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSubmit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    rerender(<form onSubmit={onSubmit}><StickySaveBar saving error="Name is required." onCancel={onCancel} /></form>)
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.')
    expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0)
  })
})
