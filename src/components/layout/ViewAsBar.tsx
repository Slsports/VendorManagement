import { Eye } from 'lucide-react'
import { useViewAs } from '@/hooks/useViewAs'
import { Select } from '@/components/ui'

/** The admin's "Showing" switch, for the top bar. */
export function ViewAsSelect() {
  const { canSwitch, choice, setChoice, people } = useViewAs()
  if (!canSwitch) return null
  return (
    <label className="hidden items-center gap-1.5 text-sm text-stone-600 md:flex">
      <Eye className="size-4 text-stone-400" aria-hidden="true" />
      <span className="sr-only">Showing</span>
      <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Showing whose view" className="h-9 w-44">
        <option value="me">Showing: Me</option>
        <option value="all">Showing: Everyone</option>
        {people.map((p) => <option key={p.id} value={p.id}>Showing: {p.full_name}</option>)}
      </Select>
    </label>
  )
}

/** A colored bar while an admin looks at someone else's view or everyone's, so it is never forgotten. */
export function ViewAsBanner() {
  const { canSwitch, isMe, personName, personId, setChoice, choice, people } = useViewAs()
  if (!canSwitch) return null
  return (
    <div className={isMe ? 'md:hidden' : ''}>
      <div className={isMe ? 'flex items-center gap-2 border-b border-stone-200 bg-white px-4 py-1.5 text-sm' : 'flex flex-wrap items-center gap-2 bg-violet-600 px-4 py-1.5 text-sm text-white sm:px-6 lg:px-8'}>
        <Eye className="size-4" aria-hidden="true" />
        {isMe ? null : <span className="font-medium">{personId ? `Showing ${personName ?? 'their'}'s view` : 'Showing everyone'}</span>}
        <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Showing whose view"
          className={isMe ? 'rounded border border-stone-300 bg-white px-2 py-0.5 text-sm md:hidden' : 'rounded border border-white/40 bg-violet-700 px-2 py-0.5 text-sm text-white'}>
          <option value="me">Me</option>
          <option value="all">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        {isMe ? null : <button type="button" onClick={() => setChoice('me')} className="ml-auto rounded px-2 py-0.5 font-medium underline hover:bg-violet-700">Back to mine</button>}
      </div>
    </div>
  )
}
