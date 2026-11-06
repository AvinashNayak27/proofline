import { HTTPClient, ok, text, type TeeRuntime } from '@chainlink/cre-sdk'
import type { Config } from './config'
const MAX_METRIC = 100_000_000
export function parseMetrics(raw: unknown, postId: string): { uniqueViews: number; completions: number; amountUsdc6: bigint } | undefined {
  const root = raw as any
  const result = root?.data?.tweet_result_by_rest_id?.result
  if (!result || (result.rest_id !== undefined && result.rest_id !== postId) || !Array.isArray(result.video)) return
  const metric = (name: string) => {
    const entries = result.video.filter((x: any) => x?.metric_type === name)
    if (entries.length !== 1) return
    const n = entries[0].metric_value
    return Number.isSafeInteger(n) && n >= 0 && n <= MAX_METRIC ? n as number : undefined
  }
  const uniqueViews = metric('UniqueVideoViews'); const completions = metric('VideoCompletions')
  if (uniqueViews === undefined || completions === undefined) return
  return { uniqueViews, completions, amountUsdc6: BigInt(completions) * 1000n }
}
export function validateCapture(raw: unknown, postId: string): { url: string; headers: Record<string,string> } | undefined {
  if (!raw || typeof raw !== 'object') return
  const x = raw as any
  if (typeof x.url !== 'string' || x.url.length > 12000 || !x.headers || typeof x.headers !== 'object') return
  const match = /^https:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/TweetActivityQuery\?([^#]+)$/.exec(x.url)
  if (!match) return
  const encoded = /(?:^|&)variables=([^&]+)/.exec(match[1])?.[1]
  try { if (!encoded || JSON.parse(decodeURIComponent(encoded)).restId !== postId) return } catch { return }
  const h = x.headers as Record<string,unknown>
  if (typeof h.cookie !== 'string' || h.cookie.length > 8192 || !/(?:^|;\s*)auth_token=[^;]+/.test(h.cookie) || typeof h['x-csrf-token'] !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(h['x-csrf-token']) || typeof h.authorization !== 'string' || !/^Bearer [A-Za-z0-9%._-]{10,2048}$/.test(h.authorization)) return
  if (!h.cookie.split(';').some(s => s.trim() === `ct0=${h['x-csrf-token']}`)) return
  const headers: Record<string,string> = { Cookie:h.cookie, 'x-csrf-token':h['x-csrf-token'], Authorization:h.authorization, Accept:'application/json' }
  for (const name of ['x-client-transaction-id','x-twitter-active-user','x-twitter-auth-type','x-twitter-client-language','user-agent']) {
    if (typeof h[name] === 'string' && h[name].length < 512) headers[name] = h[name]
  }
  return { url:x.url, headers }
}
export function replay(enclave: TeeRuntime<Config>, capture: {url:string;headers:Record<string,string>}, postId: string) {
  const multiHeaders = Object.fromEntries(Object.entries(capture.headers).map(([k,v]) => [k,{values:[v]}]))
  const response = new HTTPClient().sendRequest(enclave,{url:capture.url,method:'GET',multiHeaders,cacheSettings:{store:false}}).result()
  if (response.statusCode === 401 || response.statusCode === 403) return 'unauthorized'
  if (!ok(response)) return 'request_failed'
  let parsed: unknown
  try { parsed = JSON.parse(text(response)) } catch { return 'invalid_response' }
  return parseMetrics(parsed,postId) || 'metrics_missing'
}
