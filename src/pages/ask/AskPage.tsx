import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { MessagesSquare, Plus, Send, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { askVms, decideChangeRequest, deleteAskChat, listAskChats, listAskMessages, listAskPeople, listChangeRequests, myAskSpend, type ChangeRequestRow } from '@/services/ask'
import { dollars } from '@/lib/chatText'
import { cn, errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { ChatAnswer } from '@/components/ask/ChatAnswer'
import { Badge, Button, Select, Spinner, Textarea } from '@/components/ui'
import type { AskMessage } from '@/types'

const LIMIT = 5
const EXAMPLES = [
  'Compare all our goggles across brands: what sold last winter and the winter before at SLS, what is in stock, and what is on order.',
  'Which open orders ship this month, and do any have no confirmation yet?',
  'What did we buy from Knockaround last year, and how much of it sold?',
]

/**
 * Ask VMS (Dana, Nov 5): talk through buying questions the way Dana did with Claude on the Smith orders. Claude reads
 * VMS (sales and stock from LS, orders and their papers, the mail the person can see), links every number to where it
 * came from, and can write a draft or pass a request to change VMS to Dana. Dana reads everyone's chats.
 */
export default function AskPage() {
  const { organization, profile, isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'changes' ? 'changes' : 'chats'
  const chatId = params.get('chat')
  const [showing, setShowing] = useState<string>('me')
  const org = organization?.id ?? ''
  const owner = !isAdmin || showing === 'me' ? profile?.id ?? null : showing === 'all' ? null : showing
  const chats = useSupabaseQuery(() => (org ? listAskChats(org, owner) : Promise.resolve([])), [org, owner])
  const people = useSupabaseQuery(() => (org && isAdmin ? listAskPeople(org) : Promise.resolve([])), [org, isAdmin])
  const changes = useSupabaseQuery(() => (org ? listChangeRequests(org) : Promise.resolve([])), [org, tab])
  const waiting = (changes.data ?? []).filter((c) => c.status === 'waiting').length

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k) }
    setParams(p)
  }

  return (
    <div>
      <PageHeader title="Ask VMS" description="Ask buying questions in plain words: what's on order, what sold, what's on the shelf, where brands overlap. Every number links to where it came from. Ask VMS only reads; it never changes anything or sends email." />
      <div className="mb-4 flex gap-1 border-b border-stone-200">
        {[{ id: 'chats', label: 'Chats' }, { id: 'changes', label: `Change requests${waiting ? ` (${waiting})` : ''}` }].map((t) => (
          <button key={t.id} type="button" onClick={() => go({ tab: t.id === 'chats' ? null : t.id })}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === t.id ? 'border-brand text-brand' : 'border-transparent text-stone-600 hover:text-stone-900')}>{t.label}</button>
        ))}
      </div>
      {tab === 'changes' ? <ChangeRequests rows={changes.data ?? []} isAdmin={isAdmin} loading={changes.isLoading} onChange={changes.refetch} onOpenChat={(id) => go({ tab: null, chat: id })} /> : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-3">
            <Button className="w-full" variant="secondary" leftIcon={<Plus className="size-4" aria-hidden="true" />} onClick={() => go({ chat: null, vendor: null, order: null })}>New chat</Button>
            {isAdmin ? (
              <Select aria-label="Showing" value={showing} onChange={(e) => setShowing(e.target.value)} className="h-9 w-full">
                <option value="me">Showing: my chats</option>
                <option value="all">Showing: everyone</option>
                {(people.data ?? []).filter((p) => p.id !== profile?.id).map((p) => <option key={p.id} value={p.id}>Showing: {p.full_name || p.email}</option>)}
              </Select>
            ) : null}
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
              {(chats.data ?? []).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => go({ chat: c.id, vendor: null, order: null })}
                    className={cn('w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100', c.id === chatId && 'bg-brand-soft')}>
                    <span className="line-clamp-2 font-medium text-stone-900">{c.title || 'Chat'}</span>
                    <span className="block text-xs text-stone-500">
                      {c.owner_id !== profile?.id ? `${c.owner?.full_name || c.owner?.email} · ` : ''}{new Date(c.updated_at).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
              {chats.data && !chats.data.length ? <li className="px-3 text-sm text-stone-500">No chats yet.</li> : null}
            </ul>
          </aside>
          <ChatView key={chatId ?? 'new'} chatId={chatId} vendorId={params.get('vendor')} orderId={params.get('order')}
            mine={!chatId || (chats.data ?? []).some((c) => c.id === chatId && c.owner_id === profile?.id)}
            onStarted={(id) => { go({ chat: id, vendor: null, order: null }); void chats.refetch() }}
            onDeleted={() => { go({ chat: null }); void chats.refetch() }} />
        </div>
      )}
    </div>
  )
}

