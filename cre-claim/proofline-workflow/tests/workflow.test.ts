import { expect, test, describe } from 'bun:test'
import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hashTypedData, hexToBytes, keccak256, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { parseMetrics, validateCapture } from '../src/analytics'
import { configSchema } from '../src/config'
import { parseClaim, postKey, recoverSigner, typedData, verify } from '../src/intent'
import { proofCode, proofCodeRaw, textHasProofCode } from '../src/proofCode'
import { encodeRewardBody, reportDigest, signReport } from '../src/report'
import { open, SESSION_INFO, sessionAad } from '../src/session'
import { checkTweet, syndicationToken, syndicationUrl } from '../src/tweet'
import * as browserClaim from '../../../src/lib/proofline/claim'
import { proofCode as browserProofCode } from '../../../src/lib/proofline/code'

const WALLET = '0x2222222222222222222222222222222222222222' as Address
const COMMITMENT = `0x${'ab'.repeat(32)}` as Hex
const NONCE = `0x${'cd'.repeat(32)}` as Hex
const POST = '1234567890123456789'
const EXPIRY = 1_900_000_000n

describe('proof code', () => {
  test('is deterministic, readable and bound to campaign and wallet', () => {
    const a = proofCode(7n, WALLET)
    expect(a).toMatch(/^PL-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(proofCode(7n, WALLET)).toBe(a)
    expect(proofCode(8n, WALLET)).not.toBe(a)
    expect(proofCode(7n, '0x3333333333333333333333333333333333333333')).not.toBe(a)
  })
  test('browser and workflow derive the same code', () => {
    for (const id of [1n, 2n, 99_999n]) expect(browserProofCode(id, WALLET)).toBe(proofCode(id, WALLET))
  })
  test('matches inside a post regardless of case and punctuation, and never from another wallet', () => {
    const code = proofCode(7n, WALLET)
    expect(textHasProofCode(`Loving this! ${code} #ad`, 7n, WALLET)).toBe(true)
    expect(textHasProofCode(`loving this ${code.toLowerCase().replace(/-/g, ' ')}`, 7n, WALLET)).toBe(true)
    expect(textHasProofCode(`${code}`, 7n, '0x3333333333333333333333333333333333333333')).toBe(false)
    expect(textHasProofCode(`${proofCode(8n, WALLET)}`, 7n, WALLET)).toBe(false)
    expect(textHasProofCode('no code here', 7n, WALLET)).toBe(false)
    expect(proofCodeRaw(7n, WALLET)).toHaveLength(10)
  })
})

describe('claim request', () => {
  const good = {
    campaignId: '7',
    postUrl: `https://x.com/creator_1/status/${POST}`,
    wallet: WALLET,
    creatorCommitment: COMMITMENT,
    nonce: NONCE,
    expiry: EXPIRY.toString(),
    signature: `0x${'11'.repeat(65)}`,
    encryptedSessionMaterial: `0x01${'aa'.repeat(80)}`,
    requiredTag: '#ProoflineDemo',
  }
  test('accepts the exact field set', () => {
    const c = parseClaim(good)
    expect(c?.campaignId).toBe(7n)
    expect(c?.postId).toBe(POST)
    expect(c?.handle).toBe('creator_1')
  })
  test('accepts twitter.com links and an empty tag', () => {
    expect(parseClaim({ ...good, postUrl: `https://twitter.com/a/status/12/`, requiredTag: '' })?.postId).toBe('12')
  })
  test('rejects extras, wrong types and unsafe links without echoing input', () => {
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, campaignId: '0' },
      { ...good, campaignId: 7 },
      { ...good, postUrl: `https://x.com/a/status/${POST}?s=20` },
      { ...good, postUrl: `http://x.com/a/status/${POST}` },
      { ...good, postUrl: `https://evil.com/a/status/${POST}` },
      { ...good, wallet: '0x12' },
      { ...good, creatorCommitment: `0x${'00'.repeat(32)}` },
      { ...good, nonce: '0x12' },
      { ...good, expiry: '0' },
      { ...good, signature: '0x12' },
      { ...good, requiredTag: 'has space' },
      { ...good, encryptedSessionMaterial: 'nothex' },
      { ...good, encryptedSessionMaterial: `0x${'ab'.repeat(20000)}` },
      null,
      [],
      'x',
    ]) {
      expect(parseClaim(bad)).toBeUndefined()
    }
  })
  test('typed data matches the browser module and a wallet signature verifies', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const intent = { campaignId: 7n, postId: POST, wallet: account.address, creatorCommitment: COMMITMENT, nonce: NONCE, expiry: EXPIRY }
    expect(hashTypedData(typedData(intent))).toBe(hashTypedData(browserClaim.buildTypedData(intent)))
    const signature = await account.signTypedData(browserClaim.buildTypedData(intent))
    const base = { ...intent, handle: 'h', signature, encryptedSessionMaterial: '0x01' as Hex, requiredTag: '' }
    expect(verify(base)).toBe(true)
    expect(verify({ ...base, campaignId: 8n })).toBe(false)
    expect(verify({ ...base, postId: '999' })).toBe(false)
    expect(verify({ ...base, creatorCommitment: `0x${'ee'.repeat(32)}` })).toBe(false)
    expect(verify({ ...base, wallet: WALLET })).toBe(false)
    expect(recoverSigner(hashTypedData(typedData(intent)), '0x12')).toBeUndefined()
  })
  test('post key is stable, global and matches the browser', () => {
    expect(postKey(POST)).toBe(browserClaim.postKey(POST))
    expect(postKey(POST)).not.toBe(postKey('1'))
    expect(browserClaim.parsePostUrl(`https://x.com/a/status/${POST}`)).toEqual({ handle: 'a', postId: POST })
    expect(browserClaim.parsePostUrl(`https://x.com/a/status/${POST}?x=1`)).toBeUndefined()
  })
})

