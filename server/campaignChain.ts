// Reads public Proofline campaign data from Arc Testnet for the server. Only the creation event
// carries display text, so the campaign's required tag is read from the block the campaign was created in
// (found by bisection, never a history scan) and cached: it never changes.
import { createPublicClient, http, type Address } from 'viem'
import { findCreationBlock, readCreated } from '../src/lib/proofline/discovery'
import { getChain } from '../src/onchain-facts'

const ARC_TESTNET_ID = 5042002
const ARC_TESTNET_PROXY_KEY = 'Arc_Testnet'

/** RPC endpoint: the per-chain override, the sandbox proxy when it covers Arc Testnet, else public RPC. */
export function rpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[`RPC_URL_${ARC_TESTNET_PROXY_KEY}`]
  if (override) return override
  const chains = (env.RPC_PROXY_CHAINS ?? '').split(',')
  if (env.RPC_PROXY_BASE_URL && env.RPC_PROXY_TOKEN && chains.includes(ARC_TESTNET_PROXY_KEY)) {
    return `${env.RPC_PROXY_BASE_URL}/api/rpc/${ARC_TESTNET_PROXY_KEY}?_rpc_token=${env.RPC_PROXY_TOKEN}`
  }
  const chain = getChain(ARC_TESTNET_ID)
  if (!chain?.rpcUrls[0]) throw new Error('no Arc Testnet RPC URL is known')
  return chain.rpcUrls[0]
}

const tags = new Map<string, string>()

/**
 * The campaign's required tag ('' when it sets none). Throws if the campaign cannot be found or
 * the chain cannot be read, so callers fail closed instead of skipping the tag check.
 */
export async function requiredTagFor(contract: Address, deployBlock: bigint, campaignId: bigint): Promise<string> {
  const key = `${contract}:${campaignId}`
  const cached = tags.get(key)
  if (cached !== undefined) return cached
  const client = createPublicClient({ transport: http(rpcUrl()) })
  const head = await client.getBlockNumber()
  const block = await findCreationBlock(client, contract, campaignId, deployBlock, head)
  const tag = (await readCreated(client, contract, campaignId, block)).args.data.requiredTag
  if (typeof tag !== 'string') throw new Error('campaign not found')
  tags.set(key, tag)
  return tag
}
