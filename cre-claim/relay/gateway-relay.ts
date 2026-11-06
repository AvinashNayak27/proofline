// Signing relay for DEPLOYED HTTP-triggered workflows.
//
// A deployed CRE HTTP trigger only accepts requests signed by an authorized EVM key (JSON-RPC
// "workflows.execute" with an ETH-signed JWT). A browser must never hold that key, so the browser
// posts to this relay (through the Vite proxy) and the relay signs and forwards, following the
// official flow: https://docs.chain.link/cre/guides/workflow/using-triggers/http-trigger/triggering-deployed-workflows
//
//   CRE_TRIGGER_PRIVATE_KEY   the authorized key (its address must be in config authorizedKeys). Read from the
//                             environment only; never printed, logged or written anywhere.
//   CRE_GATEWAY_URL           gateway for your CRE environment (`cre whoami` shows the environment)
//   CRE_WORKFLOW_ID           64 hex chars, no 0x prefix (printed by `cre workflow deploy`)
//   RELAY_PORT                default 2001
//
//   CRE_TRIGGER_URL=http://127.0.0.1:2001 bun run dev        # point the Vite proxy at the relay
//   bun run cre:relay
//
// The relay logs only status lines. It never logs request bodies, tokens or gateway payloads.
import { createHash, randomUUID } from 'node:crypto'
import { parseSignature, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ALLOWED_KEYS = ['encryptedSessionMaterial', 'wallet', 'nonce', 'expiry', 'signature']
const MAX_BODY_BYTES = 16 * 1024

/** JSON with keys sorted at every level and no whitespace, as the gateway digest requires. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

export type RpcRequest = {
  jsonrpc: '2.0'
  id: string
  method: 'workflows.execute'
  params: { input: Record<string, unknown>; workflow: { workflowID: string } }
}

export async function createJwt(request: RpcRequest, privateKey: Hex, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const account = privateKeyToAccount(privateKey)
  const header = { alg: 'ETH', typ: 'JWT' }
  const payload = {
    digest: `0x${createHash('sha256').update(stableStringify(request)).digest('hex')}`,
    iss: account.address,
    iat: nowSeconds,
    exp: nowSeconds + 300, // the gateway allows at most 5 minutes
    jti: randomUUID(),
  }
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`
  const signature = await account.signMessage({ message: signingInput })
  const { r, s, v, yParity } = parseSignature(signature)
  const recovery = v !== undefined ? (v >= 27n ? v - 27n : v) : BigInt(yParity ?? 0)
  const bytes = Buffer.concat([
    Buffer.from(r.slice(2).padStart(64, '0'), 'hex'),
    Buffer.from(s.slice(2).padStart(64, '0'), 'hex'),
    Buffer.from([Number(recovery)]),
  ])
  return `${signingInput}.${b64url(bytes)}`
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is not set`)
    process.exit(1)
  }
  return value
}

function isClaimInput(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === ALLOWED_KEYS.length &&
    keys.every((k) => ALLOWED_KEYS.includes(k) && typeof (value as Record<string, unknown>)[k] === 'string')
  )
}

if (import.meta.main) {
  const privateKey = requireEnv('CRE_TRIGGER_PRIVATE_KEY') as Hex
  const gatewayUrl = requireEnv('CRE_GATEWAY_URL')
  const workflowId = requireEnv('CRE_WORKFLOW_ID')
  if (!/^[0-9a-fA-F]{64}$/.test(workflowId)) {
    console.error('CRE_WORKFLOW_ID must be 64 hex characters without 0x')
    process.exit(1)
  }
  const port = Number(process.env.RELAY_PORT ?? 2001)

  Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/health') return new Response('OK')
      if (url.pathname !== '/trigger' || req.method !== 'POST') return new Response('Not found', { status: 404 })
      const length = Number(req.headers.get('content-length') ?? 0)
      if (length > MAX_BODY_BYTES) return Response.json({ ok: false }, { status: 413 })

      let input: unknown
      try {
        input = ((await req.json()) as { input?: unknown }).input
      } catch {
        return Response.json({ ok: false }, { status: 400 })
      }
      if (!isClaimInput(input)) return Response.json({ ok: false }, { status: 400 })

      const rpc: RpcRequest = {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'workflows.execute',
        params: { input, workflow: { workflowID: workflowId } },
      }
      try {
        const jwt = await createJwt(rpc, privateKey)
        const res = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify(rpc),
        })
        const json = (await res.json().catch(() => null)) as { result?: { workflow_execution_id?: string; status?: string } } | null
        console.log(`gateway responded ${res.status}`)
        if (!res.ok) return Response.json({ ok: false }, { status: 502 })
        return Response.json({ ok: true, executionId: json?.result?.workflow_execution_id, status: json?.result?.status })
      } catch {
        console.log('gateway request failed')
        return Response.json({ ok: false }, { status: 502 })
      }
    },
  })
  console.log(`CRE trigger relay listening on http://127.0.0.1:${port}`)
}
