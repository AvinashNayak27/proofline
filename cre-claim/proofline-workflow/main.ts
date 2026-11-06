import {
  bytesToHex,
  decodeJson,
  EVMClient,
  getNetwork,
  handlerInTee,
  HTTPCapability,
  prepareReportRequest,
  Runner,
  TxStatus,
  type HTTPPayload,
  type TeeRuntime,
} from '@chainlink/cre-sdk'
import type { Address, Hex } from 'viem'
import { readMetrics, sendReplay, validateCapture } from './src/analytics'
import {
  readBool,
  readCampaign,
  readPayout,
  readUint,
  startCampaignRead,
  startCreatorPaidRead,
  startPostRewardedRead,
  startPreviewPayoutRead,
  STATUS_ACTIVE,
} from './src/chain'
import { configSchema, type Config } from './src/config'
import { CHAIN_ID, parseClaim, postKey, verify } from './src/intent'
import { encodeRewardBody, signReport } from './src/report'
import { open } from './src/session'
import { readTweet, sendTweetLookup } from './src/tweet'

// Replies are coarse, fixed-vocabulary JSON. They never carry the X session, headers, post text or
// any other captured value.
const reply = (x: Record<string, string>) => JSON.stringify(x)
const reject = (reason: string) => reply({ status: 'rejected', reason })

/** CRE secret ids (and env var names in simulation). Values never appear in code, config or logs. */
export const ENCLAVE_KEY_SECRET = 'ENCLAVE_PRIVATE_KEY'
export const REPORT_SIGNER_SECRET = 'REPORT_SIGNER_PRIVATE_KEY'

/**
 * Runs inside the enclave. A creator submits a post for a campaign; the enclave decrypts their X
 * session request, replays it to read the post's analytics, confirms the post carries their Proofline
 * code, and signs a report of the MEASUREMENTS (views and completions). The ProoflineCampaigns
 * contract computes the reward from the campaign's own rules, so the workflow never sets an amount.
 */
export const onClaim = (enclave: TeeRuntime<Config>, payload: HTTPPayload): string => {
  const cfg = enclave.config
  let raw: unknown
  try {
    raw = decodeJson(payload.input)
  } catch {
    return reject('invalid_request')
  }
  const claim = parseClaim(raw)
  if (!claim) return reject('invalid_request')

  const now = BigInt(Math.floor(enclave.now().getTime() / 1000))
  if (claim.expiry <= now || claim.expiry > now + BigInt(cfg.maxIntentTtlSeconds)) return reject('intent_expired')
  if (!verify(claim)) return reject('bad_signature')

  // Public chain data is read through the DON runtime. Nothing secret is passed to it.
  const don = enclave.usingTheDons()
  const key = postKey(claim.postId)
  const receiver = (cfg.mode === 'production' ? cfg.receiver : undefined) as Address | undefined
  let campaign: ReturnType<typeof readCampaign> | undefined
  if (receiver) {
    const campaignRead = startCampaignRead(don, receiver, claim.campaignId)
    const rewardedRead = startPostRewardedRead(don, receiver, key)
    try {
      campaign = readCampaign(campaignRead)
    } catch {
      return reject('campaign_not_found')
    }
    if (campaign.status !== STATUS_ACTIVE) return reject('campaign_inactive')
    if (now < campaign.startsAt || now >= campaign.endsAt) return reject('campaign_not_open')
    if (readBool(rewardedRead)) return reject('already_claimed')
  }

  const enclaveKey = enclave.getSecret({ id: ENCLAVE_KEY_SECRET }).result().value as Hex
  const capture = validateCapture(open(claim.encryptedSessionMaterial, enclaveKey, claim), claim.postId)
  if (!capture) return reject('session_unreadable')

  // Both lookups are independent: start them together, then read.
  const analyticsRead = sendReplay(enclave, capture)
  const tweetRead = sendTweetLookup(enclave, claim.postId)
  const metrics = readMetrics(analyticsRead, claim.postId)
  if (typeof metrics === 'string') return reject(metrics)
  const tweet = readTweet(tweetRead, {
    postId: claim.postId,
    handle: claim.handle,
    campaignId: claim.campaignId,
    wallet: claim.wallet,
    requiredTag: claim.requiredTag,
  })
  if (tweet !== 'ok') return reject(tweet)

  const summary = {
    campaignId: String(claim.campaignId),
    postId: claim.postId,
    wallet: claim.wallet,
    uniqueViews: String(metrics.uniqueViews),
    completions: String(metrics.completions),
  }
  if (!receiver || !campaign) return reply({ status: 'verified', mode: 'local-simulation', ...summary })

  if (metrics.uniqueViews < campaign.minViews) return reject('below_min_views')
  const paidRead = startCreatorPaidRead(don, receiver, claim.campaignId, claim.creatorCommitment)
  const payoutRead = startPreviewPayoutRead(don, receiver, claim.campaignId, claim.creatorCommitment, metrics.uniqueViews, metrics.completions)
  const creatorPaid = readUint(paidRead)
  const payout = readPayout(payoutRead)
  if (payout === 0n) {
    if (creatorPaid >= campaign.maxPerCreator) return reject('creator_cap_reached')
    if (campaign.deposited - campaign.paid - campaign.withdrawn === 0n) return reject('budget_exhausted')
    return reject('nothing_to_pay')
  }

  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: cfg.chainSelectorName })
  if (!network) throw new Error('unknown chain selector name')
  const signerKey = enclave.getSecret({ id: REPORT_SIGNER_SECRET }).result().value as Hex
  if (!/^0x[0-9a-fA-F]{64}$/.test(signerKey)) throw new Error('report signer key is not configured')
  const body = encodeRewardBody({
    campaignId: claim.campaignId,
    postKey: key,
    creatorCommitment: claim.creatorCommitment,
    recipient: claim.wallet,
    uniqueViews: BigInt(metrics.uniqueViews),
    completions: BigInt(metrics.completions),
    expiry: claim.expiry,
  })
  const signed = signReport(body, CHAIN_ID, receiver, signerKey)
  const report = don.report(prepareReportRequest(signed)).result()
  const result = new EVMClient(network.chainSelector.selector)
    .writeReport(don, { receiver, report, gasConfig: { gasLimit: (cfg as Extract<Config, { mode: 'production' }>).gasLimit } })
    .result()
  if (result.txStatus !== TxStatus.SUCCESS || !result.txHash) throw new Error('report delivery failed')
  // The forwarder transaction can succeed while the contract rejects the report. 1 = REVERTED.
  if (result.receiverContractExecutionStatus === 1) return reject('delivery_reverted')
  return reply({ status: 'submitted', mode: 'production', txHash: bytesToHex(result.txHash), amountUsdc6: String(payout), ...summary })
}

export const initWorkflow = (config: Config) => {
  const keys = config.authorizedKeys.map((publicKey) => ({ type: 'KEY_TYPE_ECDSA_EVM' as const, publicKey }))
  return [
    handlerInTee(new HTTPCapability().trigger(keys.length ? { authorizedKeys: keys } : {}), onClaim, [
      { tee: 'nitro', regions: ['us-west-2'] },
    ]),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
