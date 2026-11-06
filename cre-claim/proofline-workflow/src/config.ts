import { z } from 'zod'

const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/)

const common = {
  application: z.literal('proofline-v1'),
  chainId: z.literal(5042002),
  chainSelectorName: z.literal('arc-testnet'),
  maxIntentTtlSeconds: z.number().int().min(60).max(3600),
  authorizedKeys: z.array(ADDRESS).max(5),
}

/**
 * local-simulation has no contract and can never write. production names the ProoflineCampaigns
 * contract that receives signed reward reports.
 */
export const configSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('local-simulation') }).strict(),
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
