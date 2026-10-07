// Gmail API as the orders@ mailbox, through the service account with domain-wide delegation
// (docs/gmail-connection.md). Deno only: used by the gmail-* Edge Functions.

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send']

interface ServiceAccount { client_email: string; private_key: string }

const b64url = (bytes: Uint8Array | string) => {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Sign a JWT as the service account, impersonating `subject`, and trade it for an access token. */
export async function googleAccessToken(subject: string, scopes = GMAIL_SCOPES): Promise<string> {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  const sa = JSON.parse(raw) as ServiceAccount
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: sa.client_email, sub: subject, aud: 'https://oauth2.googleapis.com/token', scope: scopes.join(' '), iat: now, exp: now + 3600 }))
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`)))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  })
  const body = await res.json()
  if (!body.access_token) throw new Error(`Google sign-in failed: ${body.error ?? res.status} ${body.error_description ?? ''}`.trim())
  return body.access_token as string
}

export class GmailError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export class Gmail {
  constructor(private token: string, private user = 'me') {}

  async call<T>(path: string, init: RequestInit & { query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${this.user}/${path}`)
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
        continue
      }
      const text = await res.text()
      if (!res.ok) throw new GmailError(res.status, `Gmail ${res.status} on ${path}: ${text.slice(0, 300)}`)
      return (text ? JSON.parse(text) : {}) as T
    }
  }

  /** Send a full RFC 5322 message, in an existing Gmail thread when threadId is given (multipart upload, up to 25 MB). */
  async send(raw: string, threadId?: string): Promise<{ id: string; threadId: string }> {
    const boundary = `vms-send-${crypto.randomUUID()}`
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(threadId ? { threadId } : {})}\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n${raw}\r\n--${boundary}--`
    const res = await fetch(`https://gmail.googleapis.com/upload/gmail/v1/users/${this.user}/messages/send?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    const text = await res.text()
    if (!res.ok) throw new GmailError(res.status, `Gmail would not send it (${res.status}): ${text.slice(0, 300)}`)
    return JSON.parse(text)
  }

  profile() { return this.call<{ emailAddress: string; messagesTotal: number; historyId: string }>('profile') }
  labels() { return this.call<{ labels: { id: string; name: string }[] }>('labels') }
  list(q: string, pageToken?: string, maxResults = 100) {
    return this.call<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>('messages', { query: { q, pageToken, maxResults } })
  }
  message(id: string, format: 'full' | 'minimal' | 'metadata' = 'full') { return this.call<Record<string, unknown>>(`messages/${id}`, { query: { format } }) }
  history(startHistoryId: string, pageToken?: string) {
    return this.call<{ history?: { messagesAdded?: { message: { id: string } }[]; labelsAdded?: { message: { id: string } }[]; labelsRemoved?: { message: { id: string } }[] }[]; historyId: string; nextPageToken?: string }>(
      'history', { query: { startHistoryId, pageToken, maxResults: 500 } })
  }
}
