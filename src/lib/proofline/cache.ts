import type { KeyValueStore } from './discovery'

/** localStorage when the browser allows it, otherwise memory. Everything cached here is immutable or append-only chain data. */
const memory = new Map<string, string>()

export const browserStore: KeyValueStore = {
  get(key) {
    try {
      return window.localStorage.getItem(key) ?? memory.get(key)
    } catch {
      return memory.get(key)
    }
  },
  set(key, value) {
    memory.set(key, value)
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Storage full or blocked: the in-memory copy still serves this session.
    }
  },
}
