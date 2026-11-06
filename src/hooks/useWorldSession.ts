import { useCallback, useEffect, useState } from 'react'

export type WorldSessionState =
  | { status: 'loading' }
  | { status: 'signed-out'; configured: boolean }
  | { status: 'signed-in'; issuer: string; subjectPreview: string; acr: string; expiresAt: number }
  | { status: 'unreachable' }

const SESSION_URL = '/api/auth/session'
export const LOGIN_PATH = '/api/auth/world/login'

function parse(json: unknown): WorldSessionState {
  if (typeof json !== 'object' || json === null) return { status: 'unreachable' }
  const j = json as Record<string, unknown>
  if (
    j.authenticated === true &&
    typeof j.issuer === 'string' &&
    typeof j.subjectPreview === 'string' &&
    typeof j.acr === 'string' &&
    typeof j.expiresAt === 'number'
  ) {
    return { status: 'signed-in', issuer: j.issuer, subjectPreview: j.subjectPreview, acr: j.acr, expiresAt: j.expiresAt }
  }
  return { status: 'signed-out', configured: j.configured !== false }
}

async function fetchSession(): Promise<WorldSessionState> {
  try {
    const res = await fetch(SESSION_URL, { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return { status: 'unreachable' }
    return parse(await res.json())
  } catch {
    return { status: 'unreachable' }
  }
}

/**
 * The browser only ever learns whether it has a valid app session cookie (HttpOnly, so unreadable here)
 * and a shortened subject for display. Tokens, secrets and the PKCE verifier never reach this code.
 */
export function useWorldSession() {
  const [session, setSession] = useState<WorldSessionState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    setSession(await fetchSession())
  }, [])

  useEffect(() => {
    let alive = true
    const load = () => {
      void fetchSession().then((next) => {
        if (alive) setSession(next)
      })
    }
    load()
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])

  // Drop to the gate the moment the short-lived session expires.
  const expiresAt = session.status === 'signed-in' ? session.expiresAt : null
  useEffect(() => {
    if (expiresAt === null) return
    const timer = setTimeout(
      () => {
        void fetchSession().then(setSession)
      },
      Math.max(1_000, expiresAt * 1000 - Date.now() + 500),
    )
    return () => clearTimeout(timer)
  }, [expiresAt])

  /** Ends this app's session only. It does not sign you out of World ID. */
  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      await refresh()
    }
  }, [refresh])

  return { session, refresh, signOut }
}