describe('analytics metrics', () => {
  const response = (video: unknown, rest_id = POST) => ({ data: { tweet_result_by_rest_id: { result: { rest_id, video } } } })
  test('reads views and completions', () => {
    expect(
      parseMetrics(response([{ metric_type: 'UniqueVideoViews', metric_value: 735 }, { metric_type: 'VideoCompletions', metric_value: 104 }]), POST),
    ).toEqual({ uniqueViews: 735, completions: 104 })
  })
  test('missing metrics or metric_value count as 0', () => {
    const views = [{ metric_type: 'UniqueVideoViews', metric_value: 2000 }]
    expect(parseMetrics(response(views), POST)).toEqual({ uniqueViews: 2000, completions: 0 })
    expect(parseMetrics(response([...views, { metric_type: 'VideoCompletions' }]), POST)?.completions).toBe(0)
    expect(parseMetrics(response([...views, { metric_type: 'VideoCompletions', metric_value: null }]), POST)?.completions).toBe(0)
    expect(parseMetrics(response(undefined), POST)).toEqual({ uniqueViews: 0, completions: 0 })
  })
  test('rejects mismatched posts, duplicates and malformed values', () => {
    const ok = [{ metric_type: 'UniqueVideoViews', metric_value: 5 }]
    expect(parseMetrics(response(ok), '999')).toBeUndefined()
    expect(parseMetrics({ data: {} }, POST)).toBeUndefined()
    expect(parseMetrics(response('nope'), POST)).toBeUndefined()
    expect(parseMetrics(response([...ok, ...ok]), POST)).toBeUndefined()
    expect(parseMetrics(response([{ metric_type: 'UniqueVideoViews', metric_value: -1 }]), POST)).toBeUndefined()
    expect(parseMetrics(response([{ metric_type: 'UniqueVideoViews', metric_value: 1.5 }]), POST)).toBeUndefined()
    expect(parseMetrics(response([{ metric_type: 'UniqueVideoViews', metric_value: '12' }]), POST)).toBeUndefined()
  })
  test('capture accepts only the matching X operation and a complete session', () => {
    const url = `https://x.com/i/api/graphql/abc/TweetActivityQuery?variables=${encodeURIComponent(JSON.stringify({ restId: POST }))}`
    const headers = { cookie: 'auth_token=abc; ct0=abcdefgh', 'x-csrf-token': 'abcdefgh', authorization: 'Bearer abcdefghijklmnop' }
    expect(validateCapture({ url, headers }, POST)?.url).toBe(url)
    expect(validateCapture({ url: url.replace('x.com', 'evil.com'), headers }, POST)).toBeUndefined()
    expect(validateCapture({ url, headers }, '999')).toBeUndefined()
    expect(validateCapture({ url, headers: { ...headers, 'x-csrf-token': 'different' } }, POST)).toBeUndefined()
  })
})

