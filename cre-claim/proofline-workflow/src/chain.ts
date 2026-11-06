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

export const readAbi = parseAbi([
  'function getCampaign(uint256 id) view returns ((address brand, uint64 startsAt, uint64 endsAt, uint32 minViews, uint16 bonusBps, uint8 status, uint96 cpmUsdc6, uint96 maxPerPost, uint96 maxPerCreator, uint128 deposited, uint128 paid, uint128 withdrawn))',
  'function postRewarded(bytes32 postKey) view returns (bool)',
  'function creatorPaid(uint256 campaignId, bytes32 creatorCommitment) view returns (uint256)',
  'function previewPayout(uint256 id, bytes32 creatorCommitment, uint256 uniqueViews, uint256 completions) view returns (uint256)',
])

/** Campaign status values in the contract's enum. */
export const STATUS_ACTIVE = 1

export type CampaignState = {
  brand: Address
  startsAt: bigint
  endsAt: bigint
  minViews: number
  bonusBps: number
  status: number
  cpmUsdc6: bigint
  maxPerPost: bigint
  maxPerCreator: bigint
  deposited: bigint
  paid: bigint
  withdrawn: bigint
}

type Fn = 'getCampaign' | 'postRewarded' | 'creatorPaid' | 'previewPayout'

function start(runtime: Runtime<Config>, receiver: Address, functionName: Fn, args: readonly unknown[]) {
  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: runtime.config.chainSelectorName })
  if (!network) throw new Error('unknown chain selector name')
  const data = encodeFunctionData({ abi: readAbi, functionName, args } as never)
  return new EVMClient(network.chainSelector.selector).callContract(runtime, {
    call: encodeCallMsg({ from: zeroAddress, to: receiver, data }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  })
}

type Pending = ReturnType<typeof start>

function finish(pending: Pending, functionName: Fn): unknown {
  const reply = pending.result()
  return decodeFunctionResult({ abi: readAbi, functionName, data: bytesToHex(reply.data) } as never)
}

export const startCampaignRead = (rt: Runtime<Config>, receiver: Address, id: bigint) => start(rt, receiver, 'getCampaign', [id])
export const startPostRewardedRead = (rt: Runtime<Config>, receiver: Address, key: Hex) => start(rt, receiver, 'postRewarded', [key])
export const startCreatorPaidRead = (rt: Runtime<Config>, receiver: Address, id: bigint, commitment: Hex) =>
  start(rt, receiver, 'creatorPaid', [id, commitment])
export const startPreviewPayoutRead = (rt: Runtime<Config>, receiver: Address, id: bigint, commitment: Hex, views: number, completions: number) =>
  start(rt, receiver, 'previewPayout', [id, commitment, BigInt(views), BigInt(completions)])

export function readCampaign(pending: Pending): CampaignState {
  return finish(pending, 'getCampaign') as CampaignState
}
export const readBool = (pending: Pending): boolean => finish(pending, 'postRewarded') as boolean
export const readUint = (pending: Pending): bigint => finish(pending, 'creatorPaid') as bigint
export const readPayout = (pending: Pending): bigint => finish(pending, 'previewPayout') as bigint
