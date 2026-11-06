import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTVerifyGetKey } from 'jose'
import {
  CALLBACK_PATH,
  ConfigError,
  ISSUER,
  ORB_ACR,
  SESSION_COOKIE,
  createWorldAuth,
  loadConfig,
  parseCookies,
  type WorldDeps,
} from './worldAuth'

const ENV = {
  WORLD_ID_CLIENT_ID: 'app_test_client',
  WORLD_ID_CLIENT_SECRET: 'test-client-secret-value',
  WORLD_ID_REDIRECT_URI: `https://demo.ngrok.app${CALLBACK_PATH}`,
  WORLD_ID_SESSION_SECRET: 'x'.repeat(48),
}
const T0 = 1_800_000_000

const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/api/v1/authorize`,
  token_endpoint: `${ISSUER}/api/v1/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
  code_challenge_methods_supported: ['S256'],
}

type Harness = Awaited<ReturnType<typeof harness>>

/** A fake World IdP: discovery, a token endpoint, and a local signing key behind the JWKS. */
async function harness(opts: { now?: () => number } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
  const keys: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] })
  const calls: { url: string; init?: RequestInit }[] = []
  let idToken = ''
  let tokenStatus = 200
  const clock = { now: T0 }
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/.well-known/openid-configuration')) return Promise.resolve(Response.json(DISCOVERY))
    if (url === DISCOVERY.token_endpoint) {
      return Promise.resolve(Response.json(tokenStatus === 200 ? { id_token: idToken, access_token: 'opaque', token_type: 'Bearer' } : { error: 'invalid_grant' }, { status: tokenStatus }))
    }
    return Promise.reject(new Error('unexpected fetch'))
  }) as typeof fetch
  const deps: WorldDeps = { fetch: fakeFetch, now: opts.now ?? (() => clock.now), keysFor: () => keys }
  const auth = createWorldAuth(loadConfig(ENV), deps)

  const claims = (over: Record<string, unknown> = {}, nonce = '') => ({
    nonce,
    acr: ORB_ACR,
    amr: ['pop'],
    auth_time: clock.now,
    ...over,
  })
  const signIdToken = (payload: Record<string, unknown>, o: { aud?: string; iss?: string; exp?: number; alg?: 'RS256' | 'HS256' } = {}) => {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: 'k1' })
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(o.aud ?? ENV.WORLD_ID_CLIENT_ID)
      .setSubject('opaque-subject-123')
      .setIssuedAt(clock.now)
      .setExpirationTime(o.exp ?? clock.now + 300)
    return o.alg === 'HS256' ? jwt.sign(new TextEncoder().encode('h'.repeat(48))) : jwt.sign(privateKey)
  }
  return {
    auth,
    calls,
    clock,
    claims,
    signIdToken,
    setIdToken: (t: string) => (idToken = t),
    setTokenStatus: (s: number) => (tokenStatus = s),
  }
}

/** Starts an attempt and returns what the browser would hold: the cookie jar and the authorization URL. */
async function begin(h: Harness) {
  const { location, setCookies } = await h.auth.startLogin()
  const jar: Record<string, string> = {}
  for (const c of setCookies) {
    const [pair] = c.split(';')
    const at = pair.indexOf('=')
    jar[pair.slice(0, at)] = pair.slice(at + 1)
  }
  return { url: new URL(location), jar, setCookies }
}

const callback = (query: Record<string, string>) => new URL(`http://127.0.0.1:3001${CALLBACK_PATH}?${new URLSearchParams(query)}`)
const tokenCalls = (h: Harness) => h.calls.filter((c) => c.url === DISCOVERY.token_endpoint)

