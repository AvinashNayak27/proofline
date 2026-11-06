import { ClaimCard } from '@/components/ClaimCard'
import { RewardPool } from '@/components/RewardPool'
import { FundPool } from '@/components/FundPool'

export default function App() {
  return (
    <div className="min-h-dvh px-4 py-8">
      <main className="mx-auto flex max-w-md flex-col gap-4">
        <header>
          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
            Testnet demo
          </p>
          <h1 className="display mt-1 text-3xl font-bold text-balance">DummyJSON to Arc claim</h1>
        </header>

        <ClaimCard />
        <RewardPool />
        <FundPool />

        <p className="text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
          Your password goes only from this browser to DummyJSON. The access token stays in memory and is sent once, to the
          CRE workflow. DummyJSON tokens can carry identity claims, so the nodes that run the workflow can read them. The
          workflow never logs the token or username, and nothing identifying is written onchain.
        </p>
      </main>
    </div>
  )
}
