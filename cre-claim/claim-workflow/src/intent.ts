// Claim-intent primitives shared by the workflow handler and its tests.
// Everything here is synchronous and uses only QuickJS-safe packages (viem, @noble/curves).
// The browser app keeps a matching copy in src/lib/claimIntent.ts; the parity test in
// main.test.ts pins both to the same typed-data hash.
import { secp256k1 } from '@noble/curves/secp256k1'
import {
  encodeAbiParameters,
  hashTypedData,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  bytesToHex,
  type Address,
  type Hex,
} from 'viem'

export const APPLICATION = 'dummyjson-arc-claim-v1'
export const ARC_TESTNET_CHAIN_ID = 5042002
/** Report schema v2 carries a per-user commitment and a variable amount (weight / 100 USDC). */
export const REPORT_SCHEMA_VERSION = 2

export const CLAIM_DOMAIN = {
  name: 'DummyJSON Arc Claim',
  version: '1',
  chainId: ARC_TESTNET_CHAIN_ID,
} as const

export const CLAIM_TYPES = {
  ClaimIntent: [
    { name: 'application', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const

export type ClaimRequest = {
  accessToken: string
  wallet: Address
  nonce: Hex
  expiry: bigint
  signature: Hex
}

export type ParseResult =
  | { ok: true; value: ClaimRequest }
  | { ok: false; reason: 'invalid_request' }

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/
const EXPIRY_RE = /^[1-9][0-9]{0,11}$/
// JWT-shaped bearer token (three base64url segments). DummyJSON access tokens are JWTs.
const TOKEN_RE = /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{0,2048}$/
const ALLOWED_KEYS = ['accessToken', 'wallet', 'nonce', 'expiry', 'signature']

/** Strictly validates the HTTP trigger body. Never echoes any input value in its result. */
export function parseClaimRequest(raw: unknown): ParseResult {
  const bad: ParseResult = { ok: false, reason: 'invalid_request' }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad
  const body = raw as Record<string, unknown>
  const keys = Object.keys(body)
  if (keys.length !== ALLOWED_KEYS.length || !keys.every((k) => ALLOWED_KEYS.includes(k))) return bad

  const { accessToken, wallet, nonce, expiry, signature } = body
  if (typeof accessToken !== 'string' || !TOKEN_RE.test(accessToken)) return bad
  if (typeof wallet !== 'string' || !ADDRESS_RE.test(wallet)) return bad
  if (typeof nonce !== 'string' || !BYTES32_RE.test(nonce)) return bad
  if (typeof expiry !== 'string' || !EXPIRY_RE.test(expiry)) return bad
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) return bad

  return {
    ok: true,
    value: {
      accessToken,
      wallet: wallet as Address,
      nonce: nonce as Hex,
      expiry: BigInt(expiry),
      signature: signature as Hex,
    },
  }
}

export function claimTypedData(wallet: Address, nonce: Hex, expiry: bigint) {
  return {
    domain: CLAIM_DOMAIN,
    types: CLAIM_TYPES,
    primaryType: 'ClaimIntent' as const,
    message: {
      application: APPLICATION,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
      wallet,
      nonce,
      expiry,
    },
  }
}

export function claimIntentDigest(wallet: Address, nonce: Hex, expiry: bigint): Hex {
  return hashTypedData(claimTypedData(wallet, nonce, expiry))
}

/** Synchronous secp256k1 recovery (viem's own recover helpers are async, which QuickJS cannot await). */
export function recoverSigner(digest: Hex, signature: Hex): Address | undefined {
  try {
    const bytes = hexToBytes(signature)
    if (bytes.length !== 65) return undefined
    const v = bytes[64]
    const recovery = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : -1
    if (recovery < 0) return undefined
    const sig = secp256k1.Signature.fromCompact(bytesToHex(bytes.slice(0, 64)).slice(2)).addRecoveryBit(recovery)
    const publicKey = sig.recoverPublicKey(digest.slice(2)).toRawBytes(false)
    const hash = keccak256(bytesToHex(publicKey.slice(1)))
    return `0x${hash.slice(-40)}` as Address
  } catch {
    return undefined
  }
}

export function verifyIntentSignature(req: ClaimRequest): boolean {
  const signer = recoverSigner(claimIntentDigest(req.wallet, req.nonce, req.expiry), req.signature)
  return signer !== undefined && signer.toLowerCase() === req.wallet.toLowerCase()
}

/**
 * Opaque claim commitment. Binds application, chain, receiver contract, wallet, nonce and expiry.
 * It contains no username, token, or profile data, so it is safe to put onchain.
 */
export function computeClaimId(receiver: Address, wallet: Address, nonce: Hex, expiry: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('string application, uint256 chainId, address receiver, address wallet, bytes32 nonce, uint256 expiry'),
      [APPLICATION, BigInt(ARC_TESTNET_CHAIN_ID), receiver, wallet, nonce, expiry],
    ),
  )
}

/**
 * Opaque per-user commitment: keccak256(abi.encode(application, userId)). The receiver pays each
 * commitment at most once. It is a hash of a public demo user id, not the raw username, but it is
 * guessable (ids are small integers), so treat it as pseudonymous rather than secret.
 */
export function computeUserCommitment(userId: bigint): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('string application, uint256 userId'), [APPLICATION, userId]))
}

/**
 * Payout in 6-decimal USDC units for a DummyJSON `weight`: weight / 100 USDC, rounded down.
 * weight * 10_000 units, computed from the decimal string so no float arithmetic is involved.
 * Returns undefined for anything that is not a finite, positive number with a plain decimal form.
 */
export function weightToUsdc6(weight: unknown): bigint | undefined {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return undefined
  const text = String(weight)
  const match = /^([0-9]{1,9})(?:\.([0-9]+))?$/.exec(text)
  if (!match) return undefined // exponent notation or anything unexpected
  const [, whole, fraction = ''] = match
  const units = BigInt(whole) * 10_000n + BigInt(fraction.slice(0, 4).padEnd(4, '0'))
  return units > 0n ? units : undefined
}

/** Report schema v2: (uint8 schemaVersion, bytes32 claimId, bytes32 userCommitment, address recipient, uint256 amount, uint256 expiry). */
export function encodeClaimReport(claimId: Hex, userCommitment: Hex, recipient: Address, amount: bigint, expiry: bigint): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      'uint8 schemaVersion, bytes32 claimId, bytes32 userCommitment, address recipient, uint256 amount, uint256 expiry',
    ),
    [REPORT_SCHEMA_VERSION, claimId, userCommitment, recipient, amount, expiry],
  )
}
