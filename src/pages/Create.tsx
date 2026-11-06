import { CreateCampaignForm } from '@/components/brand/CreateCampaignForm'
import { Notice } from '@/components/ui/Feedback'
import { PROOFLINE_CONTRACT } from '@/lib/proofline/config'

export function Create() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="pl-eyebrow">For brands</p>
        <h1 className="display text-4xl font-bold">Launch a campaign</h1>
        <p className="max-w-2xl text-pretty" style={{ color: 'var(--muted)' }}>
          Fund a budget, set the payout rules, and creators start earning for the reach they deliver. You only pay for measured performance.
        </p>
      </header>
      {PROOFLINE_CONTRACT ? <CreateCampaignForm /> : <Notice tone="warn" title="Contract address not set">Set VITE_PROOFLINE_CONTRACT to create campaigns.</Notice>}
    </div>
  )
}
