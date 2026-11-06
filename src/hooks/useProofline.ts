import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { Address, PublicClient } from 'viem'
import { useReadContracts, usePublicClient } from 'wagmi'
import { prooflineAbi } from '@/lib/proofline/abi'
import { CHAIN_ID, PROOFLINE_CONTRACT } from '@/lib/proofline/config'
import { phaseOf, type Campaign, type Reward } from '@/lib/proofline/events'

const FRESH_MS = 15_000

export function useCampaigns() {
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient | undefined
  return useQuery<Campaign[]>({
    queryKey: ['proofline', 'campaigns'],
    enabled: Boolean(client && PROOFLINE_CONTRACT),
    queryFn: async () => {
      const res = await fetch('/api/campaigns', { cache: 'no-store' })
      if (!res.ok) throw new Error('campaign lookup failed')
      const body = (await res.json()) as { campaigns?: Array<Record<string, unknown>> }
      if (!Array.isArray(body.campaigns)) throw new Error('invalid campaign response')
      const chain = client as PublicClient
      return Promise.all(body.campaigns.map(async (item): Promise<Campaign> => {
        const id = BigInt(String(item.id))
        const [state, remaining] = await Promise.all([
          chain.readContract({ address: PROOFLINE_CONTRACT as Address, abi: prooflineAbi, functionName: 'getCampaign', args: [id] }),
          chain.readContract({ address: PROOFLINE_CONTRACT as Address, abi: prooflineAbi, functionName: 'remaining', args: [id] }),
        ])
        const meta = {
          id, brand: String(item.brand) as Address, brandName: String(item.brandName), title: String(item.title), brief: String(item.brief),
          requiredTag: String(item.requiredTag), link: String(item.link), startsAt: BigInt(String(item.startsAt)), endsAt: BigInt(String(item.endsAt)),
          minViews: Number(item.minViews), bonusBps: Number(item.bonusBps), cpmUsdc6: BigInt(String(item.cpmUsdc6)),
          maxPerPost: BigInt(String(item.maxPerPost)), maxPerCreator: BigInt(String(item.maxPerCreator)), requireProofCode: Boolean(item.requireProofCode),
          deposit: BigInt(String(item.deposit)), txHash: String(item.createdTx) as `0x${string}`, createdBlock: BigInt(String(item.createdBlock)),
        }
        const live = { status: state.status, remaining }
        return { ...meta, ...live, deposited: state.deposited, paid: state.paid, withdrawn: state.withdrawn, phase: phaseOf({ ...meta, ...live }, Math.floor(Date.now() / 1000)) }
      }))
    },
    staleTime: FRESH_MS,
    refetchInterval: 30_000,
  })
}

export function useCampaign(id: bigint | null) {
  const query = useCampaigns()
  const campaign = id === null ? undefined : query.data?.find((c) => c.id === id)
  return { ...query, campaign }
}

export function useRewards() {
  return useQuery<Reward[]>({
    queryKey: ['proofline', 'rewards'],
    enabled: Boolean(PROOFLINE_CONTRACT),
    queryFn: async () => {
      const res = await fetch('/api/rewards', { cache: 'no-store' })
      if (!res.ok) throw new Error('reward lookup failed')
      const body = (await res.json()) as { rewards?: Array<Record<string, unknown>> }
      if (!Array.isArray(body.rewards)) throw new Error('invalid reward response')
      return body.rewards.map(toReward)
    },
    placeholderData: keepPreviousData,
    staleTime: FRESH_MS,
    refetchInterval: 30_000,
  })
}

const toReward = (item: Record<string, unknown>): Reward => ({
  campaignId: BigInt(String(item.campaignId)), postKey: String(item.postKey) as `0x${string}`,
  creatorCommitment: String(item.creatorCommitment) as `0x${string}`, recipient: String(item.recipient) as Address,
  uniqueViews: BigInt(String(item.uniqueViews)), completions: BigInt(String(item.completions)), amount: BigInt(String(item.amount)),
  blockNumber: BigInt(String(item.blockNumber)), txHash: String(item.txHash) as `0x${string}`,
})

export function useWalletRewards(address: Address | undefined) {
  return useQuery<Reward[]>({
    queryKey: ['proofline', 'wallet-rewards', address?.toLowerCase() ?? ''],
    enabled: Boolean(address),
    queryFn: async () => {
      const res = await fetch(`/api/rewards?recipient=${encodeURIComponent(address as string)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('reward lookup failed')
      const body = (await res.json()) as { rewards?: Array<Record<string, unknown>> }
      if (!Array.isArray(body.rewards)) throw new Error('invalid reward response')
      return body.rewards.map(toReward)
    },
    staleTime: FRESH_MS,
    refetchInterval: 30_000,
  })
}

/** Call after a transaction confirms so every list and total re-reads the chain. */
export function useRefreshProofline() {
  const queryClient = useQueryClient()
  return useCallback(() => queryClient.invalidateQueries({ queryKey: ['proofline'] }), [queryClient])
}

/** Contract-level configuration: who owns it and whether it is ready to hold campaigns. */
export function useContractStatus() {
  const contract = PROOFLINE_CONTRACT as Address
  const base = { address: contract, abi: prooflineAbi, chainId: CHAIN_ID } as const
  const result = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(PROOFLINE_CONTRACT), refetchInterval: 20_000 },
    contracts: [
      { ...base, functionName: 'owner' },
      { ...base, functionName: 'reportSigner' },
      { ...base, functionName: 'workflowIdentityLocked' },
      { ...base, functionName: 'allowAnyWorkflow' },
      { ...base, functionName: 'paused' },
    ],
  })
  const data = result.data
  return {
    ...result,
    status: data
      ? { owner: data[0], reportSigner: data[1], locked: data[2], simulation: data[3], paused: data[4] }
      : undefined,
  }
}
