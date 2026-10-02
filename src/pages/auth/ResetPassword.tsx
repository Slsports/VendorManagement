import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { KeyRound } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert, Button, FormField, PasswordInput } from '@/components/ui'

const MIN_LENGTH = 8

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await updatePassword(password)
      toast.success('Password updated. You are signed in.')
      navigate(ROUTES.dashboard, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="Choose a new password" subtitle={`At least ${MIN_LENGTH} characters. You'll stay signed in afterwards.`}>
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <FormField label="New password" htmlFor="password">
          <PasswordInput
            id="password"
            autoComplete="new-password"
            autoFocus
            required
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <FormField label="Confirm new password" htmlFor="confirm">
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </FormField>
        <Button type="submit" fullWidth size="lg" loading={submitting} leftIcon={<KeyRound className="size-4" aria-hidden="true" />}>
          Save password
        </Button>
      </form>
    </AuthLayout>
  )
}
