import { Pause, Play, Wallet2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { erc20Abi } from 'viem'
import { RewardsList } from '@/components/campaigns/RewardsList'
import { StatusBadge } from '@/components/campaigns/StatusBadge'
import { Usdc } from '@/components/campaigns/Usdc'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Notice, ProgressBar } from '@/components/ui/Feedback'
import { Stat } from '@/components/ui/Stat'
import { useNow } from '@/hooks/useNow'
import { useOnchainAction, type OnchainStep } from '@/hooks/useOnchainAction'
import { useUsdc } from '@/hooks/useUsdc'
import { prooflineAbi, STATUS } from '@/lib/proofline/abi'
import { PROOFLINE_CONTRACT, USDC_ADDRESS } from '@/lib/proofline/config'
import type { Campaign, Reward } from '@/lib/proofline/events'
import { timeLeft } from '@/lib/proofline/format'
import { parseUsdc } from '@/onchain-money'

/** One of the connected brand's campaigns, with the actions only the brand wallet can take. */
export function ManagedCampaign({ campaign: c, rewards }: { campaign: Campaign; rewards: Reward[] }) {
  const now = useNow()
  const { allowance } = useUsdc()
  const { state, run, reset, running } = useOnchainAction()
  const [amount, setAmount] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [showRewards, setShowRewards] = useState(false)

  const closed = c.status === STATUS.Closed
  const paused = c.status === STATUS.Paused
  const spent = c.deposited === 0n ? 0 : Number((c.paid * 10_000n) / c.deposited) / 100
  let topUp: bigint | null = null
  try {
    topUp = amount.trim() ? parseUsdc(amount.trim()) : null
    if (topUp !== null && topUp <= 0n) topUp = null
  } catch {
    topUp = null
  }

  const contract = PROOFLINE_CONTRACT
  if (!contract) return null

  const addFunds = async () => {
    if (topUp === null) return
    const steps: OnchainStep[] = []
    if (allowance === undefined || allowance < topUp) {
      steps.push({ label: 'Allow Proofline to hold the extra budget', address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [contract, topUp] })
    }
    steps.push({ label: 'Add the budget to this campaign', address: contract, abi: prooflineAbi, functionName: 'fund', args: [c.id, topUp] })
    if (await run(steps)) setAmount('')
  }

  return (
    <article className="pl-card space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pl-eyebrow">Campaign #{String(c.id)} · {timeLeft(c.endsAt, now)}</p>
          <h3 className="display text-balance text-xl font-bold">
            <Link to={`/campaigns/${c.id}`} className="hover:underline">{c.title}</Link>
          </h3>
        </div>
        <StatusBadge phase={c.phase} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Remaining" value={<Usdc amount={c.remaining} />} />
        <Stat label="Paid out" value={<Usdc amount={c.paid} />} sub={`${rewards.length} post${rewards.length === 1 ? '' : 's'}`} />
        <Stat label="Funded" value={<Usdc amount={c.deposited} />} />
      </div>
      <ProgressBar value={spent} label="Share of the campaign budget already paid out" />

      {state.status === 'failed' ? <Notice tone="danger" title="That did not go through">{state.message}</Notice> : null}
      {state.status === 'running' ? <Notice tone="info" title={state.label}>{state.waiting === 'wallet' ? 'Confirm in your wallet.' : 'Waiting for Arc Testnet to confirm.'}</Notice> : null}
      {state.status === 'done' ? <Notice tone="success" title="Done">The campaign was updated.</Notice> : null}

      {!closed ? (
        <div className="space-y-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-44 flex-1">
              <TextField label="Add budget" suffix="USDC" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); if (state.status !== 'idle') reset() }} placeholder="25.00" />
            </div>
            <Button variant="secondary" disabled={topUp === null || running} loading={running && state.status === 'running' && state.total > 0 && !confirmClose} icon={<Wallet2 className="size-4" aria-hidden />} onClick={() => void addFunds()}>Add funds</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              small
              disabled={running}
              icon={paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              onClick={() => void run([{ label: paused ? 'Resume the campaign' : 'Pause the campaign', address: contract, abi: prooflineAbi, functionName: 'setPaused', args: [c.id, !paused] }])}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            {!confirmClose ? (
              <Button variant="danger" small disabled={running} onClick={() => setConfirmClose(true)}>Close and refund</Button>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm">Close for good and refund <Usdc amount={c.remaining} /> to your wallet?</span>
                <Button variant="danger" small loading={running} onClick={() => void run([{ label: 'Close the campaign and refund the budget', address: contract, abi: prooflineAbi, functionName: 'close', args: [c.id] }]).then(() => setConfirmClose(false))}>Yes, close it</Button>
                <Button variant="ghost" small disabled={running} onClick={() => setConfirmClose(false)}>Keep it open</Button>
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>This campaign is closed. Its remaining budget was refunded to your wallet.</p>
      )}

      <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <button type="button" className="pl-link text-sm" aria-expanded={showRewards} onClick={() => setShowRewards((s) => !s)}>
          {showRewards ? 'Hide rewards' : `Show rewards (${rewards.length})`}
        </button>
        {showRewards ? <div className="mt-3"><RewardsList rewards={rewards} empty="No posts have been rewarded yet." /></div> : null}
      </div>
    </article>
  )
}
