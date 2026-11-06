// Finds Proofline events without scanning history. Arc produces blocks quickly and nodes cap log
// ranges, so a deployment-to-head scan is hopeless. Two facts make targeted reads possible:
//  - campaign ids are sequential, so `nextCampaignId` at any past block says which ids existed then,
//    and a bisection finds the exact block a campaign was created in;
//  - a campaign's `paid` total only ever grows, and only when a post is rewarded, so a bisection on
//    `paid` finds the few blocks that contain PostRewarded events.
// This module has no environment access, so the browser and the server both use it.
import type { Address, Hex, PublicClient } from 'viem'
import { campaignCreatedEvent, postRewardedEvent, prooflineAbi } from './abi'

/** Log windows stay far below the few-thousand-block cap public nodes enforce. */
const WINDOW = 500n

export interface KeyValueStore {
  get(key: string): string | null | undefined
  set(key: string, value: string): void
}

export type CreatedLog = {
  args: {
    id: bigint
    brand: Address
    data: {
      brandName: string
      title: string
      brief: string
      requiredTag: string
      link: string
      deposit: bigint
    }
  }
  blockNumber: bigint
  transactionHash: Hex
}

export type RewardLog = {
  args: { campaignId: bigint; postKey: Hex; creatorCommitment: Hex; recipient: Address; uniqueViews: bigint; completions: bigint; amount: bigint }
  blockNumber: bigint
  transactionHash: Hex
}

/** The next campaign id at a block (the number of campaigns created so far, plus one). Zero before deployment. */
export async function nextCampaignId(client: PublicClient, contract: Address, blockNumber?: bigint): Promise<bigint> {
  try {
    return (await client.readContract({ address: contract, abi: prooflineAbi, functionName: 'nextCampaignId', blockNumber }))
  } catch {
    return 0n
  }
}

/** The first block where campaign `id` exists. Throws when it does not exist at `hi`. */
export async function findCreationBlock(client: PublicClient, contract: Address, id: bigint, lo: bigint, hi: bigint): Promise<bigint> {
  if ((await nextCampaignId(client, contract, hi)) <= id) throw new Error('campaign not found')
  let low = lo
  let high = hi
  while (low < high) {
    const mid = (low + high) / 2n
    if ((await nextCampaignId(client, contract, mid)) > id) high = mid
    else low = mid + 1n
  }
  return low
}

/** The CampaignCreated event for `id`, read from the single block it was created in. */
export async function readCreated(client: PublicClient, contract: Address, id: bigint, block: bigint): Promise<CreatedLog> {
  const logs = (await client.getLogs({
    address: contract,
    event: campaignCreatedEvent,
    args: { id },
    fromBlock: block,
    toBlock: block,
  } as never)) as unknown as CreatedLog[]
  const log = logs[0]
  if (!log) throw new Error('campaign creation event not found')
  return log
}

async function paidAt(client: PublicClient, contract: Address, id: bigint, blockNumber: bigint): Promise<bigint> {
  const state = await client.readContract({ address: contract, abi: prooflineAbi, functionName: 'getCampaign', args: [id], blockNumber })
  return BigInt(state.paid)
}

export type RewardScan = { block: bigint; paid: bigint }

/**
 * PostRewarded logs for one campaign in (from.block, to.block]. `from` and `to` carry the campaign's
 * `paid` total at those blocks, so ranges with no change are skipped without reading any logs.
 */
export async function rewardsBetween(client: PublicClient, contract: Address, id: bigint, from: RewardScan, to: RewardScan): Promise<RewardLog[]> {
  if (from.paid === to.paid || from.block >= to.block) return []
  if (to.block - from.block <= WINDOW) {
    return (await client.getLogs({
      address: contract,
      event: postRewardedEvent,
      args: { campaignId: id },
      fromBlock: from.block + 1n,
      toBlock: to.block,
    } as never)) as unknown as RewardLog[]
  }
  const midBlock = (from.block + to.block) / 2n
  const mid: RewardScan = { block: midBlock, paid: await paidAt(client, contract, id, midBlock) }
  const left = await rewardsBetween(client, contract, id, from, mid)
  const right = await rewardsBetween(client, contract, id, mid, to)
  return [...left, ...right]
}

/** The campaign's `paid` total at `block`, packaged for rewardsBetween. */
export async function scanPoint(client: PublicClient, contract: Address, id: bigint, block: bigint): Promise<RewardScan> {
  return { block, paid: await paidAt(client, contract, id, block) }
}
