import { ConnectKitButton } from 'connectkit'
import { Check, Fingerprint, Loader2, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Feedback'
import { useClaim } from '@/hooks/useClaim'
import { useWorldSession } from '@/hooks/useWorldSession'
import { useWorldSignIn } from '@/hooks/useWorldSignIn'
import type { Campaign } from '@/lib/proofline/events'
import { ENCLAVE_PUBLIC_KEY } from '@/lib/proofline/config'
import { shortAddress } from '@/lib/proofline/format'
import { parsePostUrl } from '@/lib/proofline/claim'
import { ClaimProgress } from './ClaimProgress'
import { ExtensionStatus } from './ExtensionStatus'
import { ProofCodeCard } from './ProofCodeCard'

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="mono mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: done ? 'var(--success-soft)' : active ? 'var(--accent)' : 'var(--surface-muted)', color: done ? 'var(--success)' : active ? '#fff' : 'var(--muted)' }}
        aria-hidden
      >
        {done ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-3 pb-5">
        <h3 className="font-semibold" style={{ color: active || done ? 'var(--ink)' : 'var(--muted)' }}>{title}</h3>
        {active || done ? children : null}
      </div>
    </li>
  )
}

/** Earn from a campaign: verify you are human, connect a wallet, post with your code, submit the link. */
export function ParticipatePanel({ campaign }: { campaign: Campaign }) {
  const [searchParams] = useSearchParams()
  const { session } = useWorldSession()
  const { begin, href, waiting } = useWorldSignIn()
  const { address, isConnected } = useAccount()
  const { phase, submit, reset, busy } = useClaim(campaign.id)
  const [link, setLink] = useState(() => {
    const post = searchParams.get('post') ?? ''
    return post.length <= 256 && parsePostUrl(post) ? post : ''
  })

  const signedIn = session.status === 'signed-in'
  const worldAvailable = session.status === 'signed-out' ? session.configured : session.status !== 'unreachable'
  const walletReady = isConnected && Boolean(address)
  const linkOk = parsePostUrl(link) !== undefined
  const open = campaign.phase === 'live'

  if (!open) {
    return <Notice tone="warn" title="This campaign is not accepting posts">It is {campaign.phase === 'upcoming' ? 'not open yet' : campaign.phase === 'exhausted' ? 'out of budget' : campaign.phase}. Browse other live campaigns to earn.</Notice>
  }
  if (!ENCLAVE_PUBLIC_KEY) {
    return <Notice tone="warn" title="Posting is not set up yet">The secure workflow key is missing from this app, so posts cannot be verified.</Notice>
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-0">
        <Step n={1} title="Verify you are a unique human" done={signedIn} active={!signedIn}>
          {signedIn ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Orb-verified World ID <span className="mono tabular-nums">{session.subjectPreview}</span></p>
          ) : worldAvailable ? (
            <div className="space-y-2">
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Rewards go to real people. Sign in with an Orb-verified World ID; you will authenticate fresh each time.</p>
              <a href={href} onClick={begin} className="pl-btn pl-btn-primary">
                {waiting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Fingerprint className="size-4" aria-hidden />}
                {waiting ? 'Finish in the new tab' : 'Continue with World ID'}
              </a>
            </div>
          ) : (
            <Notice tone="warn" title="World ID sign-in is unavailable">The sign-in service is not running or not configured yet.</Notice>
          )}
        </Step>

        <Step n={2} title="Connect the wallet that gets paid" done={walletReady} active={signedIn && !walletReady}>
          {walletReady && address ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Rewards go to <span className="mono tabular-nums">{shortAddress(address)}</span> on Arc Testnet.</p>
          ) : (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <Button onClick={show} icon={<Wallet className="size-4" aria-hidden />}>Connect wallet</Button>
              )}
            </ConnectKitButton.Custom>
          )}
        </Step>

        <Step n={3} title={campaign.requireProofCode ? 'Publish your post with your code' : 'Publish your post — no code required'} done={false} active={signedIn && walletReady}>
          {address ? <ProofCodeCard campaign={campaign} wallet={address} /> : null}
        </Step>

        <Step n={4} title="Submit your post" done={phase.name === 'paid'} active={signedIn && walletReady}>
          <div className="space-y-3">
            <ExtensionStatus />
            <TextField
              label="Link to your post"
              placeholder="https://x.com/yourhandle/status/1234567890"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              error={link && !linkOk ? 'Use the plain post link, like https://x.com/you/status/123, with nothing after the number.' : null}
              hint={campaign.requireProofCode ? 'The post must be public, include your code, and be yours: Proofline reads its analytics from your own X session.' : 'The post must be public and yours: Proofline reads its analytics from your own X session.'}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            {phase.name === 'idle' || phase.name === 'failed' ? (
              phase.name === 'idle' ? (
                <Button className="w-full" disabled={!linkOk} onClick={() => void submit(link)}>Verify post and get paid</Button>
              ) : null
            ) : null}
            <ClaimProgress phase={phase} onReset={reset} />
          </div>
        </Step>
      </ol>
    </div>
  )
}
