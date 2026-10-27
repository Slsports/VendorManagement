import { useAuth } from '@/hooks/useAuth'
import { useStoredState } from '@/hooks/useStoredState'
import { STORAGE_KEYS } from '@/lib/constants'

/**
 * Whether a dashboard box is open, remembered per person on this device (Dana, Oct 27: boxes start closed, "I will
 * click and it can expand", and stay how she left them). A box with no id is not remembered.
 */
export function useCardOpen(id: string | undefined): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const { profile } = useAuth()
  const [open, setOpen] = useStoredState<boolean>(id ? `${STORAGE_KEYS.cardOpen}.${profile?.id ?? 'me'}.${id}` : `${STORAGE_KEYS.cardOpen}.none`, false)
  return [id ? open : false, setOpen]
}