describe('tweet check', () => {
  const expectation = { postId: POST, handle: 'Creator_1', campaignId: 7n, wallet: WALLET, requiredTag: '#ProoflineDemo' }
  const tweet = (over: Record<string, unknown> = {}) => ({
    id_str: POST,
    text: `Great product ${proofCode(7n, WALLET)} #prooflinedemo`,
    user: { screen_name: 'creator_1' },
    ...over,
  })
  test('accepts the right post, author, code and tag', () => {
    expect(checkTweet(tweet(), expectation)).toBe('ok')
    expect(checkTweet(tweet(), { ...expectation, requiredTag: '' })).toBe('ok')
  })
  test('rejects each way it can be wrong', () => {
    expect(checkTweet(null, expectation)).toBe('tweet_unreadable')
    expect(checkTweet({ __typename: 'TweetTombstone' }, expectation)).toBe('tweet_unreadable')
    expect(checkTweet(tweet({ id_str: '1' }), expectation)).toBe('tweet_mismatch')
    expect(checkTweet(tweet({ user: { screen_name: 'someone_else' } }), expectation)).toBe('tweet_mismatch')
    expect(checkTweet(tweet({ text: 'no code, #ProoflineDemo' }), expectation)).toBe('code_missing')
    expect(checkTweet(tweet({ text: `${proofCode(7n, WALLET)} but no tag` }), expectation)).toBe('tag_missing')
    expect(checkTweet(tweet({ text: 'no code, #ProoflineDemo' }), { ...expectation, requireCode: false })).toBe('ok')
    expect(checkTweet(tweet({ text: 'no code, no tag' }), { ...expectation, requireCode: false })).toBe('tag_missing')
    expect(checkTweet(tweet({ user: { screen_name: 'someone_else' }, text: 'no code, #ProoflineDemo' }), { ...expectation, requireCode: false })).toBe('tweet_mismatch')
    expect(checkTweet(tweet({ text: `${proofCode(8n, WALLET)} #ProoflineDemo` }), expectation)).toBe('code_missing')
  })
  test('builds the public lookup URL', () => {
    expect(syndicationToken('1234567890123456789')).toMatch(/^[0-9a-z]+$/)
    expect(syndicationUrl(POST)).toStartWith('https://cdn.syndication.twimg.com/tweet-result?id=')
  })
})

