import { useState, type KeyboardEvent } from 'react'
import { matchBook, pickAddress, typingPart, type BookEntry } from '@/lib/addressMatch'
import { Input } from '@/components/ui'

/**
 * To and Cc in the email window (Dana, Nov 5): type part of a name, email or company ("jarr", "Worldwide", "Smith") and
 * the matching people pop up: our own staff, Worldwide's people, rep group reps and every vendor contact. Click one, or use
 * the arrow keys and Enter, and their address goes in; keep typing for the next one.
 */
export function AddressInput({ id, value, onChange, book, placeholder, required, label }: { id: string; value: string; onChange: (v: string) => void; book: BookEntry[]; placeholder?: string; required?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const chosen = value.split(/[,;]+/).map((a) => a.trim()).filter(Boolean)
  const hits = open ? matchBook(book, typingPart(value), chosen) : []
  const pick = (b: BookEntry) => { onChange(pickAddress(value, b.email)); setAt(0) }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(hits[Math.min(at, hits.length - 1)]!) }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
  }
  return (
    <div className="relative">
      <Input id={id} value={value} required={required} placeholder={placeholder} autoComplete="off" aria-label={label}
        role="combobox" aria-expanded={hits.length > 0} aria-controls={`${id}-list`}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setAt(0) }}
        onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} />
      {hits.length ? (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          {hits.map((b, i) => (
            <li key={b.email} role="option" aria-selected={i === at}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(b) }} onMouseEnter={() => setAt(i)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === at ? 'bg-brand-soft' : 'hover:bg-stone-50'}`}>
                <span className="font-medium text-stone-900">{b.name}</span> <span className="text-stone-500">{b.email}</span>
                <span className="block text-xs text-stone-500">{b.where}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
