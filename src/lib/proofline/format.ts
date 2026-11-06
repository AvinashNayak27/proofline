import { formatUnitsFixed } from '@/onchain-money'
import { USDC_DECIMALS } from '@/onchain-facts'

/** USDC base units to a display string: two decimals, or four for sub-cent amounts. */
export function usd(raw: bigint): string {
  const digits = raw !== 0n && raw < 10n ** BigInt(USDC_DECIMALS - 2) ? 4 : 2
  const [whole, fraction] = formatUnitsFixed(raw, USDC_DECIMALS, digits).split('.')
  return `${BigInt(whole).toLocaleString('en-US')}.${fraction}`
}

export const count = (n: bigint | number): string => Number(n).toLocaleString('en-US')

export const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`
export const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`

/** Whole-unit relative time, e.g. "3d 4h left" or "Ended 2d ago". */
export function timeLeft(endsAt: bigint, nowSec: number): string {
  const diff = Number(endsAt) - nowSec
  const abs = Math.abs(diff)
  const d = Math.floor(abs / 86_400)
  const h = Math.floor((abs % 86_400) / 3_600)
  const m = Math.floor((abs % 3_600) / 60)
  const span = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`
  return diff >= 0 ? `${span} left` : `Ended ${span} ago`
}

export const dateLabel = (sec: bigint): string =>
  new Date(Number(sec) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** "$1.00" per 1,000 views, from base units. */
export const cpmLabel = (cpm: bigint): string => `$${usd(cpm)} per 1,000 views`
