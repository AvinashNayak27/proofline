import { Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button, ExternalButton } from '@/components/ui/Button'
import type { Campaign } from '@/lib/proofline/events'
import { proofCode } from '@/lib/proofline/code'
import type { Address } from 'viem'

/** The creator's one code for this campaign, plus a ready-to-edit post. */
export function ProofCodeCard({ campaign, wallet }: { campaign: Campaign; wallet: Address }) {
  const code = proofCode(campaign.id, wallet)
  const draft = [`Proud to partner with ${campaign.brandName || 'this brand'}: ${campaign.title}`, campaign.requiredTag, campaign.requireProofCode ? code : '']
    .filter(Boolean)
    .join(' ')
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error('Copy failed. Select the text and copy it by hand.')
    }
  }
  if (!campaign.requireProofCode) {
    return (
      <div className="space-y-3">
        <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
          Publish a video post on X{campaign.requiredTag ? <> that includes <span className="mono">{campaign.requiredTag}</span></> : null}. No code is needed for this setup.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" small onClick={() => void copy(draft, 'Draft post')}>Copy a draft post</Button>
          <ExternalButton small href={`https://x.com/intent/post?text=${encodeURIComponent(draft)}`} icon={<ExternalLink className="size-4" aria-hidden />}>
            Open in X
          </ExternalButton>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="pl-inner flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="pl-eyebrow">Your code for this campaign</p>
          <p className="mono text-xl font-semibold tabular-nums" aria-label={`Your Proofline code is ${code}`}>{code}</p>
        </div>
        <Button variant="secondary" small icon={<Copy className="size-4" aria-hidden />} onClick={() => void copy(code, 'Code')}>
          Copy code
        </Button>
      </div>
      <p className="text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        Publish a video post on X that includes this code{campaign.requiredTag ? <> and <span className="mono">{campaign.requiredTag}</span></> : null}. The code is tied to your wallet and this campaign, so it proves the post is yours and is for this brand.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" small onClick={() => void copy(draft, 'Draft post')}>Copy a draft post</Button>
        <ExternalButton small href={`https://x.com/intent/post?text=${encodeURIComponent(draft)}`} icon={<ExternalLink className="size-4" aria-hidden />}>
          Open in X
        </ExternalButton>
      </div>
    </div>
  )
}
