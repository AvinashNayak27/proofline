// Talks to the Proofline companion extension (Chrome). The extension opens the creator's own X
// analytics page, captures that one request, and encrypts it to the enclave before it ever reaches
// this page. The page only ever receives ciphertext.
import { EXTENSION_ID } from './config'

type ChromeWindow = Window & {
  chrome?: {
    runtime?: {
      lastError?: { message?: string }
      sendMessage: (id: string, message: unknown, callback: (response: unknown) => void) => void
    }
  }
}

export class ExtensionError extends Error {
  readonly kind: 'not-configured' | 'unavailable'
  constructor(kind: 'not-configured' | 'unavailable') {
    super(kind)
    this.kind = kind
  }
}

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const runtime = (window as ChromeWindow).chrome?.runtime
    if (!EXTENSION_ID) return reject(new ExtensionError('not-configured'))
    if (!runtime) return reject(new ExtensionError('unavailable'))
    runtime.sendMessage(EXTENSION_ID, message, (response) => {
      if (runtime.lastError) reject(new ExtensionError('unavailable'))
      else resolve(response as T)
    })
  })
}

export type BeginCapture = {
  link: string
  campaignId: string
  wallet: string
  nonce: string
  expiry: string
  enclavePublicKey: string
}

export const beginCapture = (input: BeginCapture) => send<{ ok: boolean; postId?: string; reason?: string }>({ type: 'BEGIN_CAPTURE', ...input })
export const captureStatus = () => send<{ ok: boolean; ready: boolean; postId?: string }>({ type: 'CAPTURE_STATUS' })
export const getCapture = () => send<{ ok: boolean; postId?: string; encryptedSessionMaterial?: string }>({ type: 'GET_CAPTURE' })

/** True when the extension answers. Used to show setup help before someone starts a claim. */
export async function extensionReady(): Promise<'ready' | 'not-configured' | 'unavailable'> {
  try {
    const status = await captureStatus()
    return status?.ok ? 'ready' : 'unavailable'
  } catch (err) {
    return err instanceof ExtensionError ? err.kind : 'unavailable'
  }
}
