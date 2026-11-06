// Sends credential- and token-bearing JSON requests with XMLHttpRequest on purpose.
//
// Arc Studio's preview tracing patches globalThis.fetch and records request AND response bodies
// (and mirrors them into the Tracing panel and traces.jsonl). The claim request carries the creator's
// encrypted X session capture, so it must not go through fetch. XHR is not instrumented. Never add
// console output, error text, or any logging of a body, response, or header in this file.

export class PrivateHttpError extends Error {
  readonly kind: 'network' | 'timeout'
  constructor(kind: 'network' | 'timeout') {
    super(kind)
    this.kind = kind
  }
}

export type PrivateResponse = { status: number; json: unknown }

export function postJsonPrivate(url: string, body: unknown, timeoutMs = 30_000): Promise<PrivateResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.withCredentials = false
    xhr.timeout = timeoutMs
    xhr.onload = () => {
      let json: unknown = null
      try {
        json = JSON.parse(xhr.responseText)
      } catch {
        json = null
      }
      resolve({ status: xhr.status, json })
    }
    xhr.onerror = () => reject(new PrivateHttpError('network'))
    xhr.ontimeout = () => reject(new PrivateHttpError('timeout'))
    xhr.send(JSON.stringify(body))
  })
}
