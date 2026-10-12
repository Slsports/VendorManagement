import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { oauthError } from '@/lib/auth'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert, Button, FormField, Input, PasswordInput } from '@/components/ui'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const { signIn, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  // Google sends refused sign-ins back here with the reason in the URL (sign-ups are off: only people on the list get in).
  const [formError, setFormError] = useState<string | null>(() => oauthError(window.location))
  const [submitting, setSubmitting] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  useEffect(() => {
    if (oauthError(window.location)) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  async function handleGoogle() {
    setGoogleBusy(true)
    setFormError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setFormError(friendlyAuthError(err))
      setGoogleBusy(false)
    }
  }

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
    <AuthLayout title="Sign in" subtitle="Use your Google account, or the email and password your administrator set up for you.">
      {formError ? <Alert variant="error" className="mb-5">{formError}</Alert> : null}
      <Button type="button" variant="secondary" fullWidth size="lg" loading={googleBusy} onClick={() => void handleGoogle()} leftIcon={<GoogleMark />}>
        {googleBusy ? 'Opening Google…' : 'Sign in with Google'}
      </Button>
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-stone-400" aria-hidden="true">
        <span className="h-px flex-1 bg-stone-200" />or<span className="h-px flex-1 bg-stone-200" />
      </div>
      <form onSubmit={handleSubmit} noValidate className="space-y-5">

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

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
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
