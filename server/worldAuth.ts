// World ID sign-in for this app: OIDC Authorization Code Flow with S256 PKCE, server side only.
//
// This module owns every secret-handling step: the client secret, the PKCE verifier, the token
// exchange, ID token validation and the app session. Nothing here is imported by browser code.
// It never logs, and no error it throws or returns carries a token, code, verifier or secret.
//
// Docs followed: https://auth.world.org/docs/guides/{getting-started,oidc,step-up,id-token,testing}
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem'
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose'

export const ISSUER = 'https://auth.world.org'
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`
export const CALLBACK_PATH = '/api/auth/world/callback'
export const ORB_ACR = 'https://world.org/oidc/acr/orb'

export const SESSION_COOKIE = 'world_session'
export const OIDC_COOKIES = {
  state: 'world_oidc_state',
  nonce: 'world_oidc_nonce',
  verifier: 'world_oidc_verifier',
  started: 'world_oidc_started',
  returnTo: 'world_oidc_return_to',
} as const

/** A sign-in attempt must finish within ten minutes. */
export const ATTEMPT_TTL_SECONDS = 600
/** The app session is deliberately short: thirty minutes, then the person signs in again. */
export const SESSION_TTL_SECONDS = 1800
const CLOCK_TOLERANCE_SECONDS = 30
const DISCOVERY_TTL_MS = 60 * 60 * 1000
const HTTP_TIMEOUT_MS = 10_000

const SESSION_ISSUER = 'arc-claim-app'
const SESSION_AUDIENCE = 'arc-claim-app:session'

/** Fixed vocabulary shown to the user as `?auth_error=<code>`. Never echoes provider text. */
export type AuthErrorCode =
  | 'access_denied'
  | 'authorization_failed'
  | 'invalid_callback'
  | 'issuer_mismatch'
  | 'state_mismatch'
  | 'attempt_expired'
  | 'service_unavailable'
  | 'token_exchange_failed'
  | 'invalid_id_token'
  | 'insufficient_assurance'

export class ConfigError extends Error {
  /** Names of the environment variables that are missing or malformed. Never their values. */
  readonly variables: string[]
  constructor(variables: string[]) {
    super('World ID is not configured')
    this.variables = variables
  }
}

export type WorldConfig = {
  clientId: string
  clientSecret: string
  /** Exact registered callback URL. */
  redirectUri: string
  /** Origin of the redirect URI. Every redirect back into the app is built from this, never from request.url. */
  appOrigin: string
  sessionSecret: string
}

type Env = Record<string, string | undefined>

/** Reads WORLD_ID_CLIENT_ID, WORLD_ID_CLIENT_SECRET, WORLD_ID_REDIRECT_URI and WORLD_ID_SESSION_SECRET. */
export function loadConfig(env: Env): WorldConfig {
  const bad: string[] = []
  const clientId = env.WORLD_ID_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.WORLD_ID_CLIENT_SECRET?.trim() ?? ''
  const redirectUri = env.WORLD_ID_REDIRECT_URI?.trim() ?? ''
  const sessionSecret = env.WORLD_ID_SESSION_SECRET?.trim() ?? ''
  if (!clientId) bad.push('WORLD_ID_CLIENT_ID')
  if (!clientSecret) bad.push('WORLD_ID_CLIENT_SECRET')
  if (sessionSecret.length < 32) bad.push('WORLD_ID_SESSION_SECRET')

  let appOrigin = ''
  try {
    const url = new URL(redirectUri)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && local)
    if (!schemeOk || url.pathname !== CALLBACK_PATH || url.search || url.hash || url.username || url.password) {
      bad.push('WORLD_ID_REDIRECT_URI')
    } else {
      appOrigin = url.origin
    }
  } catch {
    bad.push('WORLD_ID_REDIRECT_URI')
  }
  if (bad.length > 0) throw new ConfigError(bad)
  return { clientId, clientSecret, redirectUri, appOrigin, sessionSecret }
}

// ---------------------------------------------------------------- small helpers

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at < 1) continue
    const name = part.slice(0, at).trim()
    if (!(name in out)) out[name] = part.slice(at + 1).trim()
  }
  return out
}

/**
 * Always HttpOnly, Secure and SameSite=Lax. Path is "/" so the cookie also survives reverse proxies
 * (such as the Arc Studio preview or ngrok) that rewrite cookie scope.
 */
export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const expires = maxAgeSeconds <= 0 ? '; Expires=Thu, 01 Jan 1970 00:00:00 GMT' : ''
  return `${name}=${value}; Max-Age=${Math.max(0, maxAgeSeconds)}${expires}; Path=/; HttpOnly; Secure; SameSite=Lax`
}

const clearOidcCookies = (): string[] => Object.values(OIDC_COOKIES).map((name) => serializeCookie(name, '', 0))

/** application/x-www-form-urlencoded encoding of a single value, as RFC 6749 section 2.3.1 requires for Basic credentials. */
const formEncode = (value: string): string => new URLSearchParams({ v: value }).toString().slice(2)

// ---------------------------------------------------------------- authorization request

export type AuthorizationParams = {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
}

/** The essential ID-token acr claim: the result must be an Orb class or the request fails. */
export const ORB_CLAIMS = JSON.stringify({ id_token: { acr: { essential: true, values: [ORB_ACR] } } })

/**
 * Builds the authorization request. Fresh login every time (prompt=login, max_age=0), Orb accounts
 * only (acr_values and an essential acr claim), S256 PKCE, query response mode.
 */
export function buildAuthorizationUrl(authorizationEndpoint: string, p: AuthorizationParams): string {
  const url = new URL(authorizationEndpoint)
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid',
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'login',
    max_age: '0',
    acr_values: ORB_ACR,
    claims: ORB_CLAIMS,
  }).toString()
  return url.toString()
}

// ---------------------------------------------------------------- discovery

type Discovery = { authorizationEndpoint: string; tokenEndpoint: string; keys: JWTVerifyGetKey }

export type WorldDeps = {
  fetch: typeof fetch
  /** Unix time in seconds. */
  now: () => number
  /** Builds the key resolver for the discovered jwks_uri. Production: jose's remote JWKS with caching. */
  keysFor: (jwksUri: string) => JWTVerifyGetKey
}

export const defaultDeps: WorldDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Math.floor(Date.now() / 1000),
  keysFor: (jwksUri) => createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: HTTP_TIMEOUT_MS }),
}

const isHttpsOnIssuer = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).origin === ISSUER
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- app session

export type WorldSession = {
  iss: string
  sub: string
  /** Opaque, stable commitment to (issuer, subject). This is what the contract keys creator caps on. */
  creatorCommitment: `0x${string}`
  acr: string
  amr: string[]
  authTime: number
  expiresAt: number
}

/**
 * keccak256(abi.encode("proofline-creator-v1", issuer, subject)). The World ID subject is never
 * shared; only this one-way commitment reaches the workflow and the chain. Always keyed on the pair.
 */
export function creatorCommitment(iss: string, sub: string): `0x${string}` {
  return keccak256(encodeAbiParameters(parseAbiParameters('string tag, string iss, string sub'), ['proofline-creator-v1', iss, sub]))
}

export type Redirect = { location: string; setCookies: string[] }

export function createWorldAuth(config: WorldConfig, deps: WorldDeps = defaultDeps) {
  const sessionKey = new TextEncoder().encode(config.sessionSecret)
  let cached: { at: number; value: Discovery } | undefined

  async function discover(): Promise<Discovery> {
    const nowMs = deps.now() * 1000
    if (cached && nowMs - cached.at < DISCOVERY_TTL_MS) return cached.value
    const res = await deps.fetch(DISCOVERY_URL, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error('discovery failed')
    const doc = (await res.json()) as Record<string, unknown>
    if (doc.issuer !== ISSUER) throw new Error('discovery issuer mismatch')
    const methods = doc.code_challenge_methods_supported
    if (Array.isArray(methods) && !methods.includes('S256')) throw new Error('S256 is not supported')
    if (!isHttpsOnIssuer(doc.authorization_endpoint) || !isHttpsOnIssuer(doc.token_endpoint) || !isHttpsOnIssuer(doc.jwks_uri)) {
      throw new Error('discovery endpoints are not on the issuer')
    }
    const value: Discovery = {
      authorizationEndpoint: doc.authorization_endpoint,
      tokenEndpoint: doc.token_endpoint,
      keys: deps.keysFor(doc.jwks_uri),
    }
    cached = { at: nowMs, value }
    return value
  }

  /** Signs a timestamp together with the state so the freshness anchor cannot be swapped or forged. */
  function signStarted(ts: number, state: string): string {
    const mac = createHmac('sha256', config.sessionSecret).update(`world-oidc-started:${ts}:${state}`).digest('base64url')
    return `${ts}.${mac}`
  }

  function readStarted(value: string | undefined, state: string): number | undefined {
    if (!value) return undefined
    const [ts, mac, extra] = value.split('.')
    if (!ts || !mac || extra !== undefined || !/^[0-9]{1,12}$/.test(ts)) return undefined
    const expected = createHmac('sha256', config.sessionSecret).update(`world-oidc-started:${ts}:${state}`).digest('base64url')
    return safeEqual(mac, expected) ? Number(ts) : undefined
  }

  /** Step 1: fresh state, nonce and PKCE verifier, kept in short-lived cookies; redirect to World. */
  async function startLogin(returnTo = '/'): Promise<Redirect> {
    const discovery = await discover()
    const state = b64url(randomBytes(32))
    const nonce = b64url(randomBytes(32))
    const verifier = b64url(randomBytes(32)) // 43 characters
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
    const location = buildAuthorizationUrl(discovery.authorizationEndpoint, {
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      nonce,
      codeChallenge,
    })
    return {
      location,
      setCookies: [
        serializeCookie(OIDC_COOKIES.state, state, ATTEMPT_TTL_SECONDS),
        serializeCookie(OIDC_COOKIES.nonce, nonce, ATTEMPT_TTL_SECONDS),
        serializeCookie(OIDC_COOKIES.verifier, verifier, ATTEMPT_TTL_SECONDS),
        serializeCookie(OIDC_COOKIES.started, signStarted(deps.now(), state), ATTEMPT_TTL_SECONDS),
        serializeCookie(OIDC_COOKIES.returnTo, encodeURIComponent(returnTo), ATTEMPT_TTL_SECONDS),
      ],
    }
  }

  async function exchangeCode(tokenEndpoint: string, code: string, verifier: string): Promise<string> {
    const basic = Buffer.from(`${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`).toString('base64')
    const res = await deps.fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`, // client_secret_basic
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
      }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error('token exchange failed')
    const body = (await res.json()) as Record<string, unknown>
    const idToken = body.id_token
    if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > 16_384) throw new Error('no id_token')
    return idToken // the access token is never used or kept
  }

  /** Signature, RS256, issuer, audience, expiry, nonce, Orb acr and attempt-bound freshness. */
  async function validateIdToken(idToken: string, keys: JWTVerifyGetKey, nonce: string, startedAt: number) {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: ISSUER,
      audience: config.clientId,
      algorithms: ['RS256'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: new Date(deps.now() * 1000),
      requiredClaims: ['exp', 'iat', 'sub'],
    })
    if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, nonce)) throw new Error('nonce mismatch')
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 256) throw new Error('bad sub')
    if (payload.acr !== ORB_ACR) throw new AssuranceError()
    // max_age=0: the authentication must belong to this attempt, not an earlier World session.
    const authTime = payload.auth_time
    if (typeof authTime !== 'number' || !Number.isFinite(authTime)) throw new Error('missing auth_time')
    if (authTime < startedAt - CLOCK_TOLERANCE_SECONDS || authTime > deps.now() + CLOCK_TOLERANCE_SECONDS) {
      throw new Error('stale auth_time')
    }
    const amr = Array.isArray(payload.amr) ? payload.amr.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
    return { sub: payload.sub, acr: payload.acr, amr, authTime }
  }

  class AssuranceError extends Error {}

  async function createSessionCookie(identity: { sub: string; acr: string; amr: string[]; authTime: number }): Promise<string> {
    const issuedAt = deps.now()
    const jwt = await new SignJWT({
      world: { iss: ISSUER, sub: identity.sub }, // identity is always the pair (iss, sub), never sub alone
      acr: identity.acr,
      amr: identity.amr,
      auth_time: identity.authTime,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
      .sign(sessionKey)
    return serializeCookie(SESSION_COOKIE, jwt, SESSION_TTL_SECONDS)
  }

  /**
   * Step 2: validate the callback and sign the person in. Always returns a redirect back into the app
   * (built from the redirect URI's origin) and always clears the one-time attempt cookies.
   */
  async function handleCallback(requestUrl: URL, cookies: Record<string, string>): Promise<Redirect> {
    const fail = (code: AuthErrorCode): Redirect => ({
      location: `${config.appOrigin}/?auth_error=${code}`,
      setCookies: clearOidcCookies(),
    })
    const q = requestUrl.searchParams
    for (const name of ['iss', 'state', 'code', 'error']) {
      if (q.getAll(name).length > 1) return fail('invalid_callback')
    }

    // The callback iss must equal the issuer exactly, before anything else is trusted or redeemed.
    if (q.get('iss') !== ISSUER) return fail('issuer_mismatch')
    const state = q.get('state')
    const savedState = cookies[OIDC_COOKIES.state]
    if (!state || !savedState || !safeEqual(state, savedState)) return fail('state_mismatch')

    const startedAt = readStarted(cookies[OIDC_COOKIES.started], state)
    if (startedAt === undefined) return fail('state_mismatch')
    if (deps.now() - startedAt > ATTEMPT_TTL_SECONDS || startedAt > deps.now() + CLOCK_TOLERANCE_SECONDS) {
      return fail('attempt_expired')
    }

    const error = q.get('error')
    if (error) {
      if (error === 'access_denied') return fail('access_denied')
      if (error === 'unmet_authentication_requirements') return fail('insufficient_assurance')
      return fail('authorization_failed')
    }

    const code = q.get('code')
    const nonce = cookies[OIDC_COOKIES.nonce]
    const verifier = cookies[OIDC_COOKIES.verifier]
    if (!code || code.length > 2048 || !nonce || !verifier || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
      return fail('invalid_callback')
    }

    let discovery: Discovery
    try {
      discovery = await discover()
    } catch {
      return fail('service_unavailable')
    }

    let idToken: string
    try {
      idToken = await exchangeCode(discovery.tokenEndpoint, code, verifier)
    } catch {
      return fail('token_exchange_failed')
    }

    try {
      const identity = await validateIdToken(idToken, discovery.keys, nonce, startedAt)
      const session = await createSessionCookie(identity)
      const encodedReturn = cookies[OIDC_COOKIES.returnTo]
      let returnTo = '/'
      if (encodedReturn) {
        try {
          const candidate = decodeURIComponent(encodedReturn)
          if (candidate.startsWith('/') && !candidate.startsWith('//') && candidate.length <= 1024) returnTo = candidate
        } catch { /* malformed return cookie falls back home */ }
      }
      return { location: `${config.appOrigin}${returnTo}`, setCookies: [...clearOidcCookies(), session] }
    } catch (err) {
      if (err instanceof AssuranceError) return fail('insufficient_assurance')
      if (err instanceof joseErrors.JWKSTimeout) return fail('service_unavailable')
      return fail('invalid_id_token')
    }
  }

  /** Reads and verifies the signed app session cookie. Returns null for anything but a valid, unexpired session. */
  async function readSession(cookies: Record<string, string>): Promise<WorldSession | null> {
    const token = cookies[SESSION_COOKIE]
    if (!token || token.length > 4096) return null
    try {
      const { payload } = await jwtVerify(token, sessionKey, {
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
        algorithms: ['HS256'],
        currentDate: new Date(deps.now() * 1000),
        requiredClaims: ['exp', 'iat'],
      })
      const world = payload.world as { iss?: unknown; sub?: unknown } | undefined
      if (!world || world.iss !== ISSUER || typeof world.sub !== 'string' || world.sub.length === 0) return null
      if (payload.acr !== ORB_ACR || typeof payload.exp !== 'number') return null
      return {
        iss: world.iss,
        sub: world.sub,
        creatorCommitment: creatorCommitment(world.iss, world.sub),
        acr: payload.acr,
        amr: Array.isArray(payload.amr) ? payload.amr.filter((x): x is string => typeof x === 'string') : [],
        authTime: typeof payload.auth_time === 'number' ? payload.auth_time : 0,
        expiresAt: payload.exp,
      }
    } catch {
      return null
    }
  }

  /** Sign-out clears only this app's session cookie. World ID has no OIDC end-session endpoint. */
  const signOutCookies = (): string[] => [serializeCookie(SESSION_COOKIE, '', 0)]

  return { startLogin, handleCallback, readSession, signOutCookies, appOrigin: config.appOrigin }
}

export type WorldAuth = ReturnType<typeof createWorldAuth>
