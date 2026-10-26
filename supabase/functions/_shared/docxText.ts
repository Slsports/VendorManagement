// A Word .docx as text (Dana, Oct 26: 581 .docx files in her Dropbox). Claude reads PDFs, pictures and text, so the words
// come out of the document (word/document.xml inside the zip): paragraphs on their own lines, table cells separated by
// " | ", the layout dropped. Old .doc files (Word 97-2003, a binary format) are not read. Deno only; the zip reader loads
// only when a .docx comes along.
export async function docxText(bytes: Uint8Array, maxChars = 20_000): Promise<string | null> {
  const { unzipSync, strFromU8 } = await import('npm:fflate@0.8.2')
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' }) } catch { return null }
  const xml = files['word/document.xml']
  if (!xml) return null
  const text = strFromU8(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:p>|<w:br\/>|<w:cr\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return text ? text.slice(0, maxChars) : null
}
