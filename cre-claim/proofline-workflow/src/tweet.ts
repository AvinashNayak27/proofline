import { HTTPClient, ok, text, type TeeRuntime } from '@chainlink/cre-sdk'
import type { Address } from 'viem'
import type { Config } from './config'
import { textHasProofCode } from './proofCode'

export type TweetFailure = 'tweet_unreadable' | 'tweet_mismatch' | 'code_missing' | 'tag_missing'

/** Token the public syndication endpoint expects for a post id. */
export function syndicationToken(postId: string): string {
  return ((Number(postId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
}

export function syndicationUrl(postId: string): string {
  return `https://cdn.syndication.twimg.com/tweet-result?id=${postId}&lang=en&token=${syndicationToken(postId)}`
}

export type TweetExpectation = { postId: string; handle: string; campaignId: bigint; wallet: Address; requiredTag: string; requireCode?: boolean }

/**
 * Checks the public post: it is the submitted post, written by the submitted handle, and carries the
 * creator's Proofline code (unless requireCode is false) and the campaign tag, when the campaign sets one. The analytics capture
 * separately proves the submitter controls that account.
 */
export function checkTweet(raw: unknown, e: TweetExpectation): 'ok' | TweetFailure {
  const t = raw as { id_str?: unknown; text?: unknown; user?: { screen_name?: unknown } } | null
  if (!t || typeof t.text !== 'string' || typeof t.id_str !== 'string') return 'tweet_unreadable'
  const author = t.user?.screen_name
  if (t.id_str !== e.postId || typeof author !== 'string' || author.toLowerCase() !== e.handle.toLowerCase()) return 'tweet_mismatch'
  if (e.requireCode !== false && !textHasProofCode(t.text, e.campaignId, e.wallet)) return 'code_missing'
  if (e.requiredTag && !t.text.toLowerCase().includes(e.requiredTag.toLowerCase())) return 'tag_missing'
  return 'ok'
}

export function sendTweetLookup(enclave: TeeRuntime<Config>, postId: string) {
  return new HTTPClient().sendRequest(enclave, {
    url: syndicationUrl(postId),
    method: 'GET',
    multiHeaders: { Accept: { values: ['application/json'] } },
    cacheSettings: { store: false },
  })
}

export function readTweet(pending: ReturnType<typeof sendTweetLookup>, e: TweetExpectation): 'ok' | TweetFailure {
  const response = pending.result()
  if (!ok(response)) return 'tweet_unreadable'
  let parsed: unknown
  try {
    parsed = JSON.parse(text(response))
  } catch {
    return 'tweet_unreadable'
  }
  return checkTweet(parsed, e)
}
