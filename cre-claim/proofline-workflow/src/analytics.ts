import { HTTPClient, ok, text, type TeeRuntime } from '@chainlink/cre-sdk'
import type { Config } from './config'

const MAX_METRIC = 100_000_000

export type Metrics = { uniqueViews: number; completions: number }
export type Capture = { url: string; headers: Record<string, string> }

/**
 * Reads view metrics from an X TweetActivityQuery response. A metric that is absent, or present
 * without a metric_value, counts as 0 (some posts have no video data). Duplicated or malformed
 * metrics are rejected so a broken response can never be read as a payout.
 */
export function parseMetrics(raw: unknown, postId: string): Metrics | undefined {
  const root = raw as { data?: { tweet_result_by_rest_id?: { result?: Record<string, unknown> } } } | null
  const result = root?.data?.tweet_result_by_rest_id?.result
  if (!result || (result.rest_id !== undefined && result.rest_id !== postId)) return
  const video: unknown = result.video === undefined || result.video === null ? [] : result.video
  if (!Array.isArray(video)) return
  const metric = (name: string): number | undefined => {
    const entries = video.filter((x: unknown) => (x as { metric_type?: unknown } | null)?.metric_type === name)
    if (entries.length === 0) return 0
    if (entries.length !== 1) return
    const n = (entries[0] as { metric_value?: unknown }).metric_value
    if (n === undefined || n === null) return 0
    return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_METRIC ? n : undefined
  }
  const uniqueViews = metric('UniqueVideoViews')
  const completions = metric('VideoCompletions')
  if (uniqueViews === undefined || completions === undefined) return
  return { uniqueViews, completions }
}

/** Accepts only a captured TweetActivityQuery for this exact post, with a complete session. */
export function validateCapture(raw: unknown, postId: string): Capture | undefined {
  if (!raw || typeof raw !== 'object') return
  const x = raw as { url?: unknown; headers?: unknown }
  if (typeof x.url !== 'string' || x.url.length > 12000 || !x.headers || typeof x.headers !== 'object') return
  const match = /^https:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/TweetActivityQuery\?([^#]+)$/.exec(x.url)
  if (!match) return
  const encoded = /(?:^|&)variables=([^&]+)/.exec(match[1])?.[1]
  try {
    if (!encoded || JSON.parse(decodeURIComponent(encoded)).restId !== postId) return
  } catch {
    return
  }
  const h = x.headers as Record<string, unknown>
  const cookie = h.cookie
  const csrf = h['x-csrf-token']
  const auth = h.authorization
  if (typeof cookie !== 'string' || cookie.length > 8192 || !/(?:^|;\s*)auth_token=[^;]+/.test(cookie)) return
  if (typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(csrf)) return
  if (typeof auth !== 'string' || !/^Bearer [A-Za-z0-9%._-]{10,2048}$/.test(auth)) return
  if (!cookie.split(';').some((s) => s.trim() === `ct0=${csrf}`)) return
  const headers: Record<string, string> = { Cookie: cookie, 'x-csrf-token': csrf, Authorization: auth, Accept: 'application/json' }
  for (const name of ['x-client-transaction-id', 'x-twitter-active-user', 'x-twitter-auth-type', 'x-twitter-client-language', 'user-agent']) {
    const v = h[name]
    if (typeof v === 'string' && v.length < 512) headers[name] = v
  }
  return { url: x.url, headers }
}

/** Starts the analytics replay inside the enclave. Resolve it with readMetrics. */
export function sendReplay(enclave: TeeRuntime<Config>, capture: Capture) {
  const multiHeaders = Object.fromEntries(Object.entries(capture.headers).map(([k, v]) => [k, { values: [v] }]))
  return new HTTPClient().sendRequest(enclave, { url: capture.url, method: 'GET', multiHeaders, cacheSettings: { store: false } })
}

export type ReplayFailure = 'unauthorized' | 'request_failed' | 'invalid_response' | 'metrics_missing'

export function readMetrics(pending: ReturnType<typeof sendReplay>, postId: string): Metrics | ReplayFailure {
  const response = pending.result()
  if (response.statusCode === 401 || response.statusCode === 403) return 'unauthorized'
  if (!ok(response)) return 'request_failed'
  let parsed: unknown
  try {
    parsed = JSON.parse(text(response))
  } catch {
    return 'invalid_response'
  }
  return parseMetrics(parsed, postId) ?? 'metrics_missing'
}
