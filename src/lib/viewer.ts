// What the in-app document viewer can show, from the file name and type.
export type DocType = 'pdf' | 'image' | 'sheet' | 'word' | 'text' | 'other'

export function docType(fileName: string, mime?: string | null): DocType {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const m = (mime ?? '').toLowerCase()
  if (ext === 'pdf' || m === 'application/pdf') return 'pdf'
  if (/^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext) || (m.startsWith('image/') && !m.includes('heic'))) return 'image'
  if (/^(xlsx|xlsm|xls|csv|ods|numbers)$/.test(ext) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv') return ext === 'numbers' ? 'other' : 'sheet'
  if (ext === 'docx' || m.includes('wordprocessingml')) return 'word'
  if (/^(txt|text|log|md)$/.test(ext) || m === 'text/plain') return 'text'
  return 'other'
}

/** Save a file to the computer or phone under its own name. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