describe('configuration', () => {
  test('accepts the four variables and derives the app origin from the redirect URI', () => {
    const cfg = loadConfig(ENV)
    expect(cfg.appOrigin).toBe('https://demo.ngrok.app')
    expect(cfg.redirectUri).toBe(ENV.WORLD_ID_REDIRECT_URI)
  })

  test('reports only variable names for missing or malformed values', () => {
    for (const bad of [
      { ...ENV, WORLD_ID_CLIENT_ID: '' },
      { ...ENV, WORLD_ID_CLIENT_SECRET: undefined },
      { ...ENV, WORLD_ID_SESSION_SECRET: 'short' },
      { ...ENV, WORLD_ID_REDIRECT_URI: 'https://demo.ngrok.app/other' },
      { ...ENV, WORLD_ID_REDIRECT_URI: `http://demo.ngrok.app${CALLBACK_PATH}` },
      { ...ENV, WORLD_ID_REDIRECT_URI: `https://demo.ngrok.app${CALLBACK_PATH}?x=1` },
      { ...ENV, WORLD_ID_REDIRECT_URI: 'not a url' },
    ]) {
      try {
        loadConfig(bad)
        throw new Error('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        const text = JSON.stringify((err as ConfigError).variables) + (err as Error).message
        expect(text).not.toContain('test-client-secret-value')
        expect(text).not.toContain('x'.repeat(40))
      }
    }
  })

  test('allows http only for localhost', () => {
    expect(loadConfig({ ...ENV, WORLD_ID_REDIRECT_URI: `http://localhost:5173${CALLBACK_PATH}` }).appOrigin).toBe('http://localhost:5173')
  })
})

describe('authorization request', () => {
  test('carries prompt=login, max_age=0, the Orb acr_values and the essential Orb claim', async () => {
    const h = await harness()
    const { url } = await begin(h)
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint)
    const q = url.searchParams
    expect(q.get('client_id')).toBe(ENV.WORLD_ID_CLIENT_ID)
    expect(q.get('redirect_uri')).toBe(ENV.WORLD_ID_REDIRECT_URI)
    expect(q.get('response_type')).toBe('code')
    expect(q.get('response_mode')).toBe('query')
    expect(q.get('scope')).toBe('openid')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('prompt')).toBe('login')
    expect(q.get('max_age')).toBe('0')
    expect(q.get('acr_values')).toBe('https://world.org/oidc/acr/orb')
    expect(JSON.parse(q.get('claims') ?? '')).toEqual({
      id_token: { acr: { essential: true, values: ['https://world.org/oidc/acr/orb'] } },
    })
    // The raw query string really contains those parameters, not just the parsed view.
    expect(url.search).toContain('prompt=login')
    expect(url.search).toContain('max_age=0')
    expect(url.search).toContain('acr_values=https%3A%2F%2Fworld.org%2Foidc%2Facr%2Forb')
  })

  test('uses a fresh state, nonce and verifier per attempt and an S256 challenge of the verifier', async () => {
    const h = await harness()
    const a = await begin(h)
    const b = await begin(h)
    for (const name of ['world_oidc_state', 'world_oidc_nonce', 'world_oidc_verifier']) {
      expect(a.jar[name]).not.toBe(b.jar[name])
      expect(a.jar[name].length).toBeGreaterThanOrEqual(43)
    }
    expect(a.url.searchParams.get('state')).toBe(a.jar.world_oidc_state)
    expect(a.url.searchParams.get('nonce')).toBe(a.jar.world_oidc_nonce)
    expect(a.url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(a.jar.world_oidc_verifier).digest('base64url'))
    expect(a.url.toString()).not.toContain(a.jar.world_oidc_verifier) // the verifier never goes in the URL
    expect(a.url.toString()).not.toContain(ENV.WORLD_ID_CLIENT_SECRET)
  })

  test('stores attempt data only in short-lived HttpOnly, Secure, SameSite=Lax cookies', async () => {
    const { setCookies } = await begin(await harness())
    expect(setCookies).toHaveLength(5)
    for (const cookie of setCookies) {
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Max-Age=600')
    }
  })
})

