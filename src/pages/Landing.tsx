import { ArrowRight, BadgeCheck, Coins, Cpu, Fingerprint, Megaphone, Radar, Send, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LinkButton } from '@/components/ui/Button'
import { Notice } from '@/components/ui/Feedback'
import { Stat } from '@/components/ui/Stat'
import { Usdc } from '@/components/campaigns/Usdc'
import { CampaignCard } from '@/components/campaigns/CampaignCard'
import { useCampaigns, useRewards } from '@/hooks/useProofline'
import { PROOFLINE_CONTRACT } from '@/lib/proofline/config'
import { count } from '@/lib/proofline/format'

/** The flow as a rising line: three checkpoints, no data. */
function FlowGraphic() {
  const nodes = [
    { x: 40, y: 150, label: 'Post goes live', sub: 'Carries the creator\'s code' },
    { x: 200, y: 92, label: 'Reach is measured', sub: 'Inside a Chainlink CRE enclave' },
    { x: 360, y: 34, label: 'Reward is paid', sub: 'USDC on Arc, by the rules' },
  ]
  return (
    <svg viewBox="0 0 420 200" className="h-auto w-full" role="img" aria-label="A rising line with three checkpoints: the post goes live, reach is measured, the reward is paid">
      <path d="M40 150 L200 92 L360 34" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 150 L200 92 L360 34" fill="none" stroke="var(--signal)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 14" />
      {nodes.map((n, i) => (
        <g key={n.label}>
          <circle cx={n.x} cy={n.y} r={i === 2 ? 11 : 9} fill={i === 2 ? 'var(--signal)' : '#fff'} stroke="var(--ink)" strokeWidth="3" />
          <text x={n.x} y={n.y + 34} textAnchor={i === 2 ? 'end' : i === 0 ? 'start' : 'middle'} className="display" fontSize="14" fontWeight="700" fill="var(--ink)">
            {n.label}
          </text>
          <text x={n.x} y={n.y + 52} textAnchor={i === 2 ? 'end' : i === 0 ? 'start' : 'middle'} fontSize="11" fill="var(--muted)">
            {n.sub}
          </text>
        </g>
      ))}
    </svg>
  )
}

const BRAND_STEPS = [
  'Create a campaign and fund it with USDC.',
  'Set the rate per 1,000 views, caps and bonus.',
  'Open it to creators. Nothing to negotiate.',
  'Watch posts, reach and payouts onchain.',
]
const CREATOR_STEPS = [
  'Sign in with World ID. One person, one identity.',
  'Pick a campaign that fits your audience.',
  'Post on X with your Proofline code.',
  'Submit the link and have reach measured.',
  'Get paid in USDC on Arc, instantly.',
]

const PILLARS = [
  { icon: Fingerprint, name: 'World ID', title: 'Human participation', body: 'Rewards connect to authenticated, unique people instead of relying only on social accounts.' },
  { icon: Cpu, name: 'Chainlink CRE', title: 'Verifiable data workflow', body: 'A confidential workflow reads each post\'s analytics and attests only the measurements.' },
  { icon: Coins, name: 'Arc', title: 'Programmable stablecoin payments', body: 'The campaign contract holds the budget and pays creators in USDC, by rules anyone can read.' },
]

