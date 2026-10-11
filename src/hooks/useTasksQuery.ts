import { useEffect, type DependencyList } from 'react'
import { useSupabaseQuery, type QueryState } from '@/hooks/useSupabaseQuery'
import { onTasksChanged } from '@/services/tasks'

/** A task query that reloads whenever a task is added, changed or finished anywhere on screen. */
export function useTasksQuery<T>(queryFn: () => Promise<T>, deps: DependencyList): QueryState<T> {
  const q = useSupabaseQuery(queryFn, deps)
  const { refetch } = q
  useEffect(() => onTasksChanged(() => void refetch()), [refetch])
  return q
}
