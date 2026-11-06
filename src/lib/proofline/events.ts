import type { Address, Hex, PublicClient } from 'viem'
import { prooflineAbi, STATUS } from './abi'
import { browserStore } from './cache'
import { PROOFLINE_CONTRACT, PROOFLINE_DEPLOY_BLOCK } from './config'
import { findCreationBlock, nextCampaignId, readCreated, rewardsBetween, scanPoint, type RewardLog } from './discovery'

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
  createdBlock: bigint
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

export function phaseOf(c: Pick<CampaignMeta, 'startsAt' | 'endsAt'> & { status: number; remaining: bigint }, nowSec: number): Phase {
  if (c.status === STATUS.Closed) return 'closed'
  if (c.status === STATUS.Paused) return 'paused'
  if (nowSec >= Number(c.endsAt)) return 'ended'
  if (nowSec < Number(c.startsAt)) return 'upcoming'
  if (c.remaining === 0n) return 'exhausted'
  return 'live'
}

/** Display text and creation facts. These never change, so they are cached after the first read. */
type StoredMeta = { brand: Address; brandName: string; title: string; brief: string; requiredTag: string; link: string; deposit: string; txHash: Hex; createdBlock: string }

async function loadMeta(client: PublicClient, contract: Address, id: bigint, lowerBound: bigint, head: bigint): Promise<StoredMeta> {
  const key = `proofline:v2:${contract}:meta:${id}`
  const hit = browserStore.get(key)
  if (hit) return JSON.parse(hit) as StoredMeta
  const block = await findCreationBlock(client, contract, id, lowerBound, head)
  const log = await readCreated(client, contract, id, block)
  const d = log.args.data
  const stored: StoredMeta = {
    brand: log.args.brand,
    brandName: d.brandName,
    title: d.title,
    brief: d.brief,
    requiredTag: d.requiredTag,
    link: d.link,
    deposit: d.deposit.toString(),
    txHash: log.transactionHash,
    createdBlock: block.toString(),
  }
  browserStore.set(key, JSON.stringify(stored))
  return stored
}

/** Every campaign: ids come from the contract's counter, terms and escrow from its state, text from the creation block. */
export async function fetchCampaigns(client: PublicClient, nowSec: number): Promise<Campaign[]> {
  const contract = PROOFLINE_CONTRACT
  if (!contract) return []
  const head = await client.getBlockNumber()
  const next = await nextCampaignId(client, contract, head)
  const ids: bigint[] = []
  for (let id = 1n; id < next; id++) ids.push(id)

  const states = await Promise.all(
    ids.map((id) =>
      Promise.all([
        client.readContract({ address: contract, abi: prooflineAbi, functionName: 'getCampaign', args: [id], blockNumber: head }),
        client.readContract({ address: contract, abi: prooflineAbi, functionName: 'remaining', args: [id], blockNumber: head }),
      ]),
    ),
  )

  // Oldest first, so each search starts at the previous campaign's creation block.
  const campaigns: Campaign[] = []
  let lowerBound = PROOFLINE_DEPLOY_BLOCK
  for (const [index, id] of ids.entries()) {
    const [state, remaining] = states[index]
    const m = await loadMeta(client, contract, id, lowerBound, head)
    lowerBound = BigInt(m.createdBlock)
    const meta: CampaignMeta = {
      id,
      brand: m.brand,
      brandName: m.brandName,
      title: m.title,
      brief: m.brief,
      requiredTag: m.requiredTag,
      link: m.link,
      startsAt: BigInt(state.startsAt),
      endsAt: BigInt(state.endsAt),
      minViews: state.minViews,
      bonusBps: state.bonusBps,
      cpmUsdc6: BigInt(state.cpmUsdc6),
      maxPerPost: BigInt(state.maxPerPost),
      maxPerCreator: BigInt(state.maxPerCreator),
      requireProofCode: state.requireProofCode,
      deposit: BigInt(m.deposit),
      txHash: m.txHash,
      createdBlock: lowerBound,
    }
    const live = { status: state.status, remaining }
    campaigns.push({ ...meta, ...live, deposited: state.deposited, paid: state.paid, withdrawn: state.withdrawn, phase: phaseOf({ ...meta, ...live }, nowSec) })
  }
  return campaigns.sort((a, b) => (a.id < b.id ? 1 : -1))
}

type StoredRewards = { block: string; paid: string; items: Array<Omit<Reward, 'campaignId' | 'uniqueViews' | 'completions' | 'amount' | 'blockNumber'> & { uniqueViews: string; completions: string; amount: string; blockNumber: string }> }

const toReward = (campaignId: bigint, l: RewardLog): Reward => ({ ...l.args, campaignId, blockNumber: l.blockNumber, txHash: l.transactionHash })

/** Every paid post, newest first. Each campaign is scanned only from where the last read stopped. */
export async function fetchRewards(client: PublicClient, campaigns: Campaign[]): Promise<Reward[]> {
  const contract = PROOFLINE_CONTRACT
  if (!contract) return []
  const head = await client.getBlockNumber()
  const perCampaign = await Promise.all(
    campaigns.map(async (c): Promise<Reward[]> => {
      const key = `proofline:v2:${contract}:rewards:${c.id}`
      const raw = browserStore.get(key)
      const saved: StoredRewards | null = raw ? (JSON.parse(raw) as StoredRewards) : null
      const known: Reward[] = (saved?.items ?? []).map((i) => ({
        ...i,
        campaignId: c.id,
        uniqueViews: BigInt(i.uniqueViews),
        completions: BigInt(i.completions),
        amount: BigInt(i.amount),
        blockNumber: BigInt(i.blockNumber),
      }))
      // Before the first scan the campaign had paid nothing, one block before it was created.
      const from = saved ? { block: BigInt(saved.block), paid: BigInt(saved.paid) } : { block: c.createdBlock - 1n, paid: 0n }
      const to = await scanPoint(client, contract, c.id, head)
      const fresh = (await rewardsBetween(client, contract, c.id, from, to)).map((l) => toReward(c.id, l))
      const all = [...known, ...fresh]
      const store: StoredRewards = {
        block: head.toString(),
        paid: to.paid.toString(),
        items: all.map((r) => ({ ...r, uniqueViews: r.uniqueViews.toString(), completions: r.completions.toString(), amount: r.amount.toString(), blockNumber: r.blockNumber.toString() })),
      }
      browserStore.set(key, JSON.stringify(store))
      return all
    }),
  )
  return perCampaign.flat().sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1))
}
