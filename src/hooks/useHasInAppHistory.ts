import { useLocation } from 'react-router-dom'

/**
 * True when there is an app page before this one in the browser history. React Router numbers its
 * entries (`idx`): a cold open, and redirects such as sign-in that replace the entry, stay at 0.
 */
export function useHasInAppHistory() {
  useLocation() // re-render on navigation
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' && idx > 0
}
