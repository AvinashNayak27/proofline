// Mirrors ProoflineCampaigns.quote exactly (integer math, rounding down at each division) so the
// calculator shows what the contract will pay. The contract stays the source of truth.
export type RuleTerms = { cpmUsdc6: bigint; bonusBps: number; maxPerPost: bigint; minViews: number }

export type Quote = {
  base: bigint
  bonus: bigint
  /** Payout before the per-post cap. */
  uncapped: bigint
  payout: bigint
  capped: boolean
  eligible: boolean
  /** Retention in basis points of 100% (10_000 = every viewer finished). */
  retentionBps: number
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b)

export function quote(terms: RuleTerms, views: bigint, completions: bigint): Quote {
  const eligible = views > 0n && views >= BigInt(terms.minViews)
  if (!eligible) return { base: 0n, bonus: 0n, uncapped: 0n, payout: 0n, capped: false, eligible: false, retentionBps: 0 }
  const base = (views * terms.cpmUsdc6) / 1000n
  const watched = min(completions, views)
  const bonus = (((base * BigInt(terms.bonusBps)) / 10_000n) * (watched * watched)) / (views * views)
  const uncapped = base + bonus
  const payout = min(uncapped, terms.maxPerPost)
  return {
    base,
    bonus,
    uncapped,
    payout,
    capped: uncapped > terms.maxPerPost,
    eligible: true,
    retentionBps: Number((watched * 10_000n) / views),
  }
}
