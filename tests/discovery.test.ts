import { describe, expect, test } from 'bun:test'
import type { Address, PublicClient } from 'viem'
import { findCreationBlock, nextCampaignId, rewardsBetween, scanPoint } from '../src/lib/proofline/discovery'

const CONTRACT = '0x433920fdc403317005eb8c5dcf9a43a153243528' as Address

/** A chain in memory: campaign creation blocks and reward events, queried the way the real client is. */
function fakeChain(created: Record<string, bigint>, rewards: Array<{ campaignId: bigint; block: bigint; amount: bigint }>) {
  const calls = { reads: 0, logs: [] as Array<[bigint, bigint]> }
  const client = {
    async readContract({ functionName, args, blockNumber }: { functionName: string; args?: bigint[]; blockNumber?: bigint }) {
      calls.reads++
      const at = blockNumber ?? 1_000_000n
      if (functionName === 'nextCampaignId') return 1n + BigInt(Object.values(created).filter((b) => b <= at).length)
      if (functionName === 'getCampaign') {
        const id = (args as bigint[])[0]
        if (created[String(id)] === undefined || created[String(id)] > at) throw new Error('CampaignNotFound')
        const paid = rewards.filter((r) => r.campaignId === id && r.block <= at).reduce((sum, r) => sum + r.amount, 0n)
        return { paid }
      }
      throw new Error(`unexpected ${functionName}`)
    },
    async getLogs({ fromBlock, toBlock, args }: { fromBlock: bigint; toBlock: bigint; args: { campaignId: bigint } }) {
      calls.logs.push([fromBlock, toBlock])
      if (toBlock - fromBlock > 5_000n) throw new Error('requested range too large')
      return rewards.filter((r) => r.campaignId === args.campaignId && r.block >= fromBlock && r.block <= toBlock).map((r) => ({ blockNumber: r.block, args: r }))
    },
  } as unknown as PublicClient
  return { client, calls }
}

describe('campaign discovery', () => {
  const created = { '1': 71_078_100n, '2': 71_300_000n, '3': 71_300_001n }
  const chain = () => fakeChain(created, [])

  test('reads the campaign counter', async () => {
    expect(await nextCampaignId(chain().client, CONTRACT, 71_448_000n)).toBe(4n)
    expect(await nextCampaignId(chain().client, CONTRACT, 71_078_000n)).toBe(1n)
  })

  test('bisects to the exact creation block in a few reads', async () => {
    for (const [id, block] of Object.entries(created)) {
      const { client, calls } = chain()
      expect(await findCreationBlock(client, CONTRACT, BigInt(id), 71_078_006n, 71_448_406n)).toBe(block)
      expect(calls.reads).toBeLessThan(25)
    }
  })

  test('a campaign that does not exist yet is an error, not a scan', async () => {
    await expect(findCreationBlock(chain().client, CONTRACT, 9n, 71_078_006n, 71_448_406n)).rejects.toThrow('campaign not found')
  })
})

describe('reward discovery', () => {
  const rewards = [
    { campaignId: 1n, block: 71_100_000n, amount: 1_000_000n },
    { campaignId: 1n, block: 71_100_003n, amount: 250_000n },
    { campaignId: 1n, block: 71_400_000n, amount: 500_000n },
    { campaignId: 2n, block: 71_350_000n, amount: 750_000n },
  ]
  const world = () => fakeChain({ '1': 71_078_100n, '2': 71_300_000n }, rewards)

  test('finds every reward of a campaign without reading a wide log range', async () => {
    const { client, calls } = world()
    const head = await scanPoint(client, CONTRACT, 1n, 71_448_406n)
    const found = await rewardsBetween(client, CONTRACT, 1n, { block: 71_078_099n, paid: 0n }, head)
    expect(found.map((l) => l.blockNumber)).toEqual([71_100_000n, 71_100_003n, 71_400_000n])
    expect(calls.logs.every(([from, to]) => to - from <= 500n)).toBe(true)
  })

  test('another campaign never sees these rewards', async () => {
    const { client } = world()
    const head = await scanPoint(client, CONTRACT, 2n, 71_448_406n)
    const found = await rewardsBetween(client, CONTRACT, 2n, { block: 71_299_999n, paid: 0n }, head)
    expect(found.map((l) => l.blockNumber)).toEqual([71_350_000n])
  })

  test('an unchanged total reads no logs at all', async () => {
    const { client, calls } = world()
    const head = await scanPoint(client, CONTRACT, 1n, 71_448_406n)
    expect(await rewardsBetween(client, CONTRACT, 1n, { block: 71_448_000n, paid: head.paid }, head)).toEqual([])
    expect(calls.logs.length).toBe(0)
  })

  test('resuming from a saved point only reads what is new', async () => {
    const { client } = world()
    const head = await scanPoint(client, CONTRACT, 1n, 71_448_406n)
    const saved = await scanPoint(client, CONTRACT, 1n, 71_200_000n)
    const found = await rewardsBetween(client, CONTRACT, 1n, saved, head)
    expect(found.map((l) => l.blockNumber)).toEqual([71_400_000n])
  })
})