describe('session material', () => {
  const claim = { campaignId: 7n, postId: POST, wallet: WALLET, nonce: NONCE, expiry: EXPIRY } as never
  function seal(value: unknown, recipientPublic: Uint8Array, aad: string): Hex {
    const eph = crypto.getRandomValues(new Uint8Array(32))
    const pub = x25519.getPublicKey(eph)
    const salt = new Uint8Array(64)
    salt.set(pub)
    salt.set(recipientPublic, 32)
    const key = hkdf(sha256, x25519.getSharedSecret(eph, recipientPublic), salt, new TextEncoder().encode(SESSION_INFO), 32)
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const body = chacha20poly1305(key, nonce, new TextEncoder().encode(aad)).encrypt(new TextEncoder().encode(JSON.stringify(value)))
    const out = new Uint8Array(45 + body.length)
    out[0] = 1
    out.set(pub, 1)
    out.set(nonce, 33)
    out.set(body, 45)
    return bytesToHex(out)
  }
  const priv = bytesToHex(x25519.utils.randomPrivateKey())
  const pub = x25519.getPublicKey(hexToBytes(priv))
  test('opens what the extension sealed and is bound to the claim', () => {
    const env = seal({ hello: 'world' }, pub, sessionAad(claim))
    expect(open(env, priv, claim)).toEqual({ hello: 'world' })
    expect(open(env, priv, { ...(claim as object), campaignId: 8n } as never)).toBeUndefined()
    expect(open(env, priv, { ...(claim as object), wallet: '0x3333333333333333333333333333333333333333' } as never)).toBeUndefined()
    expect(open(env, bytesToHex(x25519.utils.randomPrivateKey()), claim)).toBeUndefined()
    expect(open('0x01' as Hex, priv, claim)).toBeUndefined()
  })
})

describe('signed reward report', () => {
  const key = generatePrivateKey()
  const signer = privateKeyToAccount(key).address
  const contract = '0xba639d505096fcc005b51ae34f84ee1164068343' as Address
  const body = encodeRewardBody({
    campaignId: 7n,
    postKey: postKey(POST),
    creatorCommitment: COMMITMENT,
    recipient: WALLET,
    uniqueViews: 1000n,
    completions: 500n,
    expiry: EXPIRY,
  })
  test('the body is exactly 256 bytes and the signed payload exactly 321', () => {
    expect((body.length - 2) / 2).toBe(256)
    const signed = signReport(body, 5042002, contract, key)
    expect((signed.length - 2) / 2).toBe(321)
    expect(signed.startsWith(body)).toBe(true)
  })
  test('the signature recovers the signer from the chain- and contract-bound digest', () => {
    const signed = signReport(body, 5042002, contract, key)
    const sig = `0x${signed.slice(2 + 256 * 2)}` as Hex
    expect(recoverSigner(reportDigest(5042002, contract, body), sig)?.toLowerCase()).toBe(signer.toLowerCase())
    expect(recoverSigner(reportDigest(1, contract, body), sig)?.toLowerCase()).not.toBe(signer.toLowerCase())
    expect(recoverSigner(reportDigest(5042002, '0x1111111111111111111111111111111111111111', body), sig)?.toLowerCase()).not.toBe(signer.toLowerCase())
    expect(keccak256(body)).toMatch(/^0x[0-9a-f]{64}$/)
  })
  test('signatures are low-s and use a 27/28 recovery byte', () => {
    const signed = signReport(body, 5042002, contract, key)
    const s = BigInt(`0x${signed.slice(2 + 288 * 2, 2 + 320 * 2)}`)
    expect(s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n).toBe(true)
    expect(['1b', '1c']).toContain(signed.slice(-2))
  })
})

describe('config schema', () => {
  const local = { mode: 'local-simulation', application: 'proofline-v1', chainId: 5042002, chainSelectorName: 'arc-testnet', maxIntentTtlSeconds: 900, authorizedKeys: [] }
  test('accepts the two closed variants', () => {
    expect(configSchema.safeParse(local).success).toBe(true)
    expect(
      configSchema.safeParse({ ...local, mode: 'production', receiver: contractAddress(), gasLimit: '400000', authorizedKeys: [contractAddress()] }).success,
    ).toBe(true)
  })
  test('a local config cannot carry a receiver and production needs one', () => {
    expect(configSchema.safeParse({ ...local, receiver: contractAddress() }).success).toBe(false)
    expect(configSchema.safeParse({ ...local, mode: 'production', gasLimit: '400000', authorizedKeys: [contractAddress()] }).success).toBe(false)
  })
})

function contractAddress(): string {
  return '0xba639d505096fcc005b51ae34f84ee1164068343'
}
