import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Feedback'
import { Usdc } from '@/components/campaigns/Usdc'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { ClaimPhase } from '@/hooks/useClaim'
import { CHAIN_ID } from '@/lib/proofline/config'
import { count } from '@/lib/proofline/format'

const WORKING: Record<string, { title: string; detail: string }> = {
  switching: { title: 'Switching to Arc Testnet', detail: 'Approve the network switch in your wallet.' },
  signing: { title: 'Confirm the signature in your wallet', detail: 'You are signing a claim for this post. It moves no funds.' },
  capturing: { title: 'Reading your post analytics', detail: 'An X tab opened. Stay signed in to X and keep it open until it closes by itself.' },
  verifying: { title: 'Checking your post in the secure workflow', detail: 'This can take up to a minute. Keep this page open.' },
  confirming: { title: 'Reward sent. Waiting for confirmation', detail: 'The payment is being confirmed on Arc Testnet.' },
}

export function ClaimProgress({ phase, onReset }: { phase: ClaimPhase; onReset: () => void }) {
  if (phase.name === 'idle') return null
  if (phase.name === 'failed') {
    return (
      <div className="space-y-3">
        <Notice tone="danger" title="Not rewarded">{phase.message}</Notice>
        <Button variant="secondary" small onClick={onReset}>Try again</Button>
      </div>
    )
  }
  if (phase.name === 'paid') {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-2xl px-4 py-4" style={{ background: 'var(--success-soft)', color: 'var(--success)' }} role="status">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="display text-xl font-bold">{phase.amountUsdc6 !== null ? <>You earned <Usdc amount={phase.amountUsdc6} /></> : 'Reward paid'}</p>
            <p className="text-sm">
              {phase.views !== null ? `Measured ${count(Number(phase.views))} unique views and ${count(Number(phase.completions ?? 0))} completions. ` : ''}
              The USDC is in your wallet on Arc Testnet.
            </p>
            <a href={buildTxExplorerUrl(CHAIN_ID, phase.txHash)} target="_blank" rel="noopener noreferrer" className="pl-link inline-flex items-center gap-1 text-sm">
              View transaction <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>
        <Button variant="ghost" small onClick={onReset}>Submit another post</Button>
      </div>
    )
  }
  const { title, detail } = WORKING[phase.name]
  return (
    <div className="pl-inner flex items-start gap-3 px-4 py-4" role="status" aria-live="polite">
      <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{detail}</p>
      </div>
    </div>
  )
}