function ChatView({ chatId, vendorId, orderId, mine, onStarted, onDeleted }: { chatId: string | null; vendorId: string | null; orderId: string | null; mine: boolean; onStarted: (id: string) => void; onDeleted: () => void }) {
  const messages = useSupabaseQuery(() => (chatId ? listAskMessages(chatId) : Promise.resolve([] as AskMessage[])), [chatId])
  const spend = useSupabaseQuery(() => myAskSpend(), [chatId])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const list = messages.data ?? []
  const working = list.some((m) => m.status === 'working')
  const { refetch } = messages
  const refetchSpend = spend.refetch

  // while Claude works, look again every few seconds; then refresh today's spend
  useEffect(() => {
    if (!working) return
    const t = window.setInterval(() => { void refetch() }, 2500)
    return () => { window.clearInterval(t); void refetchSpend() }
  }, [working, refetch, refetchSpend])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [list.length, working])

  const spent = spend.data ?? 0
  const over = spent >= LIMIT

  async function send(question = text) {
    const q = question.trim()
    if (!q || sending) return
    setSending(true)
    try {
      const r = await askVms({ message: q, chatId, vendorId, orderId })
      setText('')
      if (!chatId) onStarted(r.chat_id)
      else await refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }

  async function remove() {
    if (!chatId || !window.confirm('Delete this chat?')) return
    try { await deleteAskChat(chatId); onDeleted() } catch (err) { toast.error(errorMessage(err)) }
  }

  return (
    <section className="flex min-h-[60vh] flex-col rounded-2xl border border-stone-200 bg-white">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!chatId ? (
          <div className="text-sm text-stone-600">
            <p className="flex items-center gap-2 font-medium text-stone-900"><MessagesSquare className="size-4" aria-hidden="true" /> Ask a buying question</p>
            {vendorId || orderId ? <p className="mt-1">This chat starts from the {vendorId ? 'vendor' : 'order'} you came from, so you can just say "this vendor" or "this order".</p> : null}
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-500">For example</p>
            <ul className="mt-1 space-y-1">
              {EXAMPLES.map((q) => <li key={q}><button type="button" onClick={() => setText(q)} className="text-left text-brand hover:underline">{q}</button></li>)}
            </ul>
          </div>
        ) : null}
        {list.map((m) => m.role === 'user' ? (
          <div key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-brand-soft px-4 py-2 text-sm text-stone-900">{m.content}</div>
        ) : (
          <div key={m.id} className="max-w-full">
            {m.status === 'working' ? <Spinner label={m.progress ?? 'Working…'} className="text-sm text-stone-600" /> : <ChatAnswer text={m.content} />}
            <LookedUp m={m} />
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="border-t border-stone-200 p-3">
        {mine ? (
          <>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={3} placeholder={over ? "You've reached today's limit. It starts over tomorrow." : 'Ask a question… (Enter sends, Shift+Enter for a new line)'} disabled={over || working} aria-label="Your question" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-stone-500">Today: {dollars(spent)} of {dollars(LIMIT)}</span>
              <span className="flex gap-2">
                {chatId ? <Button size="sm" variant="ghost" onClick={() => void remove()} leftIcon={<Trash2 className="size-4" aria-hidden="true" />}>Delete chat</Button> : null}
                <Button size="sm" loading={sending} disabled={!text.trim() || over || working} onClick={() => void send()} leftIcon={<Send className="size-4" aria-hidden="true" />}>Ask</Button>
              </span>
            </div>
          </>
        ) : <p className="text-sm text-stone-500">You're reading someone else's chat. Only they can write in it.</p>}
      </div>
    </section>
  )
}

/** What Claude looked up for an answer, and what it cost: for Dana's coaching reads (Nov 5). */
function LookedUp({ m }: { m: AskMessage }) {
  const steps = Array.isArray(m.steps) ? (m.steps as { tool: string; summary: string }[]) : []
  if (m.status === 'working' || (!steps.length && !m.cost_usd)) return null
  return (
    <details className="mt-1 text-xs text-stone-500">
      <summary className="cursor-pointer">What I looked up{m.cost_usd ? ` · ${dollars(Number(m.cost_usd))}` : ''}</summary>
      <ul className="mt-1 list-disc pl-5">{steps.map((s, i) => <li key={i}>{STEP_LABELS[s.tool] ?? s.tool}: {s.summary}</li>)}</ul>
    </details>
  )
}
const STEP_LABELS: Record<string, string> = {
  find_vendors: 'Vendors', list_categories: 'LS categories', sales_and_stock: 'Sales and stock', orders: 'Orders', order_paperwork: 'Order and its paperwork',
  vendor_files: 'Vendor files', search_mail: 'Mail search', read_email: 'Read an email', draft_email: 'Draft written', request_change: 'Change request sent',
}

const STATUS: Record<ChangeRequestRow['status'], { label: string; tone: 'warning' | 'success' | 'neutral' | 'info' }> = {
  waiting: { label: 'Waiting for Dana', tone: 'warning' }, approved: { label: 'Approved', tone: 'info' }, declined: { label: 'Turned down', tone: 'neutral' }, built: { label: 'Built', tone: 'success' },
}

function ChangeRequests({ rows, isAdmin, loading, onChange, onOpenChat }: { rows: ChangeRequestRow[]; isAdmin: boolean; loading: boolean; onChange: () => Promise<void>; onOpenChat: (id: string) => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  async function decide(id: string, status: 'approved' | 'declined' | 'built') {
    setBusy(id)
    try {
      await decideChangeRequest(id, status, notes[id] ?? '')
      toast.success(status === 'declined' ? 'Turned down; they get your note as a task' : status === 'built' ? 'Marked built' : 'Approved; they get your note as a task')
      await onChange()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  if (loading && !rows.length) return <Spinner label="Loading…" />
  if (!rows.length) return <p className="text-sm text-stone-500">No change requests yet. When someone asks Ask VMS to change how VMS works, the request comes here for Dana.</p>
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">Only Dana changes VMS. Approved requests are built by Claude when Dana asks for them in her own Claude chat.</p>
      {rows.map((r) => (
        <article key={r.id} className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-stone-900">{r.title}</h3>
            <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            <span className="text-xs text-stone-500">{r.requester?.full_name || r.requester?.email} · {new Date(r.created_at).toLocaleDateString()}</span>
            {r.chat_id ? <button type="button" onClick={() => onOpenChat(r.chat_id!)} className="text-xs text-brand hover:underline">Open the chat</button> : null}
          </div>
          {r.details ? <p className="mt-2 whitespace-pre-wrap text-stone-700">{r.details}</p> : null}
          {r.why ? <p className="mt-1 text-stone-600"><span className="font-medium">Why:</span> {r.why}</p> : null}
          {r.decision_note ? <p className="mt-1 text-stone-600"><span className="font-medium">Dana:</span> {r.decision_note}</p> : null}
          {isAdmin && (r.status === 'waiting' || r.status === 'approved') ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {r.status === 'waiting' ? (
                <>
                  <input value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} placeholder="A note for them (optional)" aria-label="Note" className="h-9 min-w-56 flex-1 rounded-lg border border-stone-300 px-3 text-sm" />
                  <Button size="sm" loading={busy === r.id} onClick={() => void decide(r.id, 'approved')}>Approve</Button>
                  <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => void decide(r.id, 'declined')}>Turn down</Button>
                </>
              ) : <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => void decide(r.id, 'built')}>Mark built</Button>}
            </div>
          ) : null}
        </article>
      ))}
      <p className="text-xs text-stone-500"><Link to="/help" className="text-brand hover:underline">Help</Link> has more on change requests.</p>
    </div>
  )
}
