import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert, Button, FormField, Input } from '@/components/ui'

export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Enter the email address you sign in with.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await sendPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <div className="space-y-5">
          <Alert variant="success" title="Check your email">
            If an account exists for <span className="font-medium">{email.trim()}</span>, a reset link is on its way.
            The link expires after a short time.
          </Alert>
          <Link to={ROUTES.login} className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {error ? <Alert variant="error">{error}</Alert> : null}
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>
          <Button type="submit" fullWidth size="lg" loading={submitting} leftIcon={<MailCheck className="size-4" aria-hidden="true" />}>
            Send reset link
          </Button>
          <Link to={ROUTES.login} className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 hover:text-stone-900">
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}
