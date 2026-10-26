import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { finishDropboxSignIn } from '@/services/dropbox'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Alert, Spinner } from '@/components/ui'

/** Where Dropbox sends Dana back after she lets VMS in (the redirect address registered in the Dropbox App Console). */
export default function DropboxCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState<string | null>(null)
  const started = useRef(false)
  const code = params.get('code'), state = params.get('state'), denied = params.get('error_description') ?? params.get('error')
  const error = denied ? `Dropbox said: ${denied}` : !code || !state ? 'Dropbox did not send a sign-in code.' : failed
  useEffect(() => {
    if (started.current || !code || !state || denied) return
    started.current = true
    finishDropboxSignIn(code, state)
      .then((s) => {
        toast.success(s.last_error ? 'Connected, but the check found a problem' : 'Connected to Dropbox')
        navigate(ROUTES.dropboxSettings, { replace: true })
      })
      .catch((err) => setFailed(errorMessage(err)))
  }, [code, state, denied, navigate])
  return (
    <div className="mx-auto max-w-lg py-16">
      {error ? (
        <Alert variant="error">{error} <Link to={ROUTES.dropboxSettings} className="font-medium underline">Back to Settings → Dropbox</Link></Alert>
      ) : <div className="flex justify-center"><Spinner label="Connecting to Dropbox…" className="text-brand" /></div>}
    </div>
  )
}
