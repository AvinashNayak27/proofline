import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type WorldSessionState =
  | { status: 'loading' }
  | { status: 'signed-out'; configured: boolean }
  | { status: 'signed-in'; issuer: string; subjectPreview: string; creatorCommitment: `0x${string}`; acr: string; expiresAt: number }
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
    typeof j.creatorCommitment === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(j.creatorCommitment) &&
    typeof j.acr === 'string' &&
    typeof j.expiresAt === 'number'
  ) {
    return {
      status: 'signed-in',
      issuer: j.issuer,
      subjectPreview: j.subjectPreview,
      creatorCommitment: j.creatorCommitment as `0x${string}`,
      acr: j.acr,
      expiresAt: j.expiresAt,
    }
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

type Ctx = { session: WorldSessionState; refresh: () => Promise<void>; signOut: () => Promise<void> }
const WorldSessionContext = createContext<Ctx | null>(null)

/**
 * One shared World ID session for the whole app. The browser only learns whether it has a valid
 * session (the cookie is HttpOnly) plus a shortened subject and the creator commitment. Tokens,
 * secrets and the PKCE verifier never reach this code.
 */
export function WorldSessionProvider({ children }: { children: ReactNode }) {
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

  // Drop to signed-out the moment the short-lived session expires.
  const expiresAt = session.status === 'signed-in' ? session.expiresAt : null
  useEffect(() => {
    if (expiresAt === null) return
    const timer = setTimeout(() => void fetchSession().then(setSession), Math.max(1_000, expiresAt * 1000 - Date.now() + 500))
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

  const value = useMemo(() => ({ session, refresh, signOut }), [session, refresh, signOut])
  return <WorldSessionContext.Provider value={value}>{children}</WorldSessionContext.Provider>
}

export function useWorldSession(): Ctx {
  const ctx = useContext(WorldSessionContext)
  if (!ctx) throw new Error('useWorldSession must be used inside WorldSessionProvider')
  return ctx
}
