import { postJsonPrivate, PrivateHttpError } from '@/lib/privateHttp'

export type ClaimRequest = {
  campaignId: string
  postUrl: string
  wallet: string
  nonce: string
  expiry: string
  signature: string
  encryptedSessionMaterial: string
}

export type ClaimResult =
  | { kind: 'submitted'; txHash: string | null; amountUsdc6: string | null; views: string | null; completions: string | null }
  | { kind: 'verified' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'server'; error: string }
  | { kind: 'network' }

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * Sends the claim to the Proofline server, which checks the World ID session and forwards it to the
 * CRE workflow. Uses XHR on purpose: the request carries encrypted session material and the preview
 * tracer records fetch bodies. Never log the request or response.
 */
export async function submitClaim(request: ClaimRequest): Promise<ClaimResult> {
  try {
    const res = await postJsonPrivate('/api/claims', { input: request }, 170_000)
    const body = typeof res.json === 'object' && res.json !== null ? (res.json as Record<string, unknown>) : {}
    if (res.status < 200 || res.status >= 300) return { kind: 'server', error: str(body.error) ?? 'bridge_unreachable' }
    const result = typeof body.result === 'object' && body.result !== null ? (body.result as Record<string, unknown>) : {}
    const status = str(result.status)
    if (status === 'rejected') return { kind: 'rejected', reason: str(result.reason) ?? 'invalid_request' }
    if (status === 'verified') return { kind: 'verified' }
    if (status === 'submitted') {
      return { kind: 'submitted', txHash: str(result.txHash), amountUsdc6: str(result.amountUsdc6), views: str(result.uniqueViews), completions: str(result.completions) }
    }
    return { kind: 'server', error: 'bridge_unreachable' }
  } catch (err) {
    if (err instanceof PrivateHttpError) return { kind: 'network' }
    return { kind: 'network' }
  }
}