describe('callback', () => {
  async function attempt(h: Harness) {
    const started = await begin(h)
    const state = started.jar.world_oidc_state
    const nonce = started.jar.world_oidc_nonce
    return { ...started, state, nonce }
  }

  test('signs in with a valid Orb ID token and stores (iss, sub) in a signed HttpOnly session cookie', async () => {
    const h = await harness()
    const a = await attempt(h)
    h.setIdToken(await h.signIdToken(h.claims({}, a.nonce)))
    const out = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'abc' }), a.jar)
    expect(out.location).toBe('https://demo.ngrok.app/')
    const session = out.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    expect(session).toBeDefined()
    expect(session).toContain('HttpOnly')
    expect(session).toContain('Secure')
    expect(session).toContain('SameSite=Lax')
    // One-time attempt cookies are cleared.
    expect(out.setCookies.filter((c) => c.includes('Max-Age=0')).length).toBe(5)

    const jar = parseCookies(session?.split(';')[0])
    const read = await h.auth.readSession(jar)
    expect(read?.iss).toBe(ISSUER)
    expect(read?.sub).toBe('opaque-subject-123')
    expect(read?.acr).toBe(ORB_ACR)
  })

  test('redeems the code with client_secret_basic, the PKCE verifier and the registered redirect URI', async () => {
    const h = await harness()
    const a = await attempt(h)
    h.setIdToken(await h.signIdToken(h.claims({}, a.nonce)))
    await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'the-code' }), a.jar)
    const [call] = tokenCalls(h)
    const headers = call.init?.headers as Record<string, string>
    const basic = Buffer.from(headers.Authorization.replace('Basic ', ''), 'base64').toString()
    expect(basic).toBe(`${ENV.WORLD_ID_CLIENT_ID}:${ENV.WORLD_ID_CLIENT_SECRET}`)
    const body = new URLSearchParams(String(call.init?.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('code_verifier')).toBe(a.jar.world_oidc_verifier)
    expect(body.get('redirect_uri')).toBe(ENV.WORLD_ID_REDIRECT_URI)
    expect(body.get('client_secret')).toBeNull() // never in the body with client_secret_basic
  })

  test('rejects a wrong or missing callback iss before any token exchange', async () => {
    for (const iss of ['https://evil.example', 'https://auth.world.org/', undefined]) {
      const h = await harness()
      const a = await attempt(h)
      const q: Record<string, string> = { state: a.state, code: 'abc' }
      if (iss) q.iss = iss
      const out = await h.auth.handleCallback(callback(q), a.jar)
      expect(out.location).toBe('https://demo.ngrok.app/?auth_error=issuer_mismatch')
      expect(tokenCalls(h)).toHaveLength(0)
    }
  })

  test('rejects a state that does not match the cookie before any token exchange', async () => {
    const h = await harness()
    const a = await attempt(h)
    for (const jar of [a.jar, {}, { ...a.jar, world_oidc_state: 'other' }]) {
      const out = await h.auth.handleCallback(callback({ iss: ISSUER, state: 'forged', code: 'abc' }), jar)
      expect(out.location).toContain('auth_error=state_mismatch')
    }
    expect(tokenCalls(h)).toHaveLength(0)
  })

  test('rejects a forged freshness cookie and an expired attempt', async () => {
    const h = await harness()
    const a = await attempt(h)
    const forged = await h.auth.handleCallback(
      callback({ iss: ISSUER, state: a.state, code: 'abc' }),
      { ...a.jar, world_oidc_started: `${T0 - 5000}.AAAA` },
    )
    expect(forged.location).toContain('auth_error=state_mismatch')
    h.clock.now = T0 + 601
    const late = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'abc' }), a.jar)
    expect(late.location).toContain('auth_error=attempt_expired')
    expect(tokenCalls(h)).toHaveLength(0)
  })

  test('maps provider errors to a fixed vocabulary without echoing them', async () => {
    const h = await harness()
    const a = await attempt(h)
    const denied = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, error: 'access_denied', error_description: '<script>' }), a.jar)
    expect(denied.location).toBe('https://demo.ngrok.app/?auth_error=access_denied')
    const unmet = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, error: 'unmet_authentication_requirements' }), a.jar)
    expect(unmet.location).toContain('auth_error=insufficient_assurance')
    const other = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, error: 'server_error', error_description: 'secret?' }), a.jar)
    expect(other.location).toBe('https://demo.ngrok.app/?auth_error=authorization_failed')
    expect(tokenCalls(h)).toHaveLength(0)
  })

  test('rejects an ID token whose acr is not exactly the Orb class', async () => {
    for (const acr of ['https://world.org/oidc/acr/selfie', 'https://world.org/oidc/acr/orb-face', 'https://world.org/oidc/acr/orb ', undefined]) {
      const h = await harness()
      const a = await attempt(h)
      h.setIdToken(await h.signIdToken(h.claims({ acr }, a.nonce)))
      const out = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'abc' }), a.jar)
      expect(out.location).toContain('auth_error=insufficient_assurance')
      expect(out.setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes('Max-Age=0'))).toBe(false)
    }
  })

  test('rejects wrong nonce, audience, issuer, expiry, algorithm and signing key', async () => {
    const cases: [string, (h: Harness, nonce: string) => Promise<string>][] = [
      ['nonce', (h) => h.signIdToken(h.claims({}, 'a-different-nonce'))],
      ['missing nonce', (h) => h.signIdToken(h.claims({ nonce: undefined }))],
      ['audience', (h, n) => h.signIdToken(h.claims({}, n), { aud: 'someone-else' })],
      ['issuer', (h, n) => h.signIdToken(h.claims({}, n), { iss: 'https://evil.example' })],
      ['expired', (h, n) => h.signIdToken(h.claims({}, n), { exp: T0 - 120 })],
      ['HS256', (h, n) => h.signIdToken(h.claims({}, n), { alg: 'HS256' })],
      ['unknown key', async (h, n) => {
        const other = await generateKeyPair('RS256')
        return new SignJWT(h.claims({}, n)).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setAudience(ENV.WORLD_ID_CLIENT_ID).setSubject('s').setIssuedAt(T0).setExpirationTime(T0 + 300).sign(other.privateKey)
      }],
    ]
    for (const [name, build] of cases) {
      const h = await harness()
      const a = await attempt(h)
      h.setIdToken(await build(h, a.nonce))
      const out = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'abc' }), a.jar)
      expect(`${name}: ${out.location}`).toBe(`${name}: https://demo.ngrok.app/?auth_error=invalid_id_token`)
    }
  })

  test('rejects an authentication that predates this attempt (max_age=0) and one from the future', async () => {
    for (const authTime of [T0 - 3600, T0 + 3600]) {
      const h = await harness()
      const a = await attempt(h)
      h.setIdToken(await h.signIdToken(h.claims({ auth_time: authTime }, a.nonce)))
      const out = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'abc' }), a.jar)
      expect(out.location).toContain('auth_error=invalid_id_token')
    }
    const h = await harness()
    const a = await attempt(h)
    h.setIdToken(await h.signIdToken(h.claims({ auth_time: undefined }, a.nonce)))
    const missing = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'abc' }), a.jar)
    expect(missing.location).toContain('auth_error=invalid_id_token')
  })

  test('a failed code exchange signs nobody in', async () => {
    const h = await harness()
    const a = await attempt(h)
    h.setTokenStatus(400)
    const out = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.state, code: 'used' }), a.jar)
    expect(out.location).toContain('auth_error=token_exchange_failed')
  })

  test('redirects use the redirect URI origin, never the request URL', async () => {
    const h = await harness()
    const a = await attempt(h)
    const out = await h.auth.handleCallback(new URL(`http://localhost:9999${CALLBACK_PATH}?iss=bad`), a.jar)
    expect(out.location.startsWith('https://demo.ngrok.app/')).toBe(true)
  })
})

