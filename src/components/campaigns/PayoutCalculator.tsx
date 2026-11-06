import { useMemo, useState } from 'react'
import { TextField } from '@/components/ui/Field'
import type { Campaign } from '@/lib/proofline/events'
import { count } from '@/lib/proofline/format'
import { quote } from '@/lib/proofline/payout'
import { Usdc } from './Usdc'

const toInt = (v: string): bigint => (/^[0-9]{1,9}$/.test(v) ? BigInt(v) : 0n)

/** Try your own numbers. The same integer math the contract runs, so the result is what it would pay. */
export function PayoutCalculator({ campaign }: { campaign: Campaign }) {
  const [views, setViews] = useState('10000')
  const [completions, setCompletions] = useState('5000')
  const q = useMemo(() => quote(campaign, toInt(views), toInt(completions)), [campaign, views, completions])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Unique video views" inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value.replace(/\D/g, ''))} />
        <TextField label="Video completions" inputMode="numeric" value={completions} onChange={(e) => setCompletions(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="pl-inner space-y-2 px-4 py-4 text-sm">
        {!q.eligible ? (
          <p style={{ color: 'var(--muted)' }}>
            {campaign.minViews > 0 ? `A post needs at least ${count(campaign.minViews)} unique views to earn.` : 'Enter some views to see a payout.'}
          </p>
        ) : (
          <>
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Views reward</span><Usdc amount={q.base} /></div>
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Completion bonus ({(q.retentionBps / 100).toFixed(0)}% finished)</span><Usdc amount={q.bonus} /></div>
            {q.capped ? <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Capped at the per-post maximum</span><Usdc amount={campaign.maxPerPost} /></div> : null}
            <div className="flex items-baseline justify-between border-t pt-2" style={{ borderColor: 'var(--border)' }}>
              <span className="font-semibold">You would earn</span>
              <span className="display text-2xl font-bold"><Usdc amount={q.payout} /></span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
