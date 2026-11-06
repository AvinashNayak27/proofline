import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { Loader2, ShieldCheck, Wallet } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { arcTestnet } from 'viem/chains'
import { useClaimFlow } from '@/hooks/useClaimFlow'
import { LoginStep } from './LoginStep'
import { ClaimStatus } from './ClaimStatus'

function StepLabel({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span
        className="flex size-5 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
      >
        {n}
      </span>
      <span className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
        {children}
      </span>
    </div>
  )
}

export function ClaimCard() {
  const { isConnected, address, chainId } = useAccount()
  const { phase, signedIn, signIn, claim, reset } = useClaimFlow()

  const locked = ['submitting', 'verifying', 'submitted', 'paid', 'timed-out', 'awaiting-signature'].includes(phase.name)
  const busy = phase.name === 'logging-in'
  const working = phase.name === 'awaiting-signature' || phase.name === 'submitting'
  const wrongChain = isConnected && chainId !== arcTestnet.id
  const canClaim = signedIn && isConnected && !working

  return (
    <section className="rounded-3xl p-5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
      <div className="mb-5">
        <div className="flex items-center gap-1.5">
          <TokenUSDC variant="branded" size={18} />
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Claim reward · Arc Testnet</span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="display text-3xl font-bold">weight ÷ 100</span>
          <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
        </div>
        <p className="mt-1.5 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          Your DummyJSON profile weight divided by 100, paid in USDC to the wallet you sign with once a CRE workflow verifies your login. One payout per user.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <StepLabel n={1}>Sign in to DummyJSON</StepLabel>
          <LoginStep busy={busy} signedIn={signedIn} locked={locked} onSignIn={signIn} />
        </div>

        <div>
          <StepLabel n={2}>Connect wallet</StepLabel>
          <ConnectKitButton.Custom>
            {({ show, isConnecting }) => (
              <button
                onClick={show}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)', background: 'var(--surface-strong)' }}
              >
                {isConnecting ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                {isConnected && address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect wallet'}
              </button>
            )}
          </ConnectKitButton.Custom>
          {wrongChain ? (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>Your wallet is on another network. Claiming will switch it to Arc Testnet.</p>
          ) : null}
        </div>

        <div>
          <StepLabel n={3}>Sign and claim</StepLabel>
          <button
            onClick={() => void claim()}
            disabled={!canClaim}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            {working ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {working ? 'Working...' : 'Sign claim and submit'}
          </button>
          <p className="mt-1.5 text-xs text-pretty" style={{ color: 'var(--subtle)' }}>
            Your wallet signs the claim (app, chain, wallet, nonce, expiry). Only the token, wallet, nonce, expiry and signature go to CRE.
          </p>
        </div>

        <ClaimStatus phase={phase} onReset={reset} />
      </div>
    </section>
  )
}