export function Landing() {
  const campaigns = useCampaigns()
  const rewards = useRewards()
  const list = campaigns.data ?? []
  const funded = list.reduce((sum, c) => sum + c.deposited, 0n)
  const paid = list.reduce((sum, c) => sum + c.paid, 0n)
  const live = list.filter((c) => c.phase === 'live')
  const loading = campaigns.isPending || rewards.isPending

  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <p className="pl-eyebrow">The programmable creator rewards marketplace</p>
          <h1 className="display text-balance text-5xl font-bold leading-[1.02] sm:text-6xl">
            Brands fund attention.
            <br />
            <span style={{ boxShadow: 'inset 0 -0.18em 0 var(--signal-soft)' }}>Creators earn from performance.</span>
          </h1>
          <p className="max-w-xl text-pretty text-lg" style={{ color: 'var(--muted)' }}>
            Fund a campaign, set transparent payout rules, and let verified creators earn USDC for the reach they actually deliver. No negotiations, no manual payouts.
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton to="/campaigns" icon={<Megaphone className="size-4" aria-hidden />}>Explore campaigns</LinkButton>
            <LinkButton to="/create" variant="secondary" icon={<Sparkles className="size-4" aria-hidden />}>Launch a campaign</LinkButton>
          </div>
        </div>
        <div className="pl-card space-y-4 p-6">
          <FlowGraphic />
          <div className="pl-inner space-y-1 px-4 py-3">
            <p className="pl-eyebrow">Payout, per post</p>
            <p className="mono text-sm">views ÷ 1,000 × rate × (1 + bonus × retention²), up to the post cap</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Retention is the share of viewers who finish the video. Every campaign sets its own numbers.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="live-numbers" className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <h2 id="live-numbers" className="display text-2xl font-bold">Live on Arc Testnet</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Read from the Proofline contract</p>
        </div>
        {!PROOFLINE_CONTRACT ? (
          <Notice tone="warn" title="Contract address not set">Set VITE_PROOFLINE_CONTRACT to show live campaign numbers.</Notice>
        ) : (
          <div className="pl-card grid grid-cols-2 gap-6 p-6 lg:grid-cols-4">
            <Stat label="Campaigns" value={count(list.length)} sub={`${live.length} live now`} loading={loading} />
            <Stat label="Funded" value={<Usdc amount={funded} />} sub="Test USDC escrowed in total" loading={loading} />
            <Stat label="Paid to creators" value={<Usdc amount={paid} />} sub="Settled onchain" loading={loading} />
            <Stat label="Posts rewarded" value={count(rewards.data?.length ?? 0)} sub="Each post pays once" loading={loading} />
          </div>
        )}
        {live.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {live.slice(0, 3).map((c) => <CampaignCard key={String(c.id)} campaign={c} />)}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="how" className="space-y-6">
        <h2 id="how" className="display text-2xl font-bold">How it works</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[{ title: 'For brands', icon: Megaphone, steps: BRAND_STEPS }, { title: 'For creators', icon: Send, steps: CREATOR_STEPS }].map((col) => (
            <div key={col.title} className="pl-card space-y-4 p-6">
              <h3 className="display flex items-center gap-2 text-xl font-bold"><col.icon className="size-5" aria-hidden />{col.title}</h3>
              <ol className="space-y-3">
                {col.steps.map((s, i) => (
                  <li key={s} className="flex gap-3 text-sm">
                    <span className="mono flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ background: 'var(--surface-muted)' }}>{i + 1}</span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="why" className="space-y-6">
        <h2 id="why" className="display text-2xl font-bold">Built on three things that matter</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.name} className="pl-card space-y-3 p-6">
              <p className="pl-eyebrow flex items-center gap-2"><p.icon className="size-4" aria-hidden />{p.name}</p>
              <h3 className="display text-lg font-bold">{p.title}</h3>
              <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pl-card flex flex-col items-start justify-between gap-5 p-8 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <p className="display text-balance text-2xl font-bold">Campaigns become programmable. Performance becomes measurable.</p>
          <p style={{ color: 'var(--muted)' }}>Rewards become accessible.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <LinkButton to="/campaigns" icon={<Radar className="size-4" aria-hidden />}>Find a campaign</LinkButton>
          <Link to="/create" className="pl-btn pl-btn-ghost">Fund one <ArrowRight className="size-4" aria-hidden /></Link>
        </div>
      </section>
      <p className="flex items-center justify-center gap-2 text-xs" style={{ color: 'var(--subtle)' }}><BadgeCheck className="size-4" aria-hidden />Testnet only. Test USDC has no monetary value.</p>
    </div>
  )
}
