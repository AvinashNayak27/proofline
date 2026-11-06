// Claim-intent definitions for the browser. Mirrors cre-claim/claim-workflow/src/intent.ts;
// cre-claim/claim-workflow/main.test.ts asserts both produce the same typed-data digest.
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from 'viem'

export const APPLICATION = 'dummyjson-arc-claim-v1'
export const ARC_TESTNET_CHAIN_ID = 5042002
/** How long a signed intent stays valid. Must stay below the workflow's maxIntentTtlSeconds. */
export const INTENT_TTL_SECONDS = 600

export const CLAIM_DOMAIN = {
  name: 'DummyJSON Arc Claim',
  version: '1',
  chainId: ARC_TESTNET_CHAIN_ID,
} as const

export const CLAIM_TYPES = {
  ClaimIntent: [
    { name: 'application', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const

export type ClaimIntent = { wallet: Address; nonce: Hex; expiry: bigint }

export function buildTypedData(intent: ClaimIntent) {
  return {
    domain: CLAIM_DOMAIN,
    types: CLAIM_TYPES,
    primaryType: 'ClaimIntent' as const,
    message: {
      application: APPLICATION,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
      wallet: intent.wallet,
      nonce: intent.nonce,
      expiry: intent.expiry,
    },
  }
}

export function newIntent(wallet: Address, nowMs: number = Date.now()): ClaimIntent {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const nonce: Hex = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
  return { wallet, nonce, expiry: BigInt(Math.floor(nowMs / 1000) + INTENT_TTL_SECONDS) }
}

/** Same opaque commitment the workflow computes; lets the UI watch the receiver for this claim. */
export function computeClaimId(receiver: Address, intent: ClaimIntent): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        'string application, uint256 chainId, address receiver, address wallet, bytes32 nonce, uint256 expiry',
      ),
      [APPLICATION, BigInt(ARC_TESTNET_CHAIN_ID), receiver, intent.wallet, intent.nonce, intent.expiry],
    ),
  )
}
