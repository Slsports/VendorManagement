import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, UserPlus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { useTableSort } from '@/hooks/useTableSort'
import {
  GRANTABLE_ROLES,
  createUser,
  listSignIns,
  listStoreGrants,
  listUsers,
  sendSetPasswordEmail,
  setStoreGrants,
  setUserAccounting,
  setUserCounts,
  setUserActive,
  setUserRole,
} from '@/services/users'
import { errorMessage } from '@/lib/utils'
import type { Profile, UserRole } from '@/types'
import { SortHeader } from '@/components/shared/SortHeader'
import { Alert, Badge, Button, FormField, Input, Select, Spinner } from '@/components/ui'

const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', manager: 'Manager', buyer: 'Buyer', viewer: 'Viewer', uploader: 'Uploader' }

/**
 * Who can sign in (Dana, Oct 12). Sign-ups are off, so only people on this list get in: with "Sign in with Google"
 * using this exact email (any Google account, not only @shaverlakesports.com), or with a password after the
 * set-password email. Only Dana is admin; the role list never offers admin.
 */
export default function UserSettings() {
  const { organization, profile: me, stores } = useAuth()
  const usersQ = useSupabaseQuery(async () => (organization ? listUsers(organization.id) : []), [organization?.id])
  const grantsQ = useSupabaseQuery(listStoreGrants, [organization?.id])
  const signInsQ = useSupabaseQuery(listSignIns, [organization?.id])
  const [form, setForm] = useState<{ full_name: string; email: string; role: UserRole; store_ids: string[] }>({
    full_name: '',
    email: '',
    role: 'buyer',
    store_ids: [],
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const users = usersQ.data ?? []
  const grants = grantsQ.data ?? []
  const signIns = signInsQ.data ?? []
  const storeCodes = (u: Profile) =>
    u.role === 'admin' ? 'All' : stores.filter((s) => grants.some((g) => g.user_id === u.id && g.store_id === s.id)).map((s) => s.code).join(', ') || '—'
  const signIn = (u: Profile) => signIns.find((s) => s.id === u.id)

  const { sorted, sort, toggle } = useTableSort(users, {
    name: (u) => u.full_name,
    email: (u) => u.email,
    role: (u) => ROLE_LABELS[u.role],
    stores: (u) => storeCodes(u),
    signin: (u) => signIn(u)?.last_sign_in_at ?? null,
    status: (u) => (u.is_active ? 'Active' : 'Inactive'),
  })

  async function add(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const store_codes = stores.filter((s) => form.store_ids.includes(s.id)).map((s) => s.code)
      await createUser({ email: form.email, full_name: form.full_name, role: form.role, store_codes })
      toast.success(`${form.full_name} can sign in now`)
      setForm({ full_name: '', email: '', role: 'buyer', store_ids: [] })
      await Promise.all([usersQ.refetch(), grantsQ.refetch(), signInsQ.refetch()])
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn()
      toast.success(label)
      await Promise.all([usersQ.refetch(), grantsQ.refetch()])
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (usersQ.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (usersQ.error) return <Alert variant="error">{usersQ.error}</Alert>

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-stone-900">Add a person</h2>
        <p className="mt-1 text-sm text-stone-600">
          They sign in with the <strong>Sign in with Google</strong> button using this exact email (a Gmail address works too), or with a
          password after you send them the set-password email.
        </p>
        <form onSubmit={add} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {formError ? <Alert variant="error" className="sm:col-span-2 lg:col-span-4">{formError}</Alert> : null}
          <FormField label="Name" htmlFor="new-name">
            <Input id="new-name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </FormField>
          <FormField label="Email" htmlFor="new-email">
            <Input id="new-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
          <FormField label="Role" htmlFor="new-role">
            <Select id="new-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
              {GRANTABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </FormField>
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-stone-800">Stores</legend>
            <div className="flex flex-wrap gap-3 pt-2">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={form.store_ids.includes(s.id)}
                    onChange={(e) => setForm({ ...form, store_ids: e.target.checked ? [...form.store_ids, s.id] : form.store_ids.filter((id) => id !== s.id) })}
                  />
                  {s.code}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" loading={saving} leftIcon={<UserPlus className="size-4" aria-hidden="true" />}>Add person</Button>
          </div>
        </form>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
            <tr>
              <SortHeader label="Name" sortKey="name" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Email" sortKey="email" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Role" sortKey="role" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Stores" sortKey="stores" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Last sign-in" sortKey="signin" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-4 py-2.5" />
              <th className="px-4 py-2.5" title="Sees the Accounting area: billing@ mail, bills, accounting tasks. Admin alone is not enough.">Accounting</th>
              <th className="px-4 py-2.5" title="May type physical inventory counts into a checklist.">Enter counts</th>
              <th className="px-4 py-2.5" title="May send a checklist's counts to Lightspeed as an Inventory Count.">Send counts to LS</th>
              <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sorted.map((u) => {
              const isMe = u.id === me?.id
              const locked = u.role === 'admin' || isMe
              const si = signIn(u)
              return (
                <tr key={u.id} className={u.is_active ? '' : 'text-stone-400'}>
                  <td className="px-4 py-3 font-semibold text-stone-900">{u.full_name || '—'}{isMe ? <span className="ml-1 text-xs font-normal text-stone-500">(you)</span> : null}</td>
                  <td className="px-4 py-3 text-stone-700">{u.email}</td>
                  <td className="px-4 py-3">
                    {locked ? (
                      <Badge tone="brand">{ROLE_LABELS[u.role]}</Badge>
                    ) : (
                      <Select
                        aria-label={`Role for ${u.full_name}`}
                        className="h-9 min-w-32"
                        value={u.role}
                        onChange={(e) => void run('Role updated', () => setUserRole(u.id, e.target.value as UserRole))}
                      >
                        {GRANTABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.role === 'admin' ? 'All' : (
                      <div className="flex flex-wrap gap-2">
                        {stores.map((s) => {
                          const has = grants.some((g) => g.user_id === u.id && g.store_id === s.id)
                          return (
                            <label key={s.id} className="flex items-center gap-1 text-xs text-stone-700">
                              <input
                                type="checkbox"
                                className="size-3.5 accent-brand"
                                checked={has}
                                aria-label={`${u.full_name}: ${s.code}`}
                                onChange={(e) => {
                                  const ids = stores.filter((x) => (x.id === s.id ? e.target.checked : grants.some((g) => g.user_id === u.id && g.store_id === x.id))).map((x) => x.id)
                                  void run('Stores updated', () => setStoreGrants(u.id, ids))
                                }}
                              />
                              {s.code}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {si?.last_sign_in_at ? new Date(si.last_sign_in_at).toLocaleDateString() : 'Never'}
                    {si ? <span className="block text-xs text-stone-500">{[si.google ? 'Google' : null, si.password ? 'Password' : null].filter(Boolean).join(' · ') || 'No sign-in method yet'}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={u.sees_accounting}
                      disabled={isMe}
                      aria-label={`${u.full_name} sees Accounting`}
                      onChange={(e) => void run(e.target.checked ? `${u.full_name} now sees Accounting` : `${u.full_name} no longer sees Accounting`, () => setUserAccounting(u.id, e.target.checked))}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input type="checkbox" className="size-4 accent-brand" checked={u.enters_counts || u.role === 'admin'} disabled={u.role === 'admin'} aria-label={`${u.full_name} enters inventory counts`}
                      onChange={(e) => void run(e.target.checked ? `${u.full_name} can enter counts` : `${u.full_name} can no longer enter counts`, () => setUserCounts(u.id, { enters_counts: e.target.checked }))} />
                  </td>
                  <td className="px-4 py-3">
                    <input type="checkbox" className="size-4 accent-brand" checked={u.sends_counts || u.role === 'admin'} disabled={u.role === 'admin'} aria-label={`${u.full_name} sends counts to LS`}
                      onChange={(e) => void run(e.target.checked ? `${u.full_name} can send counts to LS` : `${u.full_name} can no longer send counts to LS`, () => setUserCounts(u.id, { sends_counts: e.target.checked }))} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<KeyRound className="size-3.5" aria-hidden="true" />}
                        onClick={() => void run(`Set-password email sent to ${u.email}`, () => sendSetPasswordEmail(u.email))}
                      >
                        Set-password email
                      </Button>
                      {locked ? null : (
                        <Button size="sm" variant="ghost" onClick={() => void run(u.is_active ? 'Sign-in turned off' : 'Sign-in turned on', () => setUserActive(u.id, !u.is_active))}>
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {grantsQ.error ? <Alert variant="error">{grantsQ.error}</Alert> : null}
      {signInsQ.error ? <Alert variant="warning">Sign-in details are unavailable: {signInsQ.error}</Alert> : null}
    </div>
  )
}
