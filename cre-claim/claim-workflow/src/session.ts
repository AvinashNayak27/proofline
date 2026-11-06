// Encrypted session material: the browser seals the DummyJSON access token to the enclave's
// public key, and only the enclave (which holds the private key as a CRE secret) can open it.
//
// Scheme (an ECIES construction from audited primitives, all synchronous and QuickJS-safe):
//   shared = X25519(ephemeralPrivate, enclavePublic)
//   key    = HKDF-SHA256(shared, salt = ephemeralPublic || enclavePublic, info = INFO, 32 bytes)
//   sealed = ChaCha20-Poly1305(key, random 12-byte nonce, plaintext = token, aad = claim binding)
// Envelope (hex string): 0x || version(1) || ephemeralPublic(32) || nonce(12) || ciphertext || tag(16)
//
// The AAD binds the ciphertext to the signed claim intent (chain, wallet, nonce, expiry), so a
// captured envelope cannot be replayed under a different wallet, nonce or expiry.
// src/lib/sessionCrypto.ts in the app is the sealing half of this scheme; main.test.ts pins them together.
import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes, type Address, type Hex } from 'viem'

export const SESSION_VERSION = 1
export const SESSION_INFO = 'dummyjson-arc-claim-v1/session/v1'
const KEY_RE = /^0x[0-9a-fA-F]{64}$/
const NONCE_BYTES = 12
const PUBLIC_BYTES = 32
const TAG_BYTES = 16
/** Header = version byte + ephemeral public key + AEAD nonce. */
const HEADER_BYTES = 1 + PUBLIC_BYTES + NONCE_BYTES
/** Envelope bounds: a JWT-sized token (<= 6 KiB) plus header and tag. Enforced before any crypto. */
export const MAX_ENVELOPE_HEX_CHARS = 2 + 2 * (HEADER_BYTES + 6 * 1024 + TAG_BYTES)
export const ENVELOPE_RE = /^0x[0-9a-fA-F]+$/

export type SessionBinding = { wallet: Address; nonce: Hex; expiry: bigint; chainId: number }

/** Domain-separated associated data that ties an envelope to one signed claim intent. */
export function sessionAad(binding: SessionBinding): Uint8Array {
  const text = `${SESSION_INFO}|${binding.chainId}|${binding.wallet.toLowerCase()}|${binding.nonce.toLowerCase()}|${binding.expiry.toString()}`
  return new TextEncoder().encode(text)
}

function deriveKey(shared: Uint8Array, ephemeralPublic: Uint8Array, enclavePublic: Uint8Array): Uint8Array {
  const salt = new Uint8Array(PUBLIC_BYTES * 2)
  salt.set(ephemeralPublic, 0)
  salt.set(enclavePublic, PUBLIC_BYTES)
  return hkdf(sha256, shared, salt, new TextEncoder().encode(SESSION_INFO), 32)
}

/** Public half of an enclave key: 32-byte X25519 public key as 0x-hex. */
export function enclavePublicKeyFromPrivate(privateKey: Hex): Hex {
  if (!KEY_RE.test(privateKey)) throw new Error('invalid enclave key')
  return bytesToHex(x25519.getPublicKey(hexToBytes(privateKey)))
}

/**
 * Opens an envelope with the enclave private key. Returns undefined for any failure (bad version,
 * wrong key, tampered bytes, wrong binding) so callers can reject without learning why.
 */
export function openSessionMaterial(envelope: Hex, enclavePrivateKey: Hex, binding: SessionBinding): string | undefined {
  try {
    if (!KEY_RE.test(enclavePrivateKey)) return undefined
    if (envelope.length > MAX_ENVELOPE_HEX_CHARS || !ENVELOPE_RE.test(envelope) || envelope.length % 2 !== 0) return undefined
    const bytes = hexToBytes(envelope)
    if (bytes.length < HEADER_BYTES + TAG_BYTES + 1 || bytes[0] !== SESSION_VERSION) return undefined
    const ephemeralPublic = bytes.slice(1, 1 + PUBLIC_BYTES)
    const nonce = bytes.slice(1 + PUBLIC_BYTES, HEADER_BYTES)
    const privateBytes = hexToBytes(enclavePrivateKey)
    const enclavePublic = x25519.getPublicKey(privateBytes)
    const key = deriveKey(x25519.getSharedSecret(privateBytes, ephemeralPublic), ephemeralPublic, enclavePublic)
    const opened = chacha20poly1305(key, nonce, sessionAad(binding)).decrypt(bytes.slice(HEADER_BYTES))
    return new TextDecoder().decode(opened)
  } catch {
    return undefined
  }
}
