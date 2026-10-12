import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { ReminderSettings } from '@/components/tasks/ReminderSettings'

/**
 * Notifications (Dana, Oct 12): each person's own reminder choices, reached from the name menu at the top right.
 * Admins also see it as a Settings tab (`embedded`), where the Settings page already provides the header and Back link.
 */
export default function NotificationsPage({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <ReminderSettings />
  return (
    <div>
      <BackLink fallback={ROUTES.dashboard} fallbackLabel="Dashboard" />
      <PageHeader title="Notifications" description="How task reminders reach you: on your dashboard, by email and/or by text." />
      <ReminderSettings />
    </div>
  )
}
