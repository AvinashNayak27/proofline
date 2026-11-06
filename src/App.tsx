import { Loader2 } from 'lucide-react'
import { ClaimCard } from './components/ClaimCard'
import { RewardPool } from './components/RewardPool'
import { FundPool } from './components/FundPool'
import { SessionBar } from './components/SessionBar'
import { WorldGate } from './components/WorldGate'
import { useWorldSession } from './hooks/useWorldSession'

export default function App() {
  const { session, refresh, signOut } = useWorldSession()

  if (session.status === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center" role="status" aria-label="Checking your World ID session">
        <Loader2 className="size-6 animate-spin" style={{ color: 'var(--muted)' }} />
      </main>
    )
  }

  if (session.status !== 'signed-in') {
    return <WorldGate configured={session.status === 'signed-out' ? session.configured : true} unreachable={session.status === 'unreachable'} onRefresh={refresh} />
  }

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-5">
      <SessionBar subjectPreview={session.subjectPreview} onSignOut={signOut} />
      <header>
        <p className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)' }}>CRE local demo</p>
        <h1 className="display text-4xl font-bold">X analytics attester</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          Prove your post analytics with a replay inside the CRE confidential workflow simulation.
        </p>
      </header>
      <ClaimCard />
      <RewardPool />
      <FundPool />
      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
        This is a local simulation. The browser extension captures your X session request and encrypts it for the configured enclave key. A verified CRE deployment and enclave attestation are required for production trust.
      </p>
    </main>
  )
}
