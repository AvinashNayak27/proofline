import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

const INFO = 'proofline/session/v1'
const KEY = 'pendingProoflineCapture'
type Pending = { campaignId: string; postId: string; handle: string; wallet: string; nonce: string; expiry: string; enclavePublicKey: string; startedAt: number; tabId: number }
type Ready = { postId: string; encryptedSessionMaterial: string; tabId: number }
type State = { pending?: Pending; ready?: Ready }
const hex = (b: Uint8Array) => `0x${Array.from(b, x => x.toString(16).padStart(2, '0')).join('')}`
const unhex = (s: string) => Uint8Array.from(s.slice(2).match(/../g)!.map(x => parseInt(x, 16)))
const aad = (p: Pending) => `${INFO}|5042002|${p.campaignId}|${p.postId}|${p.wallet.toLowerCase()}|${p.nonce.toLowerCase()}|${p.expiry}`

function seal(value: unknown, p: Pending): string {
  const recipient = unhex(p.enclavePublicKey)
  const eph = crypto.getRandomValues(new Uint8Array(32))
  const pub = x25519.getPublicKey(eph)
  const salt = new Uint8Array(64); salt.set(pub); salt.set(recipient, 32)
  const key = hkdf(sha256, x25519.getSharedSecret(eph, recipient), salt, new TextEncoder().encode(INFO), 32)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = chacha20poly1305(key, nonce, new TextEncoder().encode(aad(p))).encrypt(new TextEncoder().encode(JSON.stringify(value)))
  const bytes = new Uint8Array(45 + encrypted.length); bytes[0] = 1; bytes.set(pub, 1); bytes.set(nonce, 33); bytes.set(encrypted, 45)
  return hex(bytes)
}
function parsePost(link: unknown): { handle: string; postId: string } | null {
  if (typeof link !== 'string') return null
  try {
    const u = new URL(link)
    const m = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})\/?$/.exec(u.pathname)
    return u.protocol === 'https:' && ['x.com', 'twitter.com'].includes(u.hostname) && !u.search && !u.hash && m ? { handle: m[1], postId: m[2] } : null
  } catch { return null }
}
function queryPost(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.origin !== 'https://x.com' || !/^\/i\/api\/graphql\/[A-Za-z0-9_-]+\/TweetActivityQuery$/.test(u.pathname)) return null
    const vars = JSON.parse(u.searchParams.get('variables') || '{}')
    return typeof vars.restId === 'string' && /^\d{1,20}$/.test(vars.restId) ? vars.restId : null
  } catch { return null }
}
const getState = async (): Promise<State> => (await chrome.storage.session.get(KEY))[KEY] || {}
const putState = async (s: State) => chrome.storage.session.set({ [KEY]: s })
chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
  void (async () => {
    const s = await getState(); const p = s.pending
    if (!p || s.ready || d.tabId !== p.tabId || Date.now() - p.startedAt > 120_000 || queryPost(d.url) !== p.postId) return
    const names = new Set(['cookie', 'x-csrf-token', 'x-client-transaction-id', 'authorization', 'user-agent', 'x-twitter-active-user', 'x-twitter-auth-type', 'x-twitter-client-language'])
    const headers = Object.fromEntries((d.requestHeaders || []).filter(h => h.name && h.value && names.has(h.name.toLowerCase())).map(h => [h.name.toLowerCase(), h.value!]))
    if (!headers.cookie || !headers['x-csrf-token'] || !headers.authorization) return
    await putState({ ready: { postId: p.postId, encryptedSessionMaterial: seal({ url: d.url, headers }, p), tabId: p.tabId } })
  })().catch(() => {})
}, { urls: ['https://x.com/i/api/graphql/*'] }, ['requestHeaders', 'extraHeaders'])
// Pages allowed to talk to this extension. Keep in sync with externally_connectable in manifest.json.
const ALLOWED_APP_ORIGINS = ['http://localhost:5173/', 'https://i0sr6ifstg1gai9k5yzas.preview.studio.arc.io/']
chrome.runtime.onMessageExternal.addListener((m, sender, send) => {
  if (!ALLOWED_APP_ORIGINS.some((origin) => sender.url?.startsWith(origin))) return
  void (async () => {
    if (m?.type === 'CAPTURE_STATUS') { const s = await getState(); send({ ok: true, ready: !!s.ready, postId: s.ready?.postId }); return }
    if (m?.type === 'GET_CAPTURE') {
      const s = await getState()
      if (!s.ready) { send({ ok: false }); return }
      const { postId, encryptedSessionMaterial, tabId } = s.ready
      send({ ok: true, postId, encryptedSessionMaterial })
      await chrome.storage.session.remove(KEY)
      try {
        const tab = await chrome.tabs.get(tabId)
        if (tab.url && new RegExp(`^https://x\\.com/[A-Za-z0-9_]{1,15}/status/${postId}/analytics(?:[?#]|$)`).test(tab.url)) {
          await chrome.tabs.remove(tabId)
        }
      } catch { /* The user may already have closed the tab. */ }
      return
    }
    if (m?.type !== 'BEGIN_CAPTURE') { send({ ok: false }); return }
    const post = parsePost(m.link)
    if (!post || typeof m.campaignId !== 'string' || !/^[1-9][0-9]{0,17}$/.test(m.campaignId) || !/^0x[0-9a-fA-F]{40}$/.test(m.wallet) || !/^0x[0-9a-fA-F]{64}$/.test(m.nonce) || !/^[1-9][0-9]{0,11}$/.test(m.expiry) || !/^0x[0-9a-fA-F]{64}$/.test(m.enclavePublicKey)) { send({ ok: false, reason: 'invalid_request' }); return }
    await chrome.storage.session.remove(KEY)
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
    await putState({ pending: { ...post, campaignId: m.campaignId, wallet: m.wallet, nonce: m.nonce, expiry: m.expiry, enclavePublicKey: m.enclavePublicKey, startedAt: Date.now(), tabId: tab.id! } })
    await chrome.tabs.update(tab.id!, { url: `https://x.com/${post.handle}/status/${post.postId}/analytics` })
    send({ ok: true, postId: post.postId })
  })().catch(() => send({ ok: false, reason: 'extension_error' }))
  return true
})
