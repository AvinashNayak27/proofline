import {
  bytesToHex,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
} from '@chainlink/cre-sdk'
import { decodeFunctionResult, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from 'viem'
import type { Config } from './config'

const receiverReadAbi = parseAbi(['function claimedUser(bytes32 userCommitment) view returns (bool)'])

/** ABI-encodes `claimedUser(userCommitment)`. Exposed so tests can pin the exact call data. */
export function encodeClaimedUserCall(userCommitment: Hex): Hex {
  return encodeFunctionData({ abi: receiverReadAbi, functionName: 'claimedUser', args: [userCommitment] })
}

/** Decodes the `claimedUser` return value. Throws on anything that is not a single ABI bool. */
export function decodeClaimedUserResult(data: Hex): boolean {
  return decodeFunctionResult({ abi: receiverReadAbi, functionName: 'claimedUser', data })
}

/**
 * Preflight read of the receiver's per-user flag, at the latest finalized block.
 * A read failure throws, so the workflow never writes on an unverified "unclaimed".
 *
 * This is an optimization only: it rejects known duplicates early and saves the report delivery.
 * The receiver's own `UserAlreadyClaimed` check stays the definitive guard for races (two requests
 * between this read and the write), retries, and any report that bypasses this workflow.
 */
export function isUserAlreadyClaimed(runtime: Runtime<Config>, receiver: Address, userCommitment: Hex): boolean {
  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: runtime.config.chainSelectorName })
  if (!network) throw new Error('unknown chain selector name')
  const client = new EVMClient(network.chainSelector.selector)
  const reply = client
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: receiver, data: encodeClaimedUserCall(userCommitment) }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()
  return decodeClaimedUserResult(bytesToHex(reply.data))
}
