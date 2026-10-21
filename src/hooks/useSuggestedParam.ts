import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Which vendor's suggested order is open, kept in the page address (Dana, Oct 21: "when we click back it needs to take us
 * back to the page we were on"). Opening a linked order and pressing Back reopens the suggested order where it was.
 */
export function useSuggestedParam(): [{ id: string; name: string } | null, (v: { id: string; name: string } | null) => void] {
  const [params, setParams] = useSearchParams()
  const id = params.get('suggest')
  const open = id ? { id, name: params.get('suggestName') ?? '' } : null
  const set = useCallback((v: { id: string; name: string } | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v) { next.set('suggest', v.id); next.set('suggestName', v.name) } else { next.delete('suggest'); next.delete('suggestName') }
      return next
    }, { replace: true })
  }, [setParams])
  return [open, set]
}
