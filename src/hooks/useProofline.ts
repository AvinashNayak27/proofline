import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { Address, PublicClient } from 'viem'
import { useReadContracts, usePublicClient } from 'wagmi'
import { prooflineAbi } from '@/lib/proofline/abi'
import { CHAIN_ID, PROOFLINE_CONTRACT } from '@/lib/proofline/config'
import { fetchCampaigns, fetchRewards, type Campaign, type Reward } from '@/lib/proofline/events'

const FRESH_MS = 15_000

export function useCampaigns() {
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient | undefined
  return useQuery<Campaign[]>({
    queryKey: ['proofline', 'campaigns'],
    enabled: Boolean(client && PROOFLINE_CONTRACT),
    queryFn: () => fetchCampaigns(client as PublicClient, Math.floor(Date.now() / 1000)),
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
  const client = usePublicClient({ chainId: CHAIN_ID }) as PublicClient | undefined
  return useQuery<Reward[]>({
    queryKey: ['proofline', 'rewards'],
    enabled: Boolean(client && PROOFLINE_CONTRACT),
    queryFn: () => fetchRewards(client as PublicClient),
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
