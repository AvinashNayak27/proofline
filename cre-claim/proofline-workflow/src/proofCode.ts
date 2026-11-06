import { encodeAbiParameters, hexToBytes, keccak256, parseAbiParameters, type Address } from 'viem'

// Crockford base32: no I, L, O or U, so a code survives being read aloud or retyped.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_CHARS = 10

/** Ten base32 characters (50 bits) derived from the campaign and the creator's wallet. */
export function proofCodeRaw(campaignId: bigint, wallet: Address): string {
  const digest = hexToBytes(
    keccak256(
      encodeAbiParameters(parseAbiParameters('string tag, uint256 campaignId, address wallet'), [
        'proofline-code-v1',
        campaignId,
        wallet,
      ]),
    ),
  )
  let out = ''
  let acc = 0
  let bits = 0
  for (const byte of digest) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < CODE_CHARS) {
      out += ALPHABET[(acc >> (bits - 5)) & 31]
      bits -= 5
    }
    acc &= (1 << bits) - 1
    if (out.length === CODE_CHARS) break
  }
  return out
}

/** The code a creator puts in the post, for example "PL-7K3M9-Q2XD4". */
export function proofCode(campaignId: bigint, wallet: Address): string {
  const raw = proofCodeRaw(campaignId, wallet)
  return `PL-${raw.slice(0, 5)}-${raw.slice(5)}`
}

/** True when the post text contains the code, ignoring case, spaces, dashes and other punctuation. */
export function textHasProofCode(text: string, campaignId: bigint, wallet: Address): boolean {
  const normalized = text.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return normalized.includes(`PL${proofCodeRaw(campaignId, wallet)}`)
}
