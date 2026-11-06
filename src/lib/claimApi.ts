import { postJsonPrivate, PrivateHttpError } from './privateHttp'
import type { Hex } from 'viem'

const LOGIN_URL = 'https://dummyjson.com/auth/login'
/** Same-origin path; the dev server proxies it to the CRE trigger (see vite.config.ts). */
const TRIGGER_URL = '/cre/trigger'

export type ApiFailure = 'invalid_credentials' | 'network' | 'unavailable' | 'unexpected'

export class ClaimApiError extends Error {
  readonly failure: ApiFailure
  constructor(failure: ApiFailure) {
    super(failure)
    this.failure = failure
  }
}

/** Credentials go from this browser straight to DummyJSON. Only the access token is kept. */
export async function loginToDummyJson(username: string, password: string): Promise<string> {
  try {
    const res = await postJsonPrivate(LOGIN_URL, { username, password, expiresInMins: 30 })
    if (res.status === 400 || res.status === 401) throw new ClaimApiError('invalid_credentials')
    if (res.status < 200 || res.status >= 300) throw new ClaimApiError('unavailable')
    const token =
      typeof res.json === 'object' && res.json !== null ? (res.json as Record<string, unknown>).accessToken : undefined
    if (typeof token !== 'string' || token.length === 0) throw new ClaimApiError('unexpected')
    return token
  } catch (err) {
    if (err instanceof ClaimApiError) throw err
    if (err instanceof PrivateHttpError) throw new ClaimApiError('network')
    throw new ClaimApiError('unexpected')
  }
}

export type ClaimPayload = {
  accessToken: string
  wallet: string
  nonce: Hex
  expiry: string
  signature: Hex
}

/** Coarse workflow result when the trigger endpoint reports one (the simulation bridge does). */
export type ClaimOutcome = { status: string; reason?: string; txHash?: Hex }

export type TriggerReceipt = { executionId?: string; outcome?: ClaimOutcome }

/** Sends exactly the five fields the workflow accepts. Never logs or echoes them. */
export async function submitClaimToCre(payload: ClaimPayload): Promise<TriggerReceipt> {
  try {
    const res = await postJsonPrivate(TRIGGER_URL, { input: payload }, 60_000)
    if (res.status < 200 || res.status >= 300) throw new ClaimApiError('unavailable')
    const body = typeof res.json === 'object' && res.json !== null ? (res.json as Record<string, unknown>) : {}
    const result = typeof body.result === 'object' && body.result !== null ? (body.result as Record<string, unknown>) : null
    const outcome: ClaimOutcome | undefined =
      result && typeof result.status === 'string'
        ? {
            status: result.status,
            reason: typeof result.reason === 'string' ? result.reason : undefined,
            txHash: typeof result.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result.txHash) ? (result.txHash as Hex) : undefined,
          }
        : undefined
    return { executionId: typeof body.executionId === 'string' ? body.executionId : undefined, outcome }
  } catch (err) {
    if (err instanceof ClaimApiError) throw err
    if (err instanceof PrivateHttpError) throw new ClaimApiError('network')
    throw new ClaimApiError('unexpected')
  }
}
