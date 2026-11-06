import type { Address, Hex, PublicClient } from 'viem'
import { campaignCreatedEvent, postRewardedEvent, prooflineAbi, STATUS } from './abi'
import { PROOFLINE_CONTRACT, PROOFLINE_DEPLOY_BLOCK } from './config'

export type CampaignMeta = {
  id: bigint
  brand: Address
  brandName: string
  title: string
  brief: string
  requiredTag: string
  link: string
  startsAt: bigint
  endsAt: bigint
  minViews: number
  bonusBps: number
  cpmUsdc6: bigint
  maxPerPost: bigint
  maxPerCreator: bigint
  requireProofCode: boolean
  deposit: bigint
  txHash: Hex
}

export type Phase = 'upcoming' | 'live' | 'paused' | 'ended' | 'closed' | 'exhausted'

export type Campaign = CampaignMeta & {
  status: number
  deposited: bigint
  paid: bigint
  withdrawn: bigint
  remaining: bigint
  phase: Phase
}

export type Reward = {
  campaignId: bigint
  postKey: Hex
  creatorCommitment: Hex
  recipient: Address
  uniqueViews: bigint
  completions: bigint
  amount: bigint
  blockNumber: bigint
  txHash: Hex
}

const WINDOW = 50_000n

type LogParams = { address: Address; event: typeof campaignCreatedEvent | typeof postRewardedEvent; args?: Record<string, unknown> }

/**
 * Reads logs from the deployment block to the chain head. One request when the node allows it,
 * otherwise bounded windows, so a large range never fails the page.
 */
async function logsSince<T>(client: PublicClient, params: LogParams): Promise<T[]> {
  const head = await client.getBlockNumber()
  const read = (fromBlock: bigint, toBlock: bigint) =>
    client.getLogs({ address: params.address, event: params.event, args: params.args, fromBlock, toBlock } as never) as Promise<T[]>
  try {
    return await read(PROOFLINE_DEPLOY_BLOCK, head)
  } catch {
    const out: T[] = []
    for (let from = PROOFLINE_DEPLOY_BLOCK; from <= head; from += WINDOW) {
      const to = from + WINDOW - 1n > head ? head : from + WINDOW - 1n
      out.push(...(await read(from, to)))
    }
    return out
  }
}

export function phaseOf(c: Pick<CampaignMeta, 'startsAt' | 'endsAt'> & { status: number; remaining: bigint }, nowSec: number): Phase {
  if (c.status === STATUS.Closed) return 'closed'
  if (c.status === STATUS.Paused) return 'paused'
  if (nowSec >= Number(c.endsAt)) return 'ended'
  if (nowSec < Number(c.startsAt)) return 'upcoming'
  if (c.remaining === 0n) return 'exhausted'
  return 'live'
}

type CreatedLog = {
  args: {
    id: bigint
    brand: Address
    data: Omit<CampaignMeta, 'id' | 'brand' | 'txHash'>
  }
  transactionHash: Hex
}

/** Every campaign ever created, with live escrow state read from the contract. */
export async function fetchCampaigns(client: PublicClient, nowSec: number): Promise<Campaign[]> {
  if (!PROOFLINE_CONTRACT) return []
  const logs = await logsSince<CreatedLog>(client, { address: PROOFLINE_CONTRACT, event: campaignCreatedEvent })
  const campaigns = await Promise.all(
    logs.map(async (log): Promise<Campaign> => {
      const [state, remaining] = await Promise.all([
        client.readContract({ address: PROOFLINE_CONTRACT as Address, abi: prooflineAbi, functionName: 'getCampaign', args: [log.args.id] }),
        client.readContract({ address: PROOFLINE_CONTRACT as Address, abi: prooflineAbi, functionName: 'remaining', args: [log.args.id] }),
      ])
      const d = log.args.data
      const meta: CampaignMeta = {
        id: log.args.id,
        brand: log.args.brand,
        brandName: d.brandName,
        title: d.title,
        brief: d.brief,
        requiredTag: d.requiredTag,
        link: d.link,
        startsAt: BigInt(state.startsAt),
        endsAt: BigInt(state.endsAt),
        minViews: state.minViews,
        bonusBps: state.bonusBps,
        cpmUsdc6: BigInt(state.cpmUsdc6),
        maxPerPost: BigInt(state.maxPerPost),
        maxPerCreator: BigInt(state.maxPerCreator),
        requireProofCode: state.requireProofCode,
        deposit: d.deposit,
        txHash: log.transactionHash,
      }
      const live = { status: state.status, remaining }
      return {
        ...meta,
        ...live,
        deposited: state.deposited,
        paid: state.paid,
        withdrawn: state.withdrawn,
        phase: phaseOf({ ...meta, ...live }, nowSec),
      }
    }),
  )
  return campaigns.sort((a, b) => (a.id < b.id ? 1 : -1))
}

type RewardLog = {
  args: { campaignId: bigint; postKey: Hex; creatorCommitment: Hex; recipient: Address; uniqueViews: bigint; completions: bigint; amount: bigint }
  blockNumber: bigint
  transactionHash: Hex
}

/** Every paid post, newest first. */
export async function fetchRewards(client: PublicClient): Promise<Reward[]> {
  if (!PROOFLINE_CONTRACT) return []
  const logs = await logsSince<RewardLog>(client, { address: PROOFLINE_CONTRACT, event: postRewardedEvent })
  return logs
    .map((l) => ({ ...l.args, blockNumber: l.blockNumber, txHash: l.transactionHash }))
    .sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1))
}
