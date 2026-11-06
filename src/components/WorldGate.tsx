import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Fingerprint, Loader2 } from 'lucide-react'
import { LOGIN_PATH } from '@/hooks/useWorldSession'

const ERROR_COPY: Record<string, string> = {
  access_denied: 'World ID sign-in was cancelled.',
  authorization_failed: 'World ID could not complete the sign-in. Try again.',
  invalid_callback: 'The sign-in response was incomplete. Try again.',
  issuer_mismatch: 'The sign-in response did not come from World ID. Try again.',
  state_mismatch: 'That sign-in attempt did not match this browser or has expired. Try again.',
  attempt_expired: 'That sign-in attempt took too long. Try again.',
  service_unavailable: 'World ID is not reachable right now. Try again in a moment.',
  token_exchange_failed: 'World ID could not confirm the sign-in. Try again in a moment.',
  invalid_id_token: 'World ID returned a result that failed verification, so no session was created.',
  insufficient_assurance: 'This app needs an Orb-verified World ID, and this account did not meet that requirement.',
}

/** Reads ?auth_error=<code> once, then removes it from the address bar. Codes come from a fixed list. */
function useAuthError(): string | null {
  const [message] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get('auth_error')
    return code ? (ERROR_COPY[code] ?? 'Sign-in did not complete. Try again.') : null
  })
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('auth_error')) {
      url.searchParams.delete('auth_error')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [])
  return message
}

type Props = { configured: boolean; unreachable: boolean; onRefresh: () => Promise<void> }

export function WorldGate({ configured, unreachable, onRefresh }: Props) {
  const authError = useAuthError()
  const [waiting, setWaiting] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
    },
    [],
  )

  // Inside an embedded preview the World page cannot be framed, so sign-in opens in a new tab and this
  // tab keeps checking for the finished session. In a normal tab it simply navigates.
  const begin = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (window.self === window.top) return
    event.preventDefault()
    window.open(LOGIN_PATH, '_blank', 'noopener,noreferrer')
    setWaiting(true)
    if (timer.current) clearInterval(timer.current)
    const stopAt = Date.now() + 5 * 60_000
    timer.current = setInterval(() => {
      void onRefresh()
      if (Date.now() > stopAt && timer.current) {
        clearInterval(timer.current)
        setWaiting(false)
      }
    }, 2_000)
  }

  const blocked = !configured || unreachable
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <section className="space-y-5 rounded-3xl p-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
            World ID required
          </p>
          <h1 className="display text-balance text-3xl font-bold">Prove you are a unique human to continue</h1>
          <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            This demo only opens for people with an Orb-verified World ID. You will be asked to authenticate again every time you sign in.
          </p>
        </div>

        {authError && (
          <div role="alert" className="flex gap-2 rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        {blocked ? (
          <div role="status" className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
            {unreachable
              ? 'The sign-in service is not running. Start it with bun run server, then reload.'
              : 'World ID is not configured yet. Set the WORLD_ID_* values in the environment and restart the server.'}
          </div>
        ) : (
          <a
            href={LOGIN_PATH}
            onClick={begin}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            <Fingerprint className="size-5" />
            Continue with World ID
          </a>
        )}

        {waiting && (
          <p className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <Loader2 className="size-3.5 animate-spin" />
            Finish signing in on the tab that just opened. This page updates by itself.
          </p>
        )}
      </section>
    </main>
  )
}
