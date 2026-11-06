import { BigInt, Bytes } from '@graphprotocol/graph-ts'
import { CampaignCreated, PostRewarded } from '../generated/ProoflineCampaigns/ProoflineCampaigns'
import { Campaign, Creator, Reward, Wallet } from '../generated/schema'

const ZERO = BigInt.fromI32(0)
const ONE = BigInt.fromI32(1)

export function handleCampaignCreated(event: CampaignCreated): void {
  const campaign = new Campaign(event.params.id.toString())
  const data = event.params.data
  campaign.brand = event.params.brand
  campaign.brandName = data.brandName
  campaign.title = data.title
  campaign.brief = data.brief
  campaign.requiredTag = data.requiredTag
  campaign.link = data.link
  campaign.startsAt = data.startsAt
  campaign.endsAt = data.endsAt
  campaign.minViews = data.minViews
  campaign.bonusBps = BigInt.fromI32(data.bonusBps)
  campaign.cpmUsdc6 = data.cpmUsdc6
  campaign.maxPerPost = data.maxPerPost
  campaign.maxPerCreator = data.maxPerCreator
  campaign.requireProofCode = data.requireProofCode
  campaign.deposit = data.deposit
  campaign.createdAt = event.block.timestamp
  campaign.createdBlock = event.block.number
  campaign.createdTx = event.transaction.hash
  campaign.save()
}

export function handlePostRewarded(event: PostRewarded): void {
  const walletId = event.params.recipient as Bytes
  let wallet = Wallet.load(walletId)
  if (wallet === null) {
    wallet = new Wallet(walletId)
    wallet.totalEarned = ZERO
    wallet.rewardCount = ZERO
  }
  wallet.totalEarned = wallet.totalEarned.plus(event.params.amount)
  wallet.rewardCount = wallet.rewardCount.plus(ONE)
  wallet.save()

  const creatorId = event.params.creatorCommitment
  let creator = Creator.load(creatorId)
  if (creator === null) {
    creator = new Creator(creatorId)
    creator.totalEarned = ZERO
    creator.rewardCount = ZERO
  }
  creator.totalEarned = creator.totalEarned.plus(event.params.amount)
  creator.rewardCount = creator.rewardCount.plus(ONE)
  creator.save()

  const reward = new Reward(event.transaction.hash.concatI32(event.logIndex.toI32()))
  reward.campaign = event.params.campaignId.toString()
  reward.campaignId = event.params.campaignId
  reward.postKey = event.params.postKey
  reward.creator = creatorId
  reward.creatorCommitment = creatorId
  reward.wallet = walletId
  reward.recipient = walletId
  reward.uniqueViews = event.params.uniqueViews
  reward.completions = event.params.completions
  reward.amount = event.params.amount
  reward.blockNumber = event.block.number
  reward.timestamp = event.block.timestamp
  reward.txHash = event.transaction.hash
  reward.logIndex = event.logIndex
  reward.save()
}
