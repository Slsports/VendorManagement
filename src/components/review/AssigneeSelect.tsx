import type { Person } from '@/services/reviews'
import { Select } from '@/components/ui'

export interface AssigneeSelectProps {
  value: string | null
  people: Person[]
  disabled?: boolean
  label?: string
  className?: string
  onChange: (profileId: string | null) => void | Promise<void>
}

/** "Assigned to" picker: nobody, or one active person. */
export function AssigneeSelect({ value, people, disabled, label = 'Assigned to', className, onChange }: AssigneeSelectProps) {
  return (
    <Select value={value ?? ''} disabled={disabled} aria-label={label} className={className ?? 'h-8 text-xs'} onChange={(e) => void onChange(e.target.value || null)}>
      <option value="">Unassigned</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
    </Select>
  )
}
