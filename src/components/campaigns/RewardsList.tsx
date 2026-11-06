import { ExternalLink } from 'lucide-react'
import { EmptyState } from '@/components/ui/Feedback'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID } from '@/lib/proofline/config'
import type { Reward } from '@/lib/proofline/events'
import { count, shortAddress } from '@/lib/proofline/format'
import { Usdc } from './Usdc'

/** Paid posts from onchain PostRewarded events. */
export function RewardsList({ rewards, empty }: { rewards: Reward[]; empty: string }) {
  if (rewards.length === 0) return <EmptyState title="No rewards yet">{empty}</EmptyState>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead>
          <tr className="pl-eyebrow">
            <th className="pb-2 pr-3 font-semibold">Creator wallet</th>
            <th className="pb-2 pr-3 text-right font-semibold">Views</th>
            <th className="pb-2 pr-3 text-right font-semibold">Completions</th>
            <th className="pb-2 pr-3 text-right font-semibold">Paid</th>
            <th className="pb-2 text-right font-semibold"><span className="sr-only">Transaction</span></th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {rewards.map((r) => (
            <tr key={`${r.txHash}-${r.postKey}`}>
              <td className="mono py-2.5 pr-3">{shortAddress(r.recipient)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{count(r.uniqueViews)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{count(r.completions)}</td>
              <td className="py-2.5 pr-3 text-right font-semibold"><Usdc amount={r.amount} /></td>
              <td className="py-2.5 text-right">
                <a href={buildTxExplorerUrl(CHAIN_ID, r.txHash)} target="_blank" rel="noopener noreferrer" className="pl-link inline-flex items-center gap-1 text-xs">
                  View <ExternalLink className="size-3" aria-hidden /><span className="sr-only">transaction on the explorer</span>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
