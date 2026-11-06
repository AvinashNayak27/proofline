// Claim intent definitions for the browser. Mirrors cre-claim/proofline-workflow/src/intent.ts;
// the workflow tests assert both produce the same typed-data digest.
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from 'viem'

export const APPLICATION = 'proofline-v1'
export const ARC_TESTNET_CHAIN_ID = 5042002
/** How long a signed claim stays valid. Must stay below the workflow's maxIntentTtlSeconds. */
export const INTENT_TTL_SECONDS = 600

export const CLAIM_DOMAIN = { name: 'Proofline Claim', version: '1', chainId: ARC_TESTNET_CHAIN_ID } as const

export const CLAIM_TYPES = {
  ClaimIntent: [
    { name: 'application', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'campaignId', type: 'uint256' },
    { name: 'postId', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'creatorCommitment', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const

export type ClaimIntent = {
  campaignId: bigint
  postId: string
  wallet: Address
  creatorCommitment: Hex
  nonce: Hex
  expiry: bigint
}

export function buildTypedData(intent: ClaimIntent) {
  return {
    domain: CLAIM_DOMAIN,
    types: CLAIM_TYPES,
    primaryType: 'ClaimIntent' as const,
    message: {
      application: APPLICATION,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
      campaignId: intent.campaignId,
      postId: intent.postId,
      wallet: intent.wallet,
      creatorCommitment: intent.creatorCommitment,
      nonce: intent.nonce,
      expiry: intent.expiry,
    },
  }
}

export function newIntent(
  input: Pick<ClaimIntent, 'campaignId' | 'postId' | 'wallet' | 'creatorCommitment'>,
  nowMs: number = Date.now(),
): ClaimIntent {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const nonce: Hex = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
  return { ...input, nonce, expiry: BigInt(Math.floor(nowMs / 1000) + INTENT_TTL_SECONDS) }
}

const POST_URL = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})\/?$/

/** Parses a post link into its handle and id. Rejects query strings, fragments and other hosts. */
export function parsePostUrl(link: string): { handle: string; postId: string } | undefined {
  const m = POST_URL.exec(link.trim())
  return m ? { handle: m[1], postId: m[2] } : undefined
}

/** Same opaque key the workflow and contract use. The contract lets a post pay once per campaign. */
export function postKey(postId: string): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('string tag, string postId'), ['proofline-post-v1', postId]))
}
