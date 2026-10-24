import { useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { saveReminderSettings } from '@/services/tasks'
import { errorMessage } from '@/lib/utils'
import { Button, Input } from '@/components/ui'

/** How I get reminders (Dana, Oct 11): dashboard, email and/or text, any mix; dashboard + email to start. */
export function ReminderSettings() {
  const { profile, refreshProfile } = useAuth()
  const [dash, setDash] = useState(profile?.remind_dashboard ?? true)
  const [email, setEmail] = useState(profile?.remind_email ?? true)
  const [text, setText] = useState(profile?.remind_text ?? false)
  const [phone, setPhone] = useState(profile?.mobile_phone ?? '')
  // texts only in these hours (Dana, Oct 24: 8 am to 6 pm unless the person sets their own)
  const [from, setFrom] = useState((profile?.text_from ?? '08:00').slice(0, 5))
  const [until, setUntil] = useState((profile?.text_until ?? '18:00').slice(0, 5))
  const [busy, setBusy] = useState(false)
  if (!profile) return null
  const changed = dash !== profile.remind_dashboard || email !== profile.remind_email || text !== profile.remind_text || (phone.trim() || null) !== profile.mobile_phone || from !== profile.text_from.slice(0, 5) || until !== profile.text_until.slice(0, 5)
  async function save() {
    if (text && phone.replace(/\D/g, '').length < 10) { toast.error('Add your cell number for texts'); return }
    setBusy(true)
    try {
      await saveReminderSettings(profile!.id, { remind_dashboard: dash, remind_email: email, remind_text: text, mobile_phone: phone.trim() || null, text_from: from || '08:00', text_until: until || '18:00' })
      await refreshProfile()
      toast.success('Reminder settings saved')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const box = 'size-4 accent-brand'
  return (
    <section aria-labelledby="remind-settings" className="rounded-2xl border border-stone-200 bg-white p-4">
      <h2 id="remind-settings" className="text-sm font-semibold text-stone-900">How I get reminders</h2>
      <p className="mt-0.5 text-xs text-stone-500">Pick one, two or all three. Also used to tell you when someone finishes a task you gave them.</p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-800">
        <label className="flex items-center gap-2"><input type="checkbox" className={box} checked={dash} onChange={(e) => setDash(e.target.checked)} /> On my dashboard</label>
        <label className="flex items-center gap-2"><input type="checkbox" className={box} checked={email} onChange={(e) => setEmail(e.target.checked)} /> By email <span className="text-xs text-stone-500">({profile.email})</span></label>
        <label className="flex items-center gap-2"><input type="checkbox" className={box} checked={text} onChange={(e) => setText(e.target.checked)} /> By text</label>
      </div>
      {text ? (
        <div className="mt-3 max-w-xs">
          <label htmlFor="remind-phone" className="block text-sm font-medium text-stone-800">Cell number</label>
          <Input id="remind-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="559-555-1234" className="mt-1" />
          <p className="mt-3 text-sm font-medium text-stone-800">Text me only between</p>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <Input aria-label="Texts start at" type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-32" />
            <span>and</span>
            <Input aria-label="Texts stop at" type="time" value={until} onChange={(e) => setUntil(e.target.value)} className="h-9 w-32" />
          </div>
          <p className="mt-1 text-xs text-stone-500">A reminder due outside these hours shows on your dashboard and in email right away; its text waits until the start time.</p>
          <div className="mt-2 space-y-1 text-xs text-stone-500">
            <p><b>What you get:</b> task reminders and a note when a task you handed off is finished, from Shaver Lake Sports VMS. Nothing promotional.</p>
            <p><b>How often:</b> varies with your tasks, typically a few texts a week; one text per reminder.</p>
            <p><b>Standard rates:</b> message and data rates may apply depending on your mobile plan.</p>
            <p><b>Help &amp; stop:</b> reply HELP for help or STOP to cancel any time, or untick By text here and save.</p>
            <p>
              By entering your number, ticking By text and clicking the button below, you agree to receive these texts. Consent is not a condition of employment.{' '}
              <a href="/sms/terms.html" target="_blank" rel="noreferrer" className="text-brand underline">Terms of Service</a> ·{' '}
              <a href="/sms/privacy.html" target="_blank" rel="noreferrer" className="text-brand underline">Privacy Policy</a>
            </p>
          </div>
        </div>
      ) : null}
      <Button size="sm" className="mt-3" disabled={!changed} loading={busy} onClick={() => void save()}>
        {text && !profile.remind_text ? 'Yes, sign me up for texts' : 'Save'}
      </Button>
    </section>
  )
}
