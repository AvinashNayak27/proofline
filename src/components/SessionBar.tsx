import { LogOut, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

type Props = { subjectPreview: string; onSignOut: () => Promise<void> }

export function SessionBar({ subjectPreview, onSignOut }: Props) {
  const [busy, setBusy] = useState(false)
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ShieldCheck className="size-5 shrink-0" style={{ color: 'var(--success)' }} />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Verified with World ID (Orb)</p>
          <p className="mono truncate text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            {subjectPreview}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void onSignOut().finally(() => setBusy(false))
        }}
        title="Ends this app's session. It does not sign you out of World ID."
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        <LogOut className="size-4" />
        Sign out
      </button>
    </div>
  )
}
