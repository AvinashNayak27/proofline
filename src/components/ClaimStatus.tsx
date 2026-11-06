import { AlertTriangle, Check, ExternalLink, Loader2 } from 'lucide-react'
import { arcTestnet } from 'viem/chains'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import type { Phase } from '@/hooks/useClaimFlow'

type Props = { phase: Phase; onReset: () => void }

function Row({ tone, icon, title, detail }: { tone: 'info' | 'ok' | 'warn'; icon: React.ReactNode; title: string; detail?: string }) {
  const bg = tone === 'ok' ? 'rgba(26,128,71,0.08)' : tone === 'warn' ? 'rgba(186,43,76,0.08)' : 'var(--surface-muted)'
  const fg = tone === 'ok' ? 'var(--success)' : tone === 'warn' ? 'var(--danger)' : 'var(--ink)'
  return (
    <div className="flex gap-3 rounded-2xl px-4 py-3" style={{ background: bg }} role="status" aria-live="polite">
      <div className="mt-0.5" style={{ color: fg }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: fg }}>{title}</div>
        {detail ? <div className="mt-0.5 text-xs text-pretty" style={{ color: 'var(--muted)' }}>{detail}</div> : null}
      </div>
    </div>
  )
}

/** Renders only states backed by something real: a response, a signature, or a chain read. */
export function ClaimStatus({ phase, onReset }: Props) {
  const spin = <Loader2 className="size-4 animate-spin" />
  switch (phase.name) {
    case 'awaiting-signature':
      return <Row tone="info" icon={spin} title="Confirm the signature in your wallet" detail="You are signing a claim intent. It moves no funds." />
    case 'submitting':
      return <Row tone="info" icon={spin} title="Sending to the CRE workflow" detail="The workflow checks your signature and your DummyJSON session." />
    case 'verifying':
      return <Row tone="info" icon={spin} title="Waiting for the onchain payout" detail="Watching the receiver contract for your claim. This stops after two minutes if nothing is paid." />
    case 'submitted':
      return (
        <Row
          tone="info"
          icon={<Check className="size-4" />}
          title="Accepted by the trigger"
          detail="No receiver address is configured in this app, so the payout can't be confirmed here. Check the workflow output."
        />
      )
    case 'paid':
      return (
        <div className="space-y-2">
          <Row tone="ok" icon={<Check className="size-4" />} title={phase.amount === null ? 'Payout confirmed' : `${formatUsdc(phase.amount)} USDC paid`} detail="Confirmed onchain by the receiver contract." />
          {phase.txHash ? (
            <a
              href={buildTxExplorerUrl(arcTestnet.id, phase.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold"
              style={{ color: 'var(--accent-hover)' }}
            >
              View payout transaction <ExternalLink className="size-3" />
            </a>
          ) : null}
          <button onClick={onReset} className="block text-xs font-semibold" style={{ color: 'var(--muted)' }}>Start over</button>
        </div>
      )
    case 'timed-out':
      return (
        <div className="space-y-2">
          <Row tone="warn" icon={<AlertTriangle className="size-4" />} title="No payout was detected" detail="The claim may have been rejected, or the network is slow. Check the workflow output, then sign in and try again." />
          <button onClick={onReset} className="block text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>Start over</button>
        </div>
      )
    case 'failed':
      return (
        <div className="space-y-2">
          <Row tone="warn" icon={<AlertTriangle className="size-4" />} title={phase.message} />
          <button onClick={onReset} className="block text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>Try again</button>
        </div>
      )
    default:
      return null
  }
}
