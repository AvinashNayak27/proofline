import { z } from 'zod'
const common = {
  mode: z.enum(['local-simulation', 'production']),
  application: z.literal('x-analytics-arc-v1'),
  chainId: z.literal(5042002),
  chainSelectorName: z.literal('arc-testnet'),
  maxClaimAmountUsdc6: z.string().regex(/^[1-9][0-9]*$/),
  maxIntentTtlSeconds: z.number().int().min(60).max(3600),
  authorizedKeys: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(5),
}
export const configSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('local-simulation') }).strict(),
  z.object({ ...common, mode: z.literal('production'), receiver: z.string().regex(/^0x[0-9a-fA-F]{40}$/), gasLimit: z.string().regex(/^[1-9][0-9]{4,8}$/), authorizedKeys: common.authorizedKeys.min(1) }).strict(),
])
export type Config = z.infer<typeof configSchema>
