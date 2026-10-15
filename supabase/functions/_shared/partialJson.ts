// Reading an answer that was cut off at its length limit (Dana, Oct 15: long invoices): the parts that were finished.
/** An answer cut off inside its item lines: the header fields as read, and every line that was finished. */
export function cutAnswer(text: string): { head: Record<string, unknown>; lines: unknown[] } | null {
  const at = text.indexOf('"lines":[')
  if (at < 0) return null
  try {
    const head = JSON.parse(`${text.slice(0, at)}"lines":[],"note":"","sure":false}`)
    delete head.lines
    return { head, lines: wholeObjects(text, '"lines":[') }
  } catch {
    return null
  }
}

/** The finished {...} objects in the array that starts at `marker`, ignoring the one cut off at the end. */
export function wholeObjects(text: string, marker: string): unknown[] {
  const start = text.indexOf(marker)
  if (start < 0) return []
  const out: unknown[] = []
  let depth = 0, from = -1, inStr = false, esc = false
  for (let i = start + marker.length; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') { if (depth === 0) from = i; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && from >= 0) {
        try { out.push(JSON.parse(text.slice(from, i + 1))) } catch { /* a broken line is skipped */ }
        from = -1
      }
    } else if (ch === ']' && depth === 0) break
  }
  return out
}
