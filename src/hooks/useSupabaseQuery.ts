import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { errorMessage } from '@/lib/utils'

export interface QueryState<T> {
  data: T | null
  error: string | null
  isLoading: boolean
  refetch: () => Promise<void>
}

/**
 * Run an async query and track its state. Re-runs when `deps` change; ignores
 * results from superseded runs. `refetch` keeps the current data while reloading.
 */
export function useSupabaseQuery<T>(queryFn: () => Promise<T>, deps: DependencyList): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const runId = useRef(0)
  const fnRef = useRef(queryFn)
  fnRef.current = queryFn

  const run = useCallback(() => {
    const id = ++runId.current
    return fnRef
      .current()
      .then((result) => {
        if (id !== runId.current) return
        setData(result)
        setError(null)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (id !== runId.current) return
        setError(errorMessage(err))
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, isLoading, refetch: run }
}
