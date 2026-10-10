import { useContext } from 'react'
import { ViewAsContext, type ViewAsValue } from '@/context/viewAsContext'

/** Whose view the app shows. Outside the app shell (tests, sign-in) it is always your own. */
export function useViewAs(): ViewAsValue {
  const ctx = useContext(ViewAsContext)
  return ctx ?? { choice: 'me', setChoice: () => undefined, personId: null, personName: null, isMe: true, canSwitch: false, people: [] }
}
