import { ArrowUpRight, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ProgressBar } from '@/components/ui/Feedback'
import { useNow } from '@/hooks/useNow'
import type { Campaign } from '@/lib/proofline/events'
import { timeLeft } from '@/lib/proofline/format'
import { StatusBadge } from './StatusBadge'
import { Usdc } from './Usdc'

export function CampaignCard({ campaign: c }: { campaign: Campaign }) {
  const spent = c.deposited === 0n ? 0 : Number((c.paid * 10_000n) / c.deposited) / 100
  const now = useNow()
  return (
    <Link
      to={`/campaigns/${c.id}`}
      className="pl-card group flex h-full flex-col gap-4 p-5 transition-shadow hover:shadow-lg focus-visible:outline-2"
      style={{ outlineColor: 'var(--focus)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pl-eyebrow truncate">{c.brandName || 'Independent brand'}</p>
          <h3 className="display mt-1 line-clamp-2 text-balance text-xl font-bold">{c.title}</h3>
        </div>
        <StatusBadge phase={c.phase} />
      </div>

      <p className="line-clamp-2 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        {c.brief || 'No brief provided.'}
      </p>

      <div className="pl-inner flex items-end justify-between gap-3 px-4 py-3">
        <div>
          <p className="pl-eyebrow">Pays</p>
          <p className="display text-2xl font-bold">
            <Usdc amount={c.cpmUsdc6} />
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>per 1,000 views{c.bonusBps > 0 ? `, up to +${c.bonusBps / 100}% bonus` : ''}</p>
        </div>
        <div className="text-right">
          <p className="pl-eyebrow">Cap</p>
          <p className="text-sm font-semibold">
            <Usdc amount={c.maxPerPost} /> / post
          </p>
        </div>
      </div>

      <div className="mt-auto space-y-2">
        <ProgressBar value={spent} label="Share of the campaign budget already paid out" />
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
          <span>
            <Usdc amount={c.remaining} /> left of <Usdc amount={c.deposited} />
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {timeLeft(c.endsAt, now)}
          </span>
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--accent-hover)' }}>
        View campaign <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  )
}
