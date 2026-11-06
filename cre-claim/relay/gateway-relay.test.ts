import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { hashMessage, recoverAddress, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createJwt, stableStringify, type RpcRequest } from './gateway-relay'

const request: RpcRequest = {
  jsonrpc: '2.0',
  id: 'req-1',
  method: 'workflows.execute',
  params: { input: { b: '2', a: '1' }, workflow: { workflowID: 'ab'.repeat(32) } },
}

const decode = (part: string) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))

describe('gateway relay JWT', () => {
  test('stableStringify sorts keys at every level', () => {
    expect(stableStringify(request)).toBe(
      `{"id":"req-1","jsonrpc":"2.0","method":"workflows.execute","params":{"input":{"a":"1","b":"2"},"workflow":{"workflowID":"${'ab'.repeat(32)}"}}}`,
    )
  })

  test('builds a header.payload.signature JWT whose signature recovers the authorized address', async () => {
    const key = generatePrivateKey()
    const jwt = await createJwt(request, key, 1_800_000_000)
    const [h, p, s] = jwt.split('.')
    expect(decode(h)).toEqual({ alg: 'ETH', typ: 'JWT' })
    const payload = decode(p)
    expect(payload.iss).toBe(privateKeyToAccount(key).address)
    expect(payload.exp - payload.iat).toBe(300)
    expect(payload.digest).toBe(`0x${createHash('sha256').update(stableStringify(request)).digest('hex')}`)

    const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    expect(sig.length).toBe(65)
    const hex = `0x${sig.subarray(0, 64).toString('hex')}${(sig[64] + 27).toString(16)}` as Hex
    const recovered = await recoverAddress({ hash: hashMessage(`${h}.${p}`), signature: hex })
    expect(recovered).toBe(privateKeyToAccount(key).address)
  })
})
