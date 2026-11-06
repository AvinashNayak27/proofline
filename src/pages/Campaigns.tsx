import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CampaignCard } from '@/components/campaigns/CampaignCard'
import { LinkButton } from '@/components/ui/Button'
import { EmptyState, Notice, Skeleton } from '@/components/ui/Feedback'
import { useCampaigns } from '@/hooks/useProofline'
import { PROOFLINE_CONTRACT } from '@/lib/proofline/config'
import type { Campaign } from '@/lib/proofline/events'

type Filter = 'live' | 'all'
type Sort = 'newest' | 'rate' | 'budget'

const SORTERS: Record<Sort, (a: Campaign, b: Campaign) => number> = {
  newest: (a, b) => (a.id < b.id ? 1 : -1),
  rate: (a, b) => (a.cpmUsdc6 < b.cpmUsdc6 ? 1 : -1),
  budget: (a, b) => (a.remaining < b.remaining ? 1 : -1),
}

export function Campaigns() {
  const { data, isPending, isError, refetch } = useCampaigns()
  const [filter, setFilter] = useState<Filter>('live')
  const [sort, setSort] = useState<Sort>('newest')
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? [])
      .filter((c) => (filter === 'live' ? c.phase === 'live' : true))
      .filter((c) => !q || `${c.title} ${c.brandName} ${c.requiredTag}`.toLowerCase().includes(q))
      .sort(SORTERS[sort])
  }, [data, filter, sort, query])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="pl-eyebrow">Marketplace</p>
          <h1 className="display text-4xl font-bold">Campaigns</h1>
          <p style={{ color: 'var(--muted)' }}>Pick a brand, post about it, and earn by the rules shown on each card.</p>
        </div>
        <LinkButton to="/create" variant="secondary">Launch a campaign</LinkButton>
      </header>

      {!PROOFLINE_CONTRACT ? <Notice tone="warn" title="Contract address not set">Set VITE_PROOFLINE_CONTRACT to load campaigns.</Notice> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} aria-hidden />
          <input className="pl-input pl-10" placeholder="Search brands and campaigns" aria-label="Search campaigns" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex rounded-xl p-1" style={{ background: 'var(--surface-muted)' }} role="group" aria-label="Show">
          {(['live', 'all'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className="min-h-9 rounded-lg px-3 text-sm font-semibold" style={{ background: filter === f ? '#fff' : 'transparent', color: filter === f ? 'var(--ink)' : 'var(--muted)' }}>
              {f === 'live' ? 'Live' : 'All'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span style={{ color: 'var(--muted)' }}>Sort</span>
          <select className="pl-input w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">Newest</option>
            <option value="rate">Highest rate</option>
            <option value="budget">Most budget left</option>
          </select>
        </label>
      </div>

      {isError ? (
        <Notice tone="danger" title="Could not load campaigns">
          Arc Testnet did not answer. <button type="button" className="pl-link" onClick={() => void refetch()}>Try again</button>
        </Notice>
      ) : isPending && PROOFLINE_CONTRACT ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={data && data.length > 0 ? 'No campaigns match' : 'No campaigns yet'}
          action={<LinkButton to="/create">Launch the first campaign</LinkButton>}
        >
          {data && data.length > 0 ? 'Try another search, or show all campaigns including ended ones.' : 'Be the first brand to fund attention on Proofline.'}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => <CampaignCard key={String(c.id)} campaign={c} />)}
        </div>
      )}
    </div>
  )
}
