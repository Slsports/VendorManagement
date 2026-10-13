import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { finishLightspeedSignIn } from '@/services/lightspeed'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Alert, Spinner } from '@/components/ui'

/** Where Lightspeed sends Dana back after she approves VMS (the redirect address registered with LS). */
export default function LightspeedCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState<string | null>(null)
  const started = useRef(false)
  const code = params.get('code'), state = params.get('state'), denied = params.get('error_description') ?? params.get('error')
  const error = denied ? `Lightspeed said: ${denied}` : !code || !state ? 'Lightspeed did not send a sign-in code.' : failed
  useEffect(() => {
    if (started.current || !code || !state || denied) return
    started.current = true
    finishLightspeedSignIn(code, state)
      .then((s) => {
        toast.success(s.last_error ? 'Connected, but the check found a problem' : 'Connected to Lightspeed')
        navigate(ROUTES.lightspeedSettings, { replace: true })
      })
      .catch((err) => setFailed(errorMessage(err)))
  }, [code, state, denied, navigate])
  return (
    <div className="mx-auto max-w-lg py-16">
      {error ? (
        <Alert variant="error">{error} <Link to={ROUTES.lightspeedSettings} className="font-medium underline">Back to Settings → Lightspeed</Link></Alert>
      ) : <div className="flex justify-center"><Spinner label="Connecting to Lightspeed…" className="text-brand" /></div>}
    </div>
  )
}
