import {
  bytesToHex,
  consensusIdenticalAggregation,
  decodeJson,
  EVMClient,
  getNetwork,
  handler,
  HTTPCapability,
  prepareReportRequest,
  Runner,
  TxStatus,
  type HTTPPayload,
  type Runtime,
} from '@chainlink/cre-sdk'
import type { Address } from 'viem'
import { configSchema, type Config } from './src/config'
import { checkIdentity } from './src/identity'
import {
  computeClaimId,
  encodeClaimReport,
  parseClaimRequest,
  computeUserCommitment,
  REPORT_SCHEMA_VERSION,
  verifyIntentSignature,
} from './src/intent'

// Outputs are coarse, fixed-vocabulary JSON. They never include the token, the username,
// the DummyJSON response, or any raw request value.
const reply = (body: Record<string, string>): string => JSON.stringify(body)
const reject = (reason: string): string => reply({ status: 'rejected', reason })

export const onClaim = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const config = runtime.config

  let raw: unknown
  try {
    raw = decodeJson(payload.input)
  } catch {
    return reject('invalid_request')
  }
  const parsed = parseClaimRequest(raw)
  if (!parsed.ok) return reject(parsed.reason)
  const req = parsed.value

  const nowSeconds = BigInt(Math.floor(runtime.now().getTime() / 1000))
  if (req.expiry <= nowSeconds) return reject('intent_expired')
  if (req.expiry > nowSeconds + BigInt(config.maxIntentTtlSeconds)) return reject('intent_expiry_too_far')

  if (!verifyIntentSignature(req)) return reject('bad_signature')
  runtime.log('claim intent signature verified')

  const verdict = runtime
    .runInNodeMode(checkIdentity, consensusIdenticalAggregation<string>())(req.accessToken)
    .result()
  if (verdict === 'rejected') {
    runtime.log('identity check did not pass')
    return reject('token_rejected')
  }
  if (verdict === 'invalid_weight') return reject('weight_invalid')
  const match = /^ok:([1-9][0-9]{0,15}):([1-9][0-9]{0,17})$/.exec(verdict)
  if (!match) return reject('identity_unreadable')
  const userId = BigInt(match[1])
  const amount = BigInt(match[2])
  if (amount > BigInt(config.maxClaimAmountUsdc6)) return reject('amount_over_cap')
  runtime.log('identity check passed')

  const receiver = (config.mode === 'production' ? config.receiver : '0x0000000000000000000000000000000000000000') as Address
  const claimId = computeClaimId(receiver, req.wallet, req.nonce, req.expiry)
  const userCommitment = computeUserCommitment(userId)
  const summary = {
    schemaVersion: String(REPORT_SCHEMA_VERSION),
    claimId,
    wallet: req.wallet,
    amountUsdc6: amount.toString(),
    expiry: req.expiry.toString(),
  }

  if (config.mode === 'local-simulation') {
    // Receiver-free branch: stops before report creation, EVM client construction or any write.
    runtime.log('local-simulation: verified, no report created and nothing written')
    return reply({ status: 'verified', mode: 'local-simulation', wouldWrite: 'true', ...summary })
  }

  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName })
  if (!network) throw new Error('unknown chain selector name')
  const client = new EVMClient(network.chainSelector.selector)

  const report = runtime.report(prepareReportRequest(encodeClaimReport(claimId, userCommitment, req.wallet, amount, req.expiry))).result()
  const result = client
    .writeReport(runtime, {
      receiver: config.receiver,
      report,
      gasConfig: { gasLimit: config.gasLimit },
    })
    .result()

  if (result.txStatus !== TxStatus.SUCCESS) throw new Error(`report delivery failed with status ${String(result.txStatus)}`)
  if (!result.txHash) throw new Error('report delivery succeeded without a transaction hash')
  // The forwarder transaction can succeed while the receiver rejects the report (for example when
  // this user was already paid). 1 = RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED.
  if (result.receiverContractExecutionStatus === 1) {
    runtime.log('receiver rejected the report')
    return reject('delivery_reverted')
  }
  runtime.log('claim report delivered')
  return reply({ status: 'submitted', mode: 'production', txHash: bytesToHex(result.txHash), ...summary })
}

export const initWorkflow = (config: Config) => {
  const authorizedKeys = config.authorizedKeys.map((publicKey) => ({
    type: 'KEY_TYPE_ECDSA_EVM' as const,
    publicKey,
  }))
  // Simulation accepts an empty config; a deployed workflow rejects triggers without authorized keys
  // (the production config schema already requires at least one).
  const trigger = new HTTPCapability().trigger(authorizedKeys.length > 0 ? { authorizedKeys } : {})
  return [handler(trigger, onClaim)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
