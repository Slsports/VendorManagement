import { useMemo, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useStoredState } from '@/hooks/useStoredState'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listPeople } from '@/services/reviews'
import { STORAGE_KEYS } from '@/lib/constants'
import { ViewAsContext, type ViewAsValue } from './viewAsContext'

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const { organization, profile, role } = useAuth()
  const canSwitch = role === 'admin'
  const [stored, setStored] = useStoredState<string>(STORAGE_KEYS.viewAs, 'me')
  const peopleQ = useSupabaseQuery(async () => (organization && canSwitch ? listPeople(organization.id) : []), [organization?.id, canSwitch])
  const value = useMemo<ViewAsValue>(() => {
    const people = peopleQ.data ?? []
    // A person who left, or a non-admin: their own view.
    const choice = !canSwitch ? 'me' : stored === 'all' || stored === 'me' || people.some((p) => p.id === stored) || peopleQ.isLoading ? stored : 'me'
    const personId = choice === 'me' ? profile?.id ?? null : choice === 'all' ? null : choice
    const personName = choice === 'all' ? null : personId === profile?.id ? profile?.full_name ?? null : people.find((p) => p.id === personId)?.full_name ?? null
    return { choice, setChoice: setStored, personId, personName, isMe: personId === profile?.id, canSwitch, people }
  }, [canSwitch, stored, setStored, peopleQ.data, peopleQ.isLoading, profile?.id, profile?.full_name])
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
}
