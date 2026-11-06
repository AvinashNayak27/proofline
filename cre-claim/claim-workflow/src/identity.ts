import { HTTPClient, ok, text, type TeeRuntime } from '@chainlink/cre-sdk'
import type { Config } from './config'
import { weightToUsdc6 } from './intent'

/**
 * Coarse, fixed-vocabulary verdict each node reports:
 *  - "rejected"        the bearer token was not accepted
 *  - "invalid_user"    auth/me had no usable numeric id
 *  - "invalid_weight"  auth/me had no positive, plain-decimal weight
 *  - "ok:<id>:<units>" authenticated user id and payout in 6-decimal USDC units (weight / 100 USDC)
 */
export type IdentityVerdict = string

/**
 * Runs INSIDE the enclave: calls DummyJSON auth/me with the caller's bearer token and extracts the
 * authenticated user id and weight. The token was decrypted in the enclave and the request is made
 * from it, so no DON node sees the token. Only the verdict above leaves this function. The raw
 * response, username and token are never logged, returned, or placed in an error message.
 */
export const checkIdentity = (enclave: TeeRuntime<Config>, accessToken: string): IdentityVerdict => {
  const response = new HTTPClient()
    .sendRequest(enclave, {
      url: enclave.config.authMeUrl,
      method: 'GET',
      multiHeaders: {
        Authorization: { values: [`Bearer ${accessToken}`] },
        Accept: { values: ['application/json'] },
      },
      cacheSettings: { store: false },
    })
    .result()

  if (response.statusCode === 401 || response.statusCode === 403) return 'rejected'
  if (!ok(response)) throw new Error('identity provider unavailable')

  let profile: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text(response))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape')
    profile = parsed as Record<string, unknown>
  } catch {
    throw new Error('identity provider returned an unreadable response')
  }

  const id = profile.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return 'invalid_user'
  const units = weightToUsdc6(profile.weight)
  if (units === undefined) return 'invalid_weight'
  return `ok:${id}:${units}`
}
