import type { Campaign } from '@/lib/proofline/events'
import { count } from '@/lib/proofline/format'
import { Usdc } from './Usdc'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt style={{ color: 'var(--muted)' }}>{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  )
}

/** The campaign's payout rules, exactly as the contract enforces them. */
export function RuleSummary({ campaign: c }: { campaign: Campaign }) {
  return (
    <dl className="divide-y" style={{ borderColor: 'var(--border)' }}>
      <Row label="Rate">
        <Usdc amount={c.cpmUsdc6} /> per 1,000 unique views
      </Row>
      <Row label="Completion bonus">{c.bonusBps === 0 ? 'None' : `Up to +${c.bonusBps / 100}% when every viewer finishes`}</Row>
      <Row label="Max per post">
        <Usdc amount={c.maxPerPost} />
      </Row>
      <Row label="Max per creator">
        <Usdc amount={c.maxPerCreator} />
      </Row>
      <Row label="Minimum views">{c.minViews === 0 ? 'None' : `${count(c.minViews)} unique views`}</Row>
      <Row label="Proofline code in post">{c.requireProofCode ? 'Required' : 'Not required'}</Row>
      {c.requiredTag ? <Row label="Required in your post"><span className="mono">{c.requiredTag}</span></Row> : null}
    </dl>
  )
}
