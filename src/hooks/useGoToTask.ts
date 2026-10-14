import { useNavigate } from 'react-router-dom'
import { taskTarget } from '@/lib/tasks'
import type { TaskRow } from '@/services/tasks'

/** Open a task's work: the page and step for most tasks; pay-by tasks open their pay panel (in the task box). */
export function useGoToTask() {
  const navigate = useNavigate()
  return (task: TaskRow, openBox: (t: TaskRow) => void) => {
    const target = taskTarget(task)
    if (target?.kind === 'page') navigate(target.to)
    else openBox(task)
  }
}