describe('app session', () => {
  async function signedIn() {
    const h = await harness()
    const a = await begin(h)
    h.setIdToken(await h.signIdToken(h.claims({}, a.jar.world_oidc_nonce)))
    const out = await h.auth.handleCallback(callback({ iss: ISSUER, state: a.jar.world_oidc_state, code: 'abc' }), a.jar)
    const cookie = out.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes('Max-Age=0')) ?? ''
    return { h, value: cookie.split(';')[0].slice(SESSION_COOKIE.length + 1) }
  }

  test('is short lived', async () => {
    const { h, value } = await signedIn()
    expect(await h.auth.readSession({ [SESSION_COOKIE]: value })).not.toBeNull()
    h.clock.now = T0 + 1801
    expect(await h.auth.readSession({ [SESSION_COOKIE]: value })).toBeNull()
  })

  test('rejects tampered, unsigned and foreign tokens', async () => {
    const { h, value } = await signedIn()
    const [head, body, sig] = value.split('.')
    expect(await h.auth.readSession({ [SESSION_COOKIE]: `${head}.${body}.${sig.slice(0, -2)}AA` })).toBeNull()
    expect(await h.auth.readSession({ [SESSION_COOKIE]: `${head}.${Buffer.from('{"world":{"iss":"x","sub":"y"}}').toString('base64url')}.${sig}` })).toBeNull()
    expect(await h.auth.readSession({ [SESSION_COOKIE]: 'garbage' })).toBeNull()
    expect(await h.auth.readSession({})).toBeNull()
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${body}.`
    expect(await h.auth.readSession({ [SESSION_COOKIE]: unsigned })).toBeNull()
  })

  test('sign-out clears only the app session cookie', async () => {
    const { h } = await signedIn()
    const cleared = h.auth.signOutCookies()
    expect(cleared).toHaveLength(1)
    expect(cleared[0]).toContain(`${SESSION_COOKIE}=;`)
    expect(cleared[0]).toContain('Max-Age=0')
  })
})

describe('creator commitment', () => {
  test('is a stable one-way commitment keyed on (iss, sub), never on sub alone', async () => {
    const { creatorCommitment } = await import('./worldAuth')
    const a = creatorCommitment('https://auth.world.org', 'sub-1')
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
    expect(creatorCommitment('https://auth.world.org', 'sub-1')).toBe(a)
    expect(creatorCommitment('https://auth.world.org', 'sub-2')).not.toBe(a)
    expect(creatorCommitment('https://other.example', 'sub-1')).not.toBe(a)
    expect(a).not.toContain('sub-1')
  })
})
