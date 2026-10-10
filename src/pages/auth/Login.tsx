import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert, Button, FormField, Input, PasswordInput } from '@/components/ui'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const errors: typeof fieldErrors = {}
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.'
    if (!password) errors.password = 'Enter your password.'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    setFormError(null)
    try {
      await signIn(email, password)
      navigate(from && from !== ROUTES.login ? from : ROUTES.dashboard, { replace: true })
    } catch (err) {
      setFormError(friendlyAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="Sign in" subtitle="Use the email and password your administrator set up for you.">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <FormField label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          />
        </FormField>

        <FormField
          label="Password"
          htmlFor="password"
          error={fieldErrors.password}
          action={
            <Link to={ROUTES.forgotPassword} className="text-sm font-medium text-brand hover:underline">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          />
        </FormField>

        <Button type="submit" fullWidth size="lg" loading={submitting} leftIcon={<LogIn className="size-4" aria-hidden="true" />}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  )
}

function friendlyAuthError(err: unknown) {
  const msg = errorMessage(err)
  if (/invalid login credentials/i.test(msg)) return 'That email and password combination is not right. Please try again.'
  if (/email not confirmed/i.test(msg)) return 'This email address has not been confirmed yet. Check your inbox for the confirmation link.'
  if (/rate limit|too many requests/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.'
  if (/fetch|network/i.test(msg)) return 'We could not reach the server. Check your connection and try again.'
  return msg
}
