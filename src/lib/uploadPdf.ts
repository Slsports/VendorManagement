// Invoice Uploads (Dana, Oct 20): the pages someone took or picked become one PDF to send. Photos are shrunk and
// turned into JPEG pages (an iPhone's HEIC included, through the browser); PDFs keep their pages.

/** A page picked for an upload: a photo or a PDF from the device. */
export interface UploadPage { id: string; file: File; preview: string | null }

export const isPdf = (f: { type: string; name: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
export const isImage = (f: { type: string; name: string }) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name)

const MAX_SIDE = 2200

/** A photo as JPEG bytes, longest side at most 2200 px (keeps small print readable, the file small). */
async function photoJpeg(file: File): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error(`${file.name} is not a picture this device can open`))
      i.src = url
    })
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))
    if (!blob) throw new Error(`Could not read ${file.name}`)
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** All the pages, in order, as one PDF. */
export async function pagesToPdf(pages: File[], name: string): Promise<{ file: File; pageCount: number }> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  for (const f of pages) {
    if (isPdf(f)) {
      const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true })
      const copied = await doc.copyPages(src, src.getPageIndices())
      copied.forEach((p) => doc.addPage(p))
    } else {
      const { bytes, width, height } = await photoJpeg(f)
      const jpg = await doc.embedJpg(bytes)
      doc.addPage([width, height]).drawImage(jpg, { x: 0, y: 0, width, height })
    }
  }
  const bytes = await doc.save()
  return { file: new File([bytes as BlobPart], name, { type: 'application/pdf' }), pageCount: doc.getPageCount() }
}

/** One fingerprint for the files picked, so the same file sent twice is caught before Claude reads it. */
export async function pagesHash(pages: File[]): Promise<string> {
  const parts: string[] = []
  for (const f of pages) {
    const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
    parts.push([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''))
  }
  if (parts.length === 1) return parts[0]!
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Upload-day folders, newest first: "Today", "Yesterday", else "Mon, Oct 19, 2026". */
export function uploadDayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  const d = new Date(`${day}T12:00:00`)
  const t = new Date(`${today}T12:00:00`)
  if (Math.round((t.getTime() - d.getTime()) / 86_400_000) === 1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
