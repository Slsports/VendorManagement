import { useCallback, useState } from 'react'

/**
 * useState backed by localStorage for per-device conveniences (collapsed sidebar,
 * last tab). Every read/write is guarded: private windows and blocked storage
 * simply fall back to in-memory state.
 */
export function useStoredState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          // storage unavailable; keep in-memory value
        }
        return resolved
      })
    },
    [key],
  )

  return [value, set]
}
