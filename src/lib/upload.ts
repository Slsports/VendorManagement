/** The biggest file VMS keeps (Dana, Oct 13: a WFS sales report failed with "Failed to fetch"). Matches the storage bucket. */
export const MAX_UPLOAD_MB = 50

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)

/** Say plainly, before uploading, when a file is too big to keep. */
export function checkUploadSize(file: { name: string; size: number }): void {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`${file.name} is ${mb(file.size)} MB; the most VMS can keep is ${MAX_UPLOAD_MB} MB. Save a smaller copy (for a spreadsheet, delete extra tabs or pictures) and try again.`)
  }
}

/**
 * The file's bytes, read before uploading (Dana, Oct 13: the WFS spreadsheet never reached VMS — the browser could not
 * read it while it was open in Excel or still only in OneDrive). Reading first turns that into a plain message.
 */
export async function readForUpload(file: File): Promise<Blob> {
  try {
    return new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
  } catch {
    throw new Error(`VMS couldn't read ${file.name} from your computer. If it's open in Excel, close it (or save and close it). If it's in OneDrive, open the folder so it downloads. Then try again.`)
  }
}

/** The browser's "Failed to fetch" in words people can act on. */
export function uploadError(err: unknown, file: { name: string; size: number }): Error {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  if (/failed to fetch|networkerror|load failed|payload too large|maximum allowed size|413/i.test(msg)) {
    return new Error(`${file.name} (${mb(file.size)} MB) did not upload. If it's open in Excel, close it; then try again. If it still fails, the internet connection may have dropped.`)
  }
  return err instanceof Error ? err : new Error(msg)
}
