import { createContext } from 'react'
import type { Person } from '@/services/reviews'

/**
 * Whose view the app shows (Dana, Oct 8): an admin can look at everything as one person sees it, or at
 * everyone's at once, while the staff learns. Others see their own, plus the people ticked for them under
 * Can see (Oct 18: Trevor and Jarrett see each other).
 */
export interface ViewAsValue {
  /** 'me' · 'all' · a profile id */
  choice: string
  setChoice: (choice: string) => void
  /** The person whose view is shown; null for everyone. */
  personId: string | null
  personName: string | null
  isMe: boolean
  canSwitch: boolean
  /** Only the admin has "Everyone". */
  canSeeAll: boolean
  people: Person[]
}

export const ViewAsContext = createContext<ViewAsValue | null>(null)
