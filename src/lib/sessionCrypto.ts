// Seals the DummyJSON access token to the enclave's public key so that only the enclave can read it.
// Sealing half of cre-claim/claim-workflow/src/session.ts (same scheme, same envelope layout);
// cre-claim/claim-workflow/main.test.ts opens browser-sealed envelopes with the workflow code.
//
//   shared = X25519(ephemeralPrivate, enclavePublic)
//   key    = HKDF-SHA256(shared, salt = ephemeralPublic || enclavePublic, info = SESSION_INFO, 32 bytes)
//   sealed = ChaCha20-Poly1305(key, random 12-byte nonce, plaintext = token, aad = claim binding)
//   envelope = 0x || version(1) || ephemeralPublic(32) || nonce(12) || ciphertext || tag(16)
import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes, type Address, type Hex } from 'viem'
import { ARC_TESTNET_CHAIN_ID } from './claimIntent'

export const SESSION_VERSION = 1
export const SESSION_INFO = 'dummyjson-arc-claim-v1/session/v1'
const KEY_RE = /^0x[0-9a-fA-F]{64}$/
const NONCE_BYTES = 12

export type SessionBinding = { wallet: Address; nonce: Hex; expiry: bigint }

/** True when `value` looks like a 32-byte 0x-hex X25519 public key. */
export function isEnclavePublicKey(value: string | undefined): value is Hex {
  return typeof value === 'string' && KEY_RE.test(value)
}

/** Domain-separated associated data that ties an envelope to one signed claim intent. */
export function sessionAad(binding: SessionBinding): Uint8Array {
  const text = `${SESSION_INFO}|${ARC_TESTNET_CHAIN_ID}|${binding.wallet.toLowerCase()}|${binding.nonce.toLowerCase()}|${binding.expiry.toString()}`
  return new TextEncoder().encode(text)
}

/** Encrypts the access token to the enclave. A fresh ephemeral key and nonce are used every call. */
export function sealSessionMaterial(
  accessToken: string,
  enclavePublicKey: Hex,
  binding: SessionBinding,
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): Hex {
  if (!isEnclavePublicKey(enclavePublicKey)) throw new Error('invalid enclave public key')
  const recipient = hexToBytes(enclavePublicKey)
  const ephemeralPrivate = random(32)
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate)
  const salt = new Uint8Array(64)
  salt.set(ephemeralPublic, 0)
  salt.set(recipient, 32)
  const key = hkdf(sha256, x25519.getSharedSecret(ephemeralPrivate, recipient), salt, new TextEncoder().encode(SESSION_INFO), 32)
  const nonce = random(NONCE_BYTES)
  const sealed = chacha20poly1305(key, nonce, sessionAad(binding)).encrypt(new TextEncoder().encode(accessToken))
  const out = new Uint8Array(1 + 32 + NONCE_BYTES + sealed.length)
  out[0] = SESSION_VERSION
  out.set(ephemeralPublic, 1)
  out.set(nonce, 33)
  out.set(sealed, 33 + NONCE_BYTES)
  return bytesToHex(out)
}
