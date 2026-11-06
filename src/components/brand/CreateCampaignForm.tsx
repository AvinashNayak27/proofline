import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { useState } from 'react'
import { erc20Abi, parseEventLogs } from 'viem'
import { useAccount } from 'wagmi'
import { Link, useNavigate } from 'react-router-dom'
import { Usdc } from '@/components/campaigns/Usdc'
import { Button } from '@/components/ui/Button'
import { TextArea, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Feedback'
import { useNow } from '@/hooks/useNow'
import { useOnchainAction, type OnchainStep } from '@/hooks/useOnchainAction'
import { useContractStatus } from '@/hooks/useProofline'
import { useUsdc } from '@/hooks/useUsdc'
import { campaignCreatedEvent, prooflineAbi } from '@/lib/proofline/abi'
import { DEFAULTS, validateForm, type FormValues } from '@/lib/proofline/campaignForm'
import { PROOFLINE_CONTRACT, USDC_ADDRESS } from '@/lib/proofline/config'
import { CampaignPreview } from './CampaignPreview'

const DURATIONS = ['7', '14', '30', '60', '90']

export function CreateCampaignForm() {
  const navigate = useNavigate()
  const now = useNow()
  const { address, isConnected } = useAccount()
  const { balance, allowance } = useUsdc()
  const { status: contract } = useContractStatus()
  const { state, run, reset, running } = useOnchainAction()
  const [values, setValues] = useState<FormValues>(DEFAULTS)
  const [submitted, setSubmitted] = useState(false)

  const set = <K extends keyof FormValues>(key: K) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    if (state.status === 'failed') reset()
  }

  const parsed = validateForm(values, now)
  const errors = submitted && !parsed.ok ? parsed.errors : {}
  const contractNotReady = contract !== undefined && (contract.reportSigner === '0x0000000000000000000000000000000000000000' || contract.paused)
  const short = parsed.ok && balance !== undefined && balance < parsed.deposit

  const submit = async () => {
    setSubmitted(true)
    if (!parsed.ok || !PROOFLINE_CONTRACT || short || contractNotReady) return
    const steps: OnchainStep[] = []
    if (allowance === undefined || allowance < parsed.deposit) {
      steps.push({ label: 'Allow Proofline to hold your campaign budget', address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [PROOFLINE_CONTRACT, parsed.deposit] })
    }
    steps.push({ label: 'Create the campaign and escrow the budget', address: PROOFLINE_CONTRACT, abi: prooflineAbi, functionName: 'createCampaign', args: [parsed.input, parsed.deposit] })
    const receipt = await run(steps)
    if (!receipt) return
    const created = parseEventLogs({ abi: [campaignCreatedEvent], logs: receipt.logs })[0]
    if (created) void navigate(`/campaigns/${created.args.id}`)
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
      >
        <section className="pl-card space-y-4 p-6">
          <h2 className="display text-xl font-bold">Brand and brief</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Brand name" value={values.brandName} onChange={set('brandName')} error={errors.brandName} placeholder="Acme Coffee" maxLength={60} />
            <TextField label="Campaign title" value={values.title} onChange={set('title')} error={errors.title} placeholder="Summer launch" maxLength={120} />
          </div>
          <TextArea label="Brief for creators" value={values.brief} onChange={set('brief')} error={errors.brief} hint="What should creators say or show? This is public." />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Required tag (optional)" value={values.requiredTag} onChange={set('requiredTag')} error={errors.requiredTag} placeholder="#AcmeSummer" hint="Posts must include this exact text." autoCapitalize="off" />
            <TextField label="Brand link (optional)" value={values.link} onChange={set('link')} error={errors.link} placeholder="https://acme.example" inputMode="url" />
          </div>
          <label className="pl-inner flex min-h-11 cursor-pointer items-start gap-3 px-4 py-3">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
              checked={values.requireProofCode}
              onChange={(e) => setValues((prev) => ({ ...prev, requireProofCode: e.target.checked }))}
            />
            <span>
              <span className="block text-sm font-semibold">Require each creator's Proofline code in the post</span>
              <span className="block text-sm" style={{ color: 'var(--muted)' }}>
                On: a post only pays if it contains the creator's personal code, which ties it to this campaign and their wallet. Off: creators can post freely, and only your required tag (if any) is checked. You can't change this after launch.
              </span>
            </span>
          </label>
        </section>

        <section className="pl-card space-y-4 p-6">
          <h2 className="display text-xl font-bold">Payout rules</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Fixed when you create the campaign and enforced by the contract, so creators can trust them.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Rate per 1,000 unique views" suffix="USDC" inputMode="decimal" value={values.cpm} onChange={set('cpm')} error={errors.cpm} />
            <TextField label="Completion bonus" suffix="%" inputMode="decimal" value={values.bonusPct} onChange={set('bonusPct')} error={errors.bonusPct} hint="Extra reward, up to this percent, as more viewers finish the video." />
            <TextField label="Max per post" suffix="USDC" inputMode="decimal" value={values.maxPerPost} onChange={set('maxPerPost')} error={errors.maxPerPost} />
            <TextField label="Max per creator" suffix="USDC" inputMode="decimal" value={values.maxPerCreator} onChange={set('maxPerCreator')} error={errors.maxPerCreator} hint="Counted per verified person, across all their wallets." />
            <TextField label="Minimum unique views" inputMode="numeric" value={values.minViews} onChange={set('minViews')} error={errors.minViews} hint="Posts below this earn nothing." />
          </div>
        </section>

        <section className="pl-card space-y-4 p-6">
          <h2 className="display text-xl font-bold">Budget and timing</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Budget to escrow" suffix="USDC" inputMode="decimal" value={values.deposit} onChange={set('deposit')} error={errors.deposit} hint="Held by the contract. Unspent budget is refundable when you close the campaign." />
            <div className="space-y-1.5">
              <label htmlFor="duration" className="block text-sm font-semibold">Runs for</label>
              <select id="duration" className="pl-input" value={DURATIONS.includes(values.durationDays) ? values.durationDays : '14'} onChange={set('durationDays')}>
                {DURATIONS.map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
              {errors.durationDays ? <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{errors.durationDays}</p> : null}
            </div>
          </div>
        </section>
      </form>

      <aside className="pl-card space-y-4 p-6 lg:sticky lg:top-28">
        <p className="pl-eyebrow">Preview</p>
        {parsed.ok && address ? (
          <CampaignPreview input={parsed.input} deposit={parsed.deposit} brand={address} />
        ) : (
          <div className="pl-inner px-4 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
            {submitted ? 'Fix the highlighted fields to see your campaign.' : isConnected ? 'Fill in the form to preview your campaign.' : 'Connect a wallet and fill in the form to preview your campaign.'}
          </div>
        )}

        {contractNotReady ? (
          <Notice tone="warn" title="Campaigns are not open yet">
            {contract?.paused ? 'The contract is paused.' : 'The contract owner still has to register the report signer.'} <Link to="/admin" className="pl-link">See status</Link>
          </Notice>
        ) : null}
        {short && balance !== undefined ? (
          <Notice tone="warn" title="Not enough USDC">
            This wallet holds <Usdc amount={balance} />. Use "Get test USDC" in the sidebar, then try again.
          </Notice>
        ) : null}
        {state.status === 'failed' ? <Notice tone="danger" title="Campaign not created">{state.message}</Notice> : null}
        {running ? (
          <Notice tone="info" title={`Step ${state.status === 'running' ? state.index + 1 : 1} of ${state.status === 'running' ? state.total : 1}: ${state.status === 'running' ? state.label : ''}`}>
            {state.status === 'running' && state.waiting === 'wallet' ? 'Confirm in your wallet.' : 'Waiting for Arc Testnet to confirm.'}
          </Notice>
        ) : null}

        {isConnected ? (
          <Button className="w-full" loading={running} disabled={contractNotReady || Boolean(short)} onClick={() => void submit()}>
            {parsed.ok ? <>Create and fund <Usdc amount={parsed.deposit} /></> : 'Create campaign'}
          </Button>
        ) : (
          <ConnectKitButton.Custom>
            {({ show }) => <Button className="w-full" onClick={show} icon={<Wallet className="size-4" aria-hidden />}>Connect wallet to launch</Button>}
          </ConnectKitButton.Custom>
        )}
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>You will confirm up to two transactions: allow the budget, then create the campaign. Test USDC only.</p>
      </aside>
    </div>
  )
}
