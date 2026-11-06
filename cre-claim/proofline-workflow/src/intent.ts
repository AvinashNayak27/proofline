import {
  bytesToHex,
  encodeAbiParameters,
  hashTypedData,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'

export const APPLICATION = 'proofline-v1'
export const CHAIN_ID = 5042002
export const DOMAIN = { name: 'Proofline Claim', version: '1', chainId: CHAIN_ID } as const
export const TYPES = {
  ClaimIntent: [
    { name: 'application', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'campaignId', type: 'uint256' },
    { name: 'postId', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'creatorCommitment', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const

export type Claim = {
  campaignId: bigint
  postId: string
  handle: string
  wallet: Address
  creatorCommitment: Hex
  nonce: Hex
  expiry: bigint
  signature: Hex
  encryptedSessionMaterial: Hex
  /** Display tag the post must contain, or empty. Filled in by the Proofline server from the campaign's creation event. */
  requiredTag: string
}

const FIELDS = [
  'campaignId',
  'postUrl',
  'wallet',
  'creatorCommitment',
  'nonce',
  'expiry',
  'signature',
  'encryptedSessionMaterial',
  'requiredTag',
]
const POST_URL = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})\/?$/
const TAG = /^[\x21-\x7e]{0,32}$/

/** Strictly validates the HTTP trigger body. Never echoes any input value. */
export function parseClaim(raw: unknown): Claim | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const x = raw as Record<string, unknown>
  const keys = Object.keys(x)
  if (keys.length !== FIELDS.length || !keys.every((k) => FIELDS.includes(k))) return
  if (typeof x.campaignId !== 'string' || !/^[1-9][0-9]{0,17}$/.test(x.campaignId)) return
  if (typeof x.postUrl !== 'string') return
  const post = POST_URL.exec(x.postUrl)
  if (!post) return
  if (typeof x.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(x.wallet)) return
  if (typeof x.creatorCommitment !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(x.creatorCommitment)) return
  if (/^0x0{64}$/.test(x.creatorCommitment)) return
  if (typeof x.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(x.nonce)) return
  if (typeof x.expiry !== 'string' || !/^[1-9][0-9]{0,11}$/.test(x.expiry)) return
  if (typeof x.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(x.signature)) return
  if (typeof x.requiredTag !== 'string' || !TAG.test(x.requiredTag)) return
  const env = x.encryptedSessionMaterial
  if (typeof env !== 'string' || env.length > 32768 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(env)) return
  return {
    campaignId: BigInt(x.campaignId),
    postId: post[2],
    handle: post[1],
    wallet: x.wallet as Address,
    creatorCommitment: x.creatorCommitment as Hex,
    nonce: x.nonce as Hex,
    expiry: BigInt(x.expiry),
    signature: x.signature as Hex,
    encryptedSessionMaterial: env as Hex,
    requiredTag: x.requiredTag,
  }
}

export const typedData = (c: Pick<Claim, 'campaignId' | 'postId' | 'wallet' | 'creatorCommitment' | 'nonce' | 'expiry'>) => ({
  domain: DOMAIN,
  types: TYPES,
  primaryType: 'ClaimIntent' as const,
  message: {
    application: APPLICATION,
    chainId: BigInt(CHAIN_ID),
    campaignId: c.campaignId,
    postId: c.postId,
    wallet: c.wallet,
    creatorCommitment: c.creatorCommitment,
    nonce: c.nonce,
    expiry: c.expiry,
  },
})

export function verify(c: Claim): boolean {
  const signer = recoverSigner(hashTypedData(typedData(c)), c.signature)
  return signer?.toLowerCase() === c.wallet.toLowerCase()
}

/** Globally unique, opaque key for a post: one tweet pays at most once across every campaign. */
export function postKey(postId: string): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('string tag, string postId'), ['proofline-post-v1', postId]))
}

/** Synchronous secp256k1 recovery (viem's own recover helpers are async, which QuickJS cannot await). */
export function recoverSigner(digest: Hex, signature: Hex): Address | undefined {
  try {
    const bytes = hexToBytes(signature)
    const v = bytes[64]
    const recovery = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : -1
    if (recovery < 0) return
    const sig = secp256k1.Signature.fromCompact(bytesToHex(bytes.slice(0, 64)).slice(2)).addRecoveryBit(recovery)
    const pub = sig.recoverPublicKey(digest.slice(2)).toRawBytes(false)
    return `0x${keccak256(bytesToHex(pub.slice(1))).slice(-40)}` as Address
  } catch {
    return
  }
}
