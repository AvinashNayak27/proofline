import { useState, type FormEvent } from 'react'
import { Check, Loader2, LogIn } from 'lucide-react'

type Props = {
  busy: boolean
  signedIn: boolean
  /** True once a claim was submitted: the token is gone and signing in again starts a new claim. */
  locked: boolean
  onSignIn: (username: string, password: string) => Promise<void>
}

export function LoginStep({ busy, signedIn, locked, onSignIn }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const u = username
    const p = password
    setPassword('') // the password never outlives the request
    setUsername('')
    void onSignIn(u, p)
  }

  if (signedIn) {
    return (
      <div className="flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: 'rgba(26,128,71,0.08)' }}>
        <Check className="size-4" style={{ color: 'var(--success)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--success)' }}>
          Signed in to DummyJSON. The token is held in memory only.
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2.5" autoComplete="off">
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="DummyJSON username"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        disabled={busy || locked}
        className="min-h-11 w-full rounded-2xl border bg-white/80 px-4 text-sm outline-none focus:border-[var(--focus)]"
        style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="off"
        disabled={busy || locked}
        className="min-h-11 w-full rounded-2xl border bg-white/80 px-4 text-sm outline-none focus:border-[var(--focus)]"
        style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
      />
      <button
        type="submit"
        disabled={busy || locked || username.trim().length === 0 || password.length === 0}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)', background: 'var(--surface-strong)' }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  )
}
