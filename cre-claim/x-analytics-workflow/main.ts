import { bytesToHex, decodeJson, EVMClient, getNetwork, handlerInTee, HTTPCapability, prepareReportRequest, Runner, TxStatus, type HTTPPayload, type TeeRuntime } from '@chainlink/cre-sdk'
import type { Address, Hex } from 'viem'
import { configSchema, type Config } from './src/config'
import { parseClaim, verify, claimId, postCommitment, encodeClaimReport } from './src/intent'
import { open } from './src/session'
import { validateCapture, replay } from './src/analytics'
import { isUserAlreadyClaimed } from './src/preflight'
const reply = (x: Record<string,string>) => JSON.stringify(x)
const reject = (reason:string) => reply({status:'rejected',reason})
export const onClaim = (enclave: TeeRuntime<Config>, payload: HTTPPayload): string => {
  let raw: unknown
  try { raw = decodeJson(payload.input) } catch { return reject('invalid_request') }
  const req = parseClaim(raw); if (!req) return reject('invalid_request')
  const now = BigInt(Math.floor(enclave.now().getTime()/1000))
  if (req.expiry <= now || req.expiry > now + BigInt(enclave.config.maxIntentTtlSeconds)) return reject('intent_expired')
  if (!verify(req)) return reject('bad_signature')
  const secret = enclave.getSecret({id:'ENCLAVE_PRIVATE_KEY'}).result().value as Hex
  const decrypted = open(req.encryptedSessionMaterial,secret,req)
  const capture = validateCapture(decrypted,req.postId)
  if (!capture) return reject('session_unreadable')
  const metrics = replay(enclave,capture,req.postId)
  if (typeof metrics === 'string') return reject(metrics)
  if (metrics.amountUsdc6 === 0n) return reject('no_completions')
  if (metrics.amountUsdc6 > BigInt(enclave.config.maxClaimAmountUsdc6)) return reject('amount_over_cap')
  const receiver = (enclave.config.mode === 'production' ? enclave.config.receiver : '0x0000000000000000000000000000000000000000') as Address
  const cid = claimId(receiver,req)
  const summary = { claimId:cid, postId:req.postId, uniqueViews:String(metrics.uniqueViews), completions:String(metrics.completions), amountUsdc6:String(metrics.amountUsdc6), wallet:req.wallet }
  if (enclave.config.mode === 'local-simulation') return reply({status:'verified',mode:'local-simulation',...summary})
  const don = enclave.usingTheDons()
  const commitment = postCommitment(req.postId)
  if (isUserAlreadyClaimed(don,enclave.config.receiver as Address,commitment)) return reject('already_claimed')
  const network = getNetwork({chainFamily:'evm',chainSelectorName:enclave.config.chainSelectorName})
  if (!network) throw new Error('unknown chain')
  const report = don.report(prepareReportRequest(encodeClaimReport(cid,commitment,req.wallet,metrics.amountUsdc6,req.expiry))).result()
  const result = new EVMClient(network.chainSelector.selector).writeReport(don,{receiver:enclave.config.receiver,report,gasConfig:{gasLimit:enclave.config.gasLimit}}).result()
  if (result.txStatus !== TxStatus.SUCCESS || !result.txHash) throw new Error('report delivery failed')
  if (result.receiverContractExecutionStatus === 1) return reject('delivery_reverted')
  return reply({status:'submitted',mode:'production',txHash:bytesToHex(result.txHash),...summary})
}
export const initWorkflow = (config:Config) => {
  const keys = config.authorizedKeys.map(publicKey => ({type:'KEY_TYPE_ECDSA_EVM' as const,publicKey}))
  return [handlerInTee(new HTTPCapability().trigger(keys.length ? {authorizedKeys:keys} : {}),onClaim,[{tee:'nitro',regions:['us-west-2']}])]
}
export async function main() { const runner = await Runner.newRunner<Config>({configSchema}); await runner.run(initWorkflow) }
