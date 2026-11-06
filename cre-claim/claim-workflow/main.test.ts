import { describe, expect, test } from 'bun:test'
import { getNetwork } from '@chainlink/cre-sdk'
import { decodeAbiParameters, hashTypedData, parseAbiParameters, toFunctionSelector, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { configSchema } from './src/config'
import { decodeClaimedUserResult, encodeClaimedUserCall } from './src/preflight'
import { enclavePublicKeyFromPrivate, openSessionMaterial, type SessionBinding } from './src/session'
import { x25519 } from '@noble/curves/ed25519'
import { bytesToHex } from 'viem'
import {
  claimIntentDigest,
  claimTypedData,
  computeClaimId,
  computeUserCommitment,
  encodeClaimReport,
  parseClaimRequest,
  recoverSigner,
  verifyIntentSignature,
  weightToUsdc6,
} from './src/intent'
import * as browser from '../../src/lib/claimIntent'
import { sealSessionMaterial } from '../../src/lib/sessionCrypto'

const NONCE = `0x${'ab'.repeat(32)}` as Hex
const EXPIRY = 1_900_000_000n
const RECEIVER = '0x1111111111111111111111111111111111111111' as Address
const FAKE_TOKEN = 'aaa.bbb.ccc'
const ENVELOPE = `0x${'ab'.repeat(120)}` as Hex

describe('typed data parity with the browser module', () => {
  test('identical digest and claimId', () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const intent = { wallet: account.address, nonce: NONCE, expiry: EXPIRY }
    expect(claimIntentDigest(intent.wallet, intent.nonce, intent.expiry)).toBe(
      hashTypedData(browser.buildTypedData(intent)),
    )
    expect(computeClaimId(RECEIVER, intent.wallet, intent.nonce, intent.expiry)).toBe(
      browser.computeClaimId(RECEIVER, intent),
    )
  })
})

describe('signature verification', () => {
  test('accepts a browser-style signature from the wallet', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const intent = { wallet: account.address, nonce: NONCE, expiry: EXPIRY }
    const signature = await account.signTypedData(browser.buildTypedData(intent))
    expect(recoverSigner(claimIntentDigest(intent.wallet, NONCE, EXPIRY), signature)?.toLowerCase()).toBe(
      account.address.toLowerCase(),
    )
    expect(verifyIntentSignature({ encryptedSessionMaterial: ENVELOPE, ...intent, signature })).toBe(true)
  })

  test('rejects a signature over a different expiry, nonce, or wallet', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    const intent = { wallet: account.address, nonce: NONCE, expiry: EXPIRY }
    const signature = await account.signTypedData(browser.buildTypedData(intent))
    const base = { encryptedSessionMaterial: ENVELOPE, ...intent, signature }
    expect(verifyIntentSignature({ ...base, expiry: EXPIRY + 1n })).toBe(false)
    expect(verifyIntentSignature({ ...base, nonce: `0x${'cd'.repeat(32)}` })).toBe(false)
    expect(verifyIntentSignature({ ...base, wallet: other.address })).toBe(false)
  })

  test('rejects a signature bound to a different chain id', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const intent = { wallet: account.address, nonce: NONCE, expiry: EXPIRY }
    const typed = claimTypedData(intent.wallet, NONCE, EXPIRY)
    const signature = await account.signTypedData({ ...typed, domain: { ...typed.domain, chainId: 1 } })
    expect(verifyIntentSignature({ encryptedSessionMaterial: ENVELOPE, ...intent, signature })).toBe(false)
  })

  test('malformed signatures never throw', () => {
    expect(recoverSigner(`0x${'11'.repeat(32)}`, `0x${'00'.repeat(65)}`)).toBeUndefined()
  })
})

describe('request parsing', () => {
  const good = {
    encryptedSessionMaterial: `0x${'ab'.repeat(120)}`,
    wallet: '0x2222222222222222222222222222222222222222',
    nonce: NONCE,
    expiry: '1900000000',
    signature: `0x${'11'.repeat(65)}`,
  }
  test('accepts the exact field set', () => {
    expect(parseClaimRequest(good).ok).toBe(true)
  })
  test('rejects extras, missing, and wrongly typed fields without echoing input', () => {
    for (const bad of [
      { ...good, username: 'someone' },
      { ...good, expiry: 1900000000 },
      { ...good, accessToken: FAKE_TOKEN },
      { ...good, encryptedSessionMaterial: 'not hex' },
      { ...good, encryptedSessionMaterial: `0x${'ab'.repeat(7000)}` },
      { ...good, wallet: '0x12' },
      { ...good, nonce: '0x12' },
      { ...good, signature: '0x12' },
      null,
      [],
      'x',
    ]) {
      const result = parseClaimRequest(bad)
      expect(result).toEqual({ ok: false, reason: 'invalid_request' })
    }
  })
})

