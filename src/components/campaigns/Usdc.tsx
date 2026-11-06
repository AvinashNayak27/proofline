import { TokenUSDC } from '@web3icons/react'
import { usd } from '@/lib/proofline/format'

/** A USDC amount with the token icon. Amounts are base units (6 decimals). */
export function Usdc({ amount, className = '' }: { amount: bigint; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${className}`}>
      <TokenUSDC variant="branded" size={16} aria-hidden />
      {usd(amount)}
    </span>
  )
}
