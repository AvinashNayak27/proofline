import { isAddress, parseAbi, type Address } from 'viem'

export const receiverAbi = parseAbi([
  'function claimed(bytes32 claimId) view returns (bool)',
  'function totalPaid() view returns (uint256)',
  'function maxRewardBudget() view returns (uint256)',
  'function paused() view returns (bool)',
  'function maxClaimAmount() view returns (uint256)',
  'event ClaimPaid(bytes32 indexed claimId, address indexed recipient, bytes32 userCommitment, uint256 amount, uint256 expiry)',
])

const raw: unknown = import.meta.env.VITE_CLAIM_RECEIVER

/** Deployed ArcClaimReceiver address, or null while none is configured (set VITE_CLAIM_RECEIVER in .env). */
export const CLAIM_RECEIVER: Address | null = typeof raw === 'string' && isAddress(raw) ? raw : null
