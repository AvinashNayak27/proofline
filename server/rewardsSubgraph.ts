import { isAddress, type Address, type Hex } from 'viem'

export type WalletReward = {
  campaignId: string
  postKey: Hex
  creatorCommitment: Hex
  recipient: Address
  uniqueViews: string
  completions: string
  amount: string
  blockNumber: string
  txHash: Hex
}

export type SubgraphCampaign = {
  id: string
  brand: Address
  brandName: string
  title: string
  brief: string
  requiredTag: string
  link: string
  startsAt: string
  endsAt: string
  minViews: string
  bonusBps: string
  cpmUsdc6: string
  maxPerPost: string
  maxPerCreator: string
  requireProofCode: boolean
  deposit: string
  createdBlock: string
  createdTx: Hex
}

const QUERY = `
  query RewardsForWallet($wallet: Bytes!) {
    wallet(id: $wallet) {
      rewards(orderBy: blockNumber, orderDirection: desc) {
        campaignId
        postKey
        creatorCommitment
        recipient
        uniqueViews
        completions
        amount
        blockNumber
        txHash
      }
    }
  }
`

const ALL_REWARDS_QUERY = `
  query AllRewards {
    rewards(first: 1000, orderBy: blockNumber, orderDirection: desc) {
      campaignId postKey creatorCommitment recipient uniqueViews completions amount blockNumber txHash
    }
  }
`

const CAMPAIGNS_QUERY = `
  query Campaigns {
    campaigns(first: 1000, orderBy: id, orderDirection: desc) {
      id brand brandName title brief requiredTag link startsAt endsAt minViews bonusBps
      cpmUsdc6 maxPerPost maxPerCreator requireProofCode deposit createdBlock createdTx
    }
  }
`

async function querySubgraph<T>(query: string, variables: Record<string, string> = {}, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const endpoint = env.PROOFLINE_SUBGRAPH_URL
  if (!endpoint?.startsWith('https://')) throw new Error('subgraph is not configured')
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (env.GRAPH_API_KEY) headers.Authorization = `Bearer ${env.GRAPH_API_KEY}`
  const res = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify({ query, variables }), redirect: 'error', signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error('subgraph request failed')
  const body = (await res.json()) as { data?: T; errors?: unknown }
  if (body.errors || !body.data) throw new Error('subgraph query failed')
  return body.data
}

export async function rewardsForWallet(recipient: Address, env: NodeJS.ProcessEnv = process.env): Promise<WalletReward[]> {
  if (!isAddress(recipient)) throw new Error('invalid recipient')
  const data = await querySubgraph<{ wallet?: { rewards?: WalletReward[] } | null }>(QUERY, { wallet: recipient.toLowerCase() }, env)
  const rewards = data.wallet?.rewards ?? []
  if (!Array.isArray(rewards)) throw new Error('invalid subgraph response')
  return rewards
}

export async function allRewards(env: NodeJS.ProcessEnv = process.env): Promise<WalletReward[]> {
  const data = await querySubgraph<{ rewards?: WalletReward[] }>(ALL_REWARDS_QUERY, {}, env)
  if (!Array.isArray(data.rewards)) throw new Error('invalid subgraph response')
  return data.rewards
}

export async function allCampaigns(env: NodeJS.ProcessEnv = process.env): Promise<SubgraphCampaign[]> {
  const data = await querySubgraph<{ campaigns?: SubgraphCampaign[] }>(CAMPAIGNS_QUERY, {}, env)
  if (!Array.isArray(data.campaigns)) throw new Error('invalid subgraph response')
  return data.campaigns
}
