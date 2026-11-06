import { Fingerprint, Loader2, LogOut, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useWorldSession } from '@/hooks/useWorldSession'
import { useWorldSignIn } from '@/hooks/useWorldSignIn'

/** Creator identity in the header: sign in with World ID, or the verified badge with Sign out. */
export function CreatorChip() {
  const { session, signOut } = useWorldSession()
  const { begin, href, waiting } = useWorldSignIn()
  const [busy, setBusy] = useState(false)

  if (session.status === 'loading') return <Loader2 className="size-4 animate-spin" style={{ color: 'var(--muted)' }} aria-label="Checking your World ID session" />

  if (session.status === 'signed-in') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="pl-chip" style={{ background: 'var(--success-soft)', color: 'var(--success)' }} title="Orb-verified World ID">
          <ShieldCheck className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Verified human</span>
          <span className="mono tabular-nums">{session.subjectPreview}</span>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void signOut().finally(() => setBusy(false))
          }}
          title="Ends this app's session only. It does not sign you out of World ID."
          className="pl-btn pl-btn-ghost pl-btn-sm"
        >
          <LogOut className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Sign out</span>
        </button>
      </div>
    )
  }

  if (session.status === 'unreachable' || (session.status === 'signed-out' && !session.configured)) {
    return (
      <span className="pl-chip" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }} title="The World ID sign-in service is not available">
        World ID unavailable
      </span>
    )
  }

  return (
    <a href={href} onClick={begin} className="pl-btn pl-btn-secondary pl-btn-sm">
      {waiting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Fingerprint className="size-4" aria-hidden />}
      {waiting ? 'Finish in the new tab' : 'Sign in with World ID'}
    </a>
  )
}
