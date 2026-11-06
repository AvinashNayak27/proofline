// Proofline server. Runs next to Vite (`bun run server`); Vite proxies /api here.
//
//   GET  /api/auth/world/login      starts World ID sign-in (redirects to World)
//   GET  /api/auth/world/callback   exact callback path to register in the World ID developer portal
//   GET  /api/auth/session          who is signed in (never returns tokens)
//   POST /api/auth/signout          clears this app's session cookie only
//   POST /api/claims                submits a creator's post to the CRE workflow, only for a World ID session
//
// Secrets (WORLD_ID_CLIENT_SECRET, WORLD_ID_SESSION_SECRET) come from the environment and exist only
// in this process. This file never logs request bodies, cookies, codes, tokens or headers.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAddress, type Address } from 'viem'
import { requiredTagFor } from './campaignChain'
import { allCampaigns, allRewards, rewardsForWallet } from './rewardsSubgraph'
import { ConfigError, createWorldAuth, loadConfig, parseCookies, type AuthErrorCode, type WorldAuth } from './worldAuth'

const PORT = Number(process.env.AUTH_SERVER_PORT ?? 3001)
const CRE_TRIGGER_URL = (process.env.CRE_TRIGGER_URL ?? 'http://127.0.0.1:2000').replace(/\/+$/, '')
const MAX_BODY_BYTES = 64 * 1024
const TRIGGER_TIMEOUT_MS = 150_000
const PROOFLINE_CONTRACT = process.env.VITE_PROOFLINE_CONTRACT
const PROOFLINE_DEPLOY_BLOCK = process.env.VITE_PROOFLINE_DEPLOY_BLOCK
const CLAIM_FIELDS = ['campaignId', 'postUrl', 'wallet', 'nonce', 'expiry', 'signature', 'encryptedSessionMaterial']
const MAX_QUEUED_CLAIMS = 4
const CLAIM_COOLDOWN_MS = 8_000

// Claims run one at a time (each is a full enclave simulation). A creator may have one in flight and
// must wait a few seconds between attempts, so one account cannot hold the queue.
let queuedClaims = 0
const busyCreators = new Map<string, number>()

type Auth = { ok: true; auth: WorldAuth } | { ok: false; variables: string[] }

function setup(): Auth {
  try {
    return { ok: true, auth: createWorldAuth(loadConfig(process.env)) }
  } catch (err) {
    if (err instanceof ConfigError) return { ok: false, variables: err.variables }
    throw err
  }
}

