import { bytesToHex, encodeAbiParameters, hashTypedData, hexToBytes, keccak256, parseAbiParameters, type Address, type Hex } from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'

export const APPLICATION = 'x-analytics-arc-v1'
export const CHAIN_ID = 5042002
export const DOMAIN = { name: 'X Analytics Arc Claim', version: '1', chainId: CHAIN_ID } as const
export const TYPES = { ClaimIntent: [
  { name: 'application', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'postId', type: 'string' },
  { name: 'wallet', type: 'address' }, { name: 'nonce', type: 'bytes32' }, { name: 'expiry', type: 'uint256' },
] } as const
export type Claim = { postId: string; wallet: Address; nonce: Hex; expiry: bigint; signature: Hex; encryptedSessionMaterial: Hex }
const fields = ['postId','wallet','nonce','expiry','signature','encryptedSessionMaterial']
export function parseClaim(raw: unknown): Claim | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const x = raw as Record<string, unknown>
  if (Object.keys(x).length !== fields.length || !Object.keys(x).every(k => fields.includes(k))) return
  if (typeof x.postId !== 'string' || !/^\d{1,20}$/.test(x.postId) || typeof x.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(x.wallet) || typeof x.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(x.nonce) || typeof x.expiry !== 'string' || !/^[1-9][0-9]{0,11}$/.test(x.expiry) || typeof x.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(x.signature) || typeof x.encryptedSessionMaterial !== 'string' || x.encryptedSessionMaterial.length > 32768 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(x.encryptedSessionMaterial)) return
  return { postId:x.postId, wallet:x.wallet as Address, nonce:x.nonce as Hex, expiry:BigInt(x.expiry), signature:x.signature as Hex, encryptedSessionMaterial:x.encryptedSessionMaterial as Hex }
}
export const typedData = (c: Pick<Claim,'postId'|'wallet'|'nonce'|'expiry'>) => ({ domain:DOMAIN, types:TYPES, primaryType:'ClaimIntent' as const, message:{ application:APPLICATION, chainId:BigInt(CHAIN_ID), postId:c.postId, wallet:c.wallet, nonce:c.nonce, expiry:c.expiry } })
export function verify(c: Claim): boolean { const signer = recoverSigner(hashTypedData(typedData(c)), c.signature); return signer?.toLowerCase() === c.wallet.toLowerCase() }
export function claimId(receiver: Address, c: Claim): Hex { return keccak256(encodeAbiParameters(parseAbiParameters('string application, uint256 chainId, address receiver, string postId, address wallet, bytes32 nonce, uint256 expiry'),[APPLICATION,BigInt(CHAIN_ID),receiver,c.postId,c.wallet,c.nonce,c.expiry])) }
export function postCommitment(postId: string): Hex { return keccak256(encodeAbiParameters(parseAbiParameters('string application, string postId'),[APPLICATION,postId])) }

function recoverSigner(digest: Hex, signature: Hex): Address | undefined {
  try {
    const bytes = hexToBytes(signature); const v = bytes[64]
    const recovery = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : -1
    if (recovery < 0) return
    const sig = secp256k1.Signature.fromCompact(bytesToHex(bytes.slice(0,64)).slice(2)).addRecoveryBit(recovery)
    const pub = sig.recoverPublicKey(digest.slice(2)).toRawBytes(false)
    return `0x${keccak256(bytesToHex(pub.slice(1))).slice(-40)}` as Address
  } catch { return }
}
export function encodeClaimReport(id: Hex, commitment: Hex, wallet: Address, amount: bigint, expiry: bigint): Hex {
  return encodeAbiParameters(parseAbiParameters('uint8 schemaVersion, bytes32 claimId, bytes32 userCommitment, address recipient, uint256 amount, uint256 expiry'),[2,id,commitment,wallet,amount,expiry])
}
