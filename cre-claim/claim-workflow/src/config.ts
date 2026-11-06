import { z } from 'zod'
import { APPLICATION, ARC_TESTNET_CHAIN_ID } from './intent'

const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address')

const common = {
  application: z.literal(APPLICATION),
  chainId: z.literal(ARC_TESTNET_CHAIN_ID),
  // Official CRE name for Arc Testnet (chain selector 3034092155422581607).
  chainSelectorName: z.literal('arc-testnet'),
  // Pinned: the bearer token must only ever be sent to this exact endpoint.
  authMeUrl: z.literal('https://dummyjson.com/auth/me'),
  // Per-claim payout cap in 6-decimal USDC units. Keep it equal to the receiver's maxClaimAmount.
  maxClaimAmountUsdc6: z.string().regex(/^[1-9][0-9]{0,17}$/),
  maxIntentTtlSeconds: z.number().int().min(60).max(3600),
  // EVM addresses allowed to trigger a DEPLOYED workflow (the relay's signing address).
  authorizedKeys: z.array(ADDRESS).max(5),
}

// Closed variants: the local-simulation variant has no receiver and cannot write; the production
// variant must name a receiver and at least one authorized key. A production target can never set
// mode "local-simulation" through the schema because unknown/mismatched fields are rejected.
export const configSchema = z.discriminatedUnion('mode', [
  z
    .object({
      ...common,
      mode: z.literal('local-simulation'),
    })
    .strict(),
  z
    .object({
      ...common,
      mode: z.literal('production'),
      receiver: ADDRESS.refine((a) => !/^0x0{40}$/.test(a), 'receiver must be nonzero'),
      gasLimit: z.string().regex(/^[1-9][0-9]{4,8}$/),
      authorizedKeys: common.authorizedKeys.min(1),
    })
    .strict(),
])

export type Config = z.infer<typeof configSchema>
