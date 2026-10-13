import { describe, expect, it } from 'vitest'
import { checkUploadSize, readForUpload, uploadError } from './upload'

describe('uploads', () => {
  it('stops a file over 50 MB before uploading', () => {
    expect(() => checkUploadSize({ name: 'big.xlsx', size: 63 * 1024 * 1024 })).toThrow(/big\.xlsx is 63 MB; the most VMS can keep is 50 MB/)
    expect(() => checkUploadSize({ name: 'ok.xlsx', size: 3 * 1024 * 1024 })).not.toThrow()
  })
  it('reads the file first and says plainly when it cannot', async () => {
    const ok = await readForUpload(new File(['abc'], 'a.csv', { type: 'text/csv' }))
    expect(ok.size).toBe(3)
    const locked = { name: 'WFS.xlsx', type: '', arrayBuffer: () => Promise.reject(new Error('NotReadableError')) } as unknown as File
    await expect(readForUpload(locked)).rejects.toThrow(/couldn't read WFS\.xlsx.*open in Excel/)
  })
  it('says "Failed to fetch" in plain words', () => {
    expect(uploadError(new TypeError('Failed to fetch'), { name: 'WFS.xlsx', size: 2 * 1024 * 1024 }).message).toMatch(/WFS\.xlsx \(2\.0 MB\) did not upload/)
    expect(uploadError({ message: 'Bucket not found' }, { name: 'a.pdf', size: 1 }).message).toBe('Bucket not found')
  })
})
