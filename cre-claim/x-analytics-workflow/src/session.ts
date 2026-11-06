import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { hexToBytes, type Hex } from 'viem'
import type { Claim } from './intent'
const INFO = 'x-analytics-cre-demo/session/v2'
export function open(envelope: Hex, secret: Hex, c: Claim): unknown {
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(secret)) return
    const bytes = hexToBytes(envelope); if (bytes.length < 62 || bytes[0] !== 1) return
    const privateBytes = hexToBytes(secret); const pub = bytes.slice(1,33); const recipient = x25519.getPublicKey(privateBytes)
    const salt = new Uint8Array(64); salt.set(pub); salt.set(recipient,32)
    const key = hkdf(sha256,x25519.getSharedSecret(privateBytes,pub),salt,new TextEncoder().encode(INFO),32)
    const aad = `${INFO}|5042002|${c.postId}|${c.wallet.toLowerCase()}|${c.nonce.toLowerCase()}|${c.expiry}`
    return JSON.parse(new TextDecoder().decode(chacha20poly1305(key,bytes.slice(33,45),new TextEncoder().encode(aad)).decrypt(bytes.slice(45))))
  } catch { return }
}