const state = setup()
if (!state.ok) {
  console.warn(`World ID is not configured. Missing or invalid: ${state.variables.join(', ')}`)
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function redirect(res: ServerResponse, location: string, setCookies: string[]): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': setCookies })
  res.end()
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

/** Mutating requests must come from the app's own origin when the browser sends an Origin header. */
const sameOrigin = (req: IncomingMessage, appOrigin: string): boolean => {
  const origin = req.headers.origin
  return origin === undefined || origin === appOrigin
}

const subjectPreview = (sub: string): string => (sub.length <= 12 ? sub : `${sub.slice(0, 6)}…${sub.slice(-4)}`)

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // The host header can be localhost behind a reverse proxy, so only path and query are used from the URL.
  const url = new URL(req.url ?? '/', 'http://internal.invalid')
  const path = url.pathname
  const method = req.method ?? 'GET'

  if (path === '/health') return send(res, 200, { ok: true })

  if (path === '/api/auth/session' && method === 'GET') {
    if (!state.ok) return send(res, 200, { authenticated: false, configured: false })
    const session = await state.auth.readSession(parseCookies(req.headers.cookie))
    if (!session) return send(res, 200, { authenticated: false, configured: true })
    return send(res, 200, {
      authenticated: true,
      configured: true,
      issuer: session.iss,
      subjectPreview: subjectPreview(session.sub),
      creatorCommitment: session.creatorCommitment,
      acr: session.acr,
      expiresAt: session.expiresAt,
    })
  }

  if (path === '/api/rewards' && method === 'GET') {
    const recipient = url.searchParams.get('recipient')
    if (recipient && !isAddress(recipient)) return send(res, 400, { ok: false, error: 'invalid_recipient' })
    if (!PROOFLINE_CONTRACT || !isAddress(PROOFLINE_CONTRACT) || !/^[0-9]{1,12}$/.test(PROOFLINE_DEPLOY_BLOCK ?? '')) {
      return send(res, 503, { ok: false, error: 'not_configured' })
    }
    try {
      const rewards = recipient ? await rewardsForWallet(recipient as Address) : await allRewards()
      return send(res, 200, { ok: true, rewards })
    } catch {
      return send(res, 502, { ok: false, error: 'subgraph_unavailable' })
    }
  }

  if (path === '/api/campaigns' && method === 'GET') {
    try {
      return send(res, 200, { ok: true, campaigns: await allCampaigns() })
    } catch {
      return send(res, 502, { ok: false, error: 'subgraph_unavailable' })
    }
  }

  if (path === '/api/auth/world/login' && method === 'GET') {
    if (!state.ok) return send(res, 503, { error: 'not_configured', variables: state.variables })
    try {
      const { location, setCookies } = await state.auth.startLogin()
      return redirect(res, location, setCookies)
    } catch {
      const code: AuthErrorCode = 'service_unavailable'
      return redirect(res, `${state.auth.appOrigin}/?auth_error=${code}`, [])
    }
  }

  if (path === '/api/auth/world/callback' && method === 'GET') {
    if (!state.ok) return send(res, 503, { error: 'not_configured', variables: state.variables })
    const { location, setCookies } = await state.auth.handleCallback(url, parseCookies(req.headers.cookie))
    return redirect(res, location, setCookies)
  }

  if (path === '/api/auth/signout' && method === 'POST') {
    if (!state.ok) return send(res, 200, { ok: true })
    if (!sameOrigin(req, state.auth.appOrigin)) return send(res, 403, { error: 'forbidden' })
    // Clears only this app's session. It does not, and cannot, end the World ID browser session.
    return send(res, 200, { ok: true }, { 'Set-Cookie': state.auth.signOutCookies() })
  }

  if (path === '/api/claims' && method === 'POST') {
    if (!state.ok) return send(res, 401, { error: 'world_id_required' })
    if (!sameOrigin(req, state.auth.appOrigin)) return send(res, 403, { error: 'forbidden' })
    const session = await state.auth.readSession(parseCookies(req.headers.cookie))
    if (!session) return send(res, 401, { error: 'world_id_required' })
    const body = await readBody(req)
    if (body === null) return send(res, 413, { ok: false })

    let input: Record<string, string>
    try {
      const parsed: unknown = (JSON.parse(body) as { input?: unknown }).input
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape')
      const keys = Object.keys(parsed)
      const record = parsed as Record<string, unknown>
      if (keys.length !== CLAIM_FIELDS.length || !keys.every((k) => CLAIM_FIELDS.includes(k) && typeof record[k] === 'string')) {
        throw new Error('shape')
      }
      input = record as Record<string, string>
    } catch {
      return send(res, 400, { ok: false, error: 'invalid_request' })
    }
    if (!PROOFLINE_CONTRACT || !isAddress(PROOFLINE_CONTRACT) || !/^[0-9]{1,12}$/.test(PROOFLINE_DEPLOY_BLOCK ?? '')) {
      return send(res, 503, { ok: false, error: 'not_configured' })
    }
    if (!/^[1-9][0-9]{0,17}$/.test(input.campaignId)) return send(res, 400, { ok: false, error: 'invalid_request' })

    const last = busyCreators.get(session.creatorCommitment) ?? 0
    if (last === Infinity || Date.now() - last < CLAIM_COOLDOWN_MS) return send(res, 429, { ok: false, error: 'slow_down' })
    if (queuedClaims >= MAX_QUEUED_CLAIMS) return send(res, 503, { ok: false, error: 'busy' })
    busyCreators.set(session.creatorCommitment, Infinity)
    queuedClaims += 1
    try {
      let requiredTag: string
      try {
        requiredTag = await requiredTagFor(PROOFLINE_CONTRACT, BigInt(PROOFLINE_DEPLOY_BLOCK as string), BigInt(input.campaignId))
      } catch {
        return send(res, 502, { ok: false, error: 'campaign_unreadable' })
      }
      // The commitment and tag come from this server, never from the browser.
      const payload = { ...input, creatorCommitment: session.creatorCommitment, requiredTag }
      const upstream = await fetch(`${CRE_TRIGGER_URL}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: payload }),
        redirect: 'error',
        signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
      })
      const text = await upstream.text()
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      })
      return void res.end(text)
    } catch {
      return send(res, 502, { ok: false, error: 'bridge_unreachable' })
    } finally {
      queuedClaims -= 1
      busyCreators.set(session.creatorCommitment, Date.now())
    }
  }

  return send(res, 404, { error: 'not_found' })
}

createServer((req, res) => {
  route(req, res).catch(() => {
    if (!res.headersSent) send(res, 500, { error: 'server_error' })
    else res.end()
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`auth server on http://127.0.0.1:${PORT} (World ID ${state.ok ? 'configured' : 'not configured'})`)
})