describe('payout from weight (weight / 100 USDC, 6 decimals, rounded down)', () => {
  test('converts exact and fractional weights', () => {
    expect(weightToUsdc6(63)).toBe(630_000n) // 0.63 USDC
    expect(weightToUsdc6(63.1)).toBe(631_000n)
    expect(weightToUsdc6(59.4)).toBe(594_000n)
    expect(weightToUsdc6(100)).toBe(1_000_000n)
    expect(weightToUsdc6(0.0001)).toBe(1n)
  })
  test('rounds down past four decimals of weight', () => {
    expect(weightToUsdc6(63.123456)).toBe(631_234n)
  })
  test('rejects missing, non-positive, non-finite, wrongly typed and exponent-form weights', () => {
    for (const bad of [undefined, null, '63', 0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e21, 1e-7, 0.00001, {}, []]) {
      expect(weightToUsdc6(bad)).toBeUndefined()
    }
  })
})

describe('user commitment', () => {
  test('is stable per user id, distinct across ids, and not the raw id', () => {
    expect(computeUserCommitment(7n)).toBe(computeUserCommitment(7n))
    expect(computeUserCommitment(7n)).not.toBe(computeUserCommitment(8n))
    expect(computeUserCommitment(7n)).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('encrypted session material', () => {
  const privateKey = bytesToHex(x25519.utils.randomPrivateKey())
  const publicKey = enclavePublicKeyFromPrivate(privateKey)
  const wallet = '0x2222222222222222222222222222222222222222' as Address
  const binding: SessionBinding & { chainId: number } = { wallet, nonce: NONCE, expiry: EXPIRY, chainId: 5042002 }
  const seal = (token = FAKE_TOKEN) => sealSessionMaterial(token, publicKey, binding)

  test('the enclave opens what the browser sealed', () => {
    expect(openSessionMaterial(seal(), privateKey, binding)).toBe(FAKE_TOKEN)
  })

  test('the envelope never contains the readable token and differs on every seal', () => {
    const a = seal()
    expect(a).not.toContain(Buffer.from(FAKE_TOKEN).toString('hex'))
    expect(a).not.toBe(seal())
  })

  test('another enclave key cannot open it', () => {
    const other = bytesToHex(x25519.utils.randomPrivateKey())
    expect(openSessionMaterial(seal(), other, binding)).toBeUndefined()
  })

  test('is bound to wallet, nonce, expiry and chain', () => {
    const envelope = seal()
    expect(openSessionMaterial(envelope, privateKey, { ...binding, wallet: '0x3333333333333333333333333333333333333333' })).toBeUndefined()
    expect(openSessionMaterial(envelope, privateKey, { ...binding, nonce: `0x${'cd'.repeat(32)}` })).toBeUndefined()
    expect(openSessionMaterial(envelope, privateKey, { ...binding, expiry: EXPIRY + 1n })).toBeUndefined()
    expect(openSessionMaterial(envelope, privateKey, { ...binding, chainId: 1 })).toBeUndefined()
  })

  test('tampered, truncated, wrong-version and malformed envelopes fail closed without throwing', () => {
    const envelope = seal()
    const flip = (i: number) => {
      const bytes = Buffer.from(envelope.slice(2), 'hex')
      bytes[i] = bytes[i] ^ 0x01
      return `0x${bytes.toString('hex')}` as Hex
    }
    expect(openSessionMaterial(flip(0), privateKey, binding)).toBeUndefined() // version
    expect(openSessionMaterial(flip(5), privateKey, binding)).toBeUndefined() // ephemeral key
    expect(openSessionMaterial(flip(40), privateKey, binding)).toBeUndefined() // nonce
    expect(openSessionMaterial(flip(Buffer.from(envelope.slice(2), 'hex').length - 1), privateKey, binding)).toBeUndefined() // tag
    expect(openSessionMaterial(envelope.slice(0, 60) as Hex, privateKey, binding)).toBeUndefined()
    expect(openSessionMaterial('0x' as Hex, privateKey, binding)).toBeUndefined()
    expect(openSessionMaterial('zz' as Hex, privateKey, binding)).toBeUndefined()
    expect(openSessionMaterial(envelope, '0x12' as Hex, binding)).toBeUndefined()
  })

  test('a fixed random source gives a stable envelope (format pin)', () => {
    const fixed = (n: number) => new Uint8Array(n).fill(7)
    const a = sealSessionMaterial(FAKE_TOKEN, publicKey, binding, fixed)
    expect(a).toBe(sealSessionMaterial(FAKE_TOKEN, publicKey, binding, fixed))
    expect(a.startsWith('0x01')).toBe(true)
    expect(openSessionMaterial(a, privateKey, binding)).toBe(FAKE_TOKEN)
  })
})

describe('duplicate preflight (claimedUser)', () => {
  test('encodes claimedUser(bytes32) call data with the right selector', () => {
    const commitment = computeUserCommitment(5n)
    const data = encodeClaimedUserCall(commitment)
    expect(data).toBe(`${toFunctionSelector('claimedUser(bytes32)')}${commitment.slice(2)}`)
  })

  test('decodes true and false and rejects malformed return data', () => {
    expect(decodeClaimedUserResult(`0x${'00'.repeat(31)}01`)).toBe(true)
    expect(decodeClaimedUserResult(`0x${'00'.repeat(32)}`)).toBe(false)
    expect(() => decodeClaimedUserResult('0x')).toThrow()
  })
})

describe('report encoding (schema v2)', () => {
  test('is exactly 192 bytes and round-trips every field', () => {
    const claimId = computeClaimId(RECEIVER, RECEIVER, NONCE, EXPIRY)
    const commitment = computeUserCommitment(5n)
    const encoded = encodeClaimReport(claimId, commitment, RECEIVER, 631_000n, EXPIRY)
    expect((encoded.length - 2) / 2).toBe(192)
    const decoded = decodeAbiParameters(
      parseAbiParameters('uint8, bytes32, bytes32, address, uint256, uint256'),
      encoded,
    )
    expect(decoded).toEqual([2, claimId, commitment, RECEIVER, 631_000n, EXPIRY])
  })
})

describe('config schema', () => {
  const local = {
    mode: 'local-simulation',
    application: 'dummyjson-arc-claim-v1',
    chainId: 5042002,
    chainSelectorName: 'arc-testnet',
    authMeUrl: 'https://dummyjson.com/auth/me',
    maxClaimAmountUsdc6: '5000000',
    maxIntentTtlSeconds: 900,
    authorizedKeys: [],
  }
  const production = { ...local, mode: 'production', receiver: RECEIVER, gasLimit: '300000', authorizedKeys: [RECEIVER] }

  test('accepts the two closed variants', () => {
    expect(configSchema.safeParse(local).success).toBe(true)
    expect(configSchema.safeParse(production).success).toBe(true)
  })
  test('local variant cannot carry a receiver; production needs receiver and an authorized key', () => {
    expect(configSchema.safeParse({ ...local, receiver: RECEIVER }).success).toBe(false)
    expect(configSchema.safeParse({ ...production, receiver: `0x${'0'.repeat(40)}` }).success).toBe(false)
    expect(configSchema.safeParse({ ...production, authorizedKeys: [] }).success).toBe(false)
  })
  test('requires a positive integer claim cap and has no username setting', () => {
    expect(configSchema.safeParse({ ...local, maxClaimAmountUsdc6: '0' }).success).toBe(false)
    expect(configSchema.safeParse({ ...local, maxClaimAmountUsdc6: '5.5' }).success).toBe(false)
    expect(configSchema.safeParse({ ...local, expectedUsername: 'oliviaw' }).success).toBe(false)
  })
  test('rejects unknown modes and a token endpoint other than DummyJSON auth/me', () => {
    expect(configSchema.safeParse({ ...local, mode: 'dry-run' }).success).toBe(false)
    expect(configSchema.safeParse({ ...local, authMeUrl: 'https://evil.example/auth/me' }).success).toBe(false)
  })
})

describe('Arc Testnet selector', () => {
  test('official CRE name resolves to the documented chain selector', () => {
    const network = getNetwork({ chainFamily: 'evm', chainSelectorName: 'arc-testnet' })
    expect(network?.chainSelector.selector).toBe(3034092155422581607n)
  })
})
