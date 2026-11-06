import { secp256k1 } from '@noble/curves/secp256k1'
import {
  concatHex,
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from 'viem'

export const REPORT_SCHEMA_VERSION = 3
/** keccak256("ProoflineCampaigns.Report.v3"), the domain tag the contract hashes into every digest. */
export const REPORT_TAG: Hex = keccak256(stringToHex('ProoflineCampaigns.Report.v3'))

export type RewardReport = {
  campaignId: bigint
  postKey: Hex
  creatorCommitment: Hex
  recipient: Address
  uniqueViews: bigint
  completions: bigint
  expiry: bigint
}

/** The 256-byte report body: abi.encode(uint8 version, uint256 campaignId, bytes32 postKey, bytes32 creatorCommitment, address recipient, uint256 views, uint256 completions, uint256 expiry). */
export function encodeRewardBody(r: RewardReport): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      'uint8 schemaVersion, uint256 campaignId, bytes32 postKey, bytes32 creatorCommitment, address recipient, uint256 uniqueViews, uint256 completions, uint256 expiry',
    ),
    [REPORT_SCHEMA_VERSION, r.campaignId, r.postKey, r.creatorCommitment, r.recipient, r.uniqueViews, r.completions, r.expiry],
  )
}

/** The digest the contract recovers the signer from: bound to this chain and this contract. */
export function reportDigest(chainId: number, contract: Address, body: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32 tag, uint256 chainId, address contract, bytes32 bodyHash'), [
      REPORT_TAG,
      BigInt(chainId),
      contract,
      keccak256(body),
    ]),
  )
}

/** Signs the body with the report-signer key and returns the exact 321-byte payload the contract accepts. */
export function signReport(body: Hex, chainId: number, contract: Address, signerPrivateKey: Hex): Hex {
  const digest = reportDigest(chainId, contract, body)
  const sig = secp256k1.sign(hexToBytes(digest), hexToBytes(signerPrivateKey))
  const r = toHex(sig.r, { size: 32 })
  const s = toHex(sig.s, { size: 32 })
  const v = toHex(27 + (sig.recovery ?? 0), { size: 1 })
  return concatHex([body, r, s, v])
}
