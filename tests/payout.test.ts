import { describe, expect, test } from 'bun:test'
import { quote } from '../src/lib/proofline/payout'
import { DEFAULTS, validateForm } from '../src/lib/proofline/campaignForm'

const terms = { cpmUsdc6: 1_000_000n, bonusBps: 5_000, maxPerPost: 5_000_000n, minViews: 1_000 }

describe('payout calculator mirrors the contract', () => {
  test('matches the contract formula: views/1000 x rate x (1 + bonus x retention^2), capped', () => {
    expect(quote(terms, 1000n, 0n).payout).toBe(1_000_000n) // no completions
    expect(quote(terms, 1000n, 500n).payout).toBe(1_125_000n) // retention 0.5 -> +12.5%
    expect(quote(terms, 1000n, 1000n).payout).toBe(1_500_000n) // retention 1 -> +50%
    expect(quote(terms, 2000n, 9999n).payout).toBe(3_000_000n) // retention capped at 1
    expect(quote(terms, 735n, 104n).eligible).toBe(false) // below the 1,000 minimum
  })
  test('the per-post cap applies and is flagged', () => {
    const q = quote(terms, 4000n, 4000n)
    expect(q.uncapped).toBe(6_000_000n)
    expect(q.payout).toBe(5_000_000n)
    expect(q.capped).toBe(true)
  })
  test('no views earns nothing and never divides by zero', () => {
    expect(quote({ ...terms, minViews: 0 }, 0n, 0n).payout).toBe(0n)
    expect(quote({ ...terms, minViews: 0 }, 0n, 50n).payout).toBe(0n)
  })
  test('rounds down at each division like the contract', () => {
    // base = 1_333 * 1_000_000 / 1000 = 1_333_000; bonus = (1_333_000 * 5000 / 10000) * 1 / 1 -> 666_500
    expect(quote({ ...terms, minViews: 0 }, 1333n, 1333n).payout).toBe(1_999_500n)
    expect(quote({ ...terms, cpmUsdc6: 1n, minViews: 0 }, 1n, 1n).payout).toBe(0n)
  })
})

describe('campaign form validation', () => {
  const NOW = 1_800_000_000
  const good = { ...DEFAULTS, title: 'Summer launch', brandName: 'Acme' }
  test('accepts the defaults with a title', () => {
    const r = validateForm(good, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.input.cpmUsdc6).toBe(1_000_000n)
      expect(r.input.bonusBps).toBe(5000)
      expect(r.input.endsAt).toBe(BigInt(NOW + 14 * 86_400))
      expect(r.input.startsAt).toBe(0n)
      expect(r.deposit).toBe(50_000_000n)
    }
  })
  test('passes the proof-code choice through, requiring it by default', () => {
    const on = validateForm(good, NOW)
    const off = validateForm({ ...good, requireProofCode: false }, NOW)
    expect(on.ok && on.input.requireProofCode).toBe(true)
    expect(off.ok && off.input.requireProofCode).toBe(false)
  })
  test('mirrors the contract rules', () => {
    const bad = (over: Partial<typeof good>) => {
      const r = validateForm({ ...good, ...over }, NOW)
      return r.ok ? {} : r.errors
    }
    expect(bad({ title: '  ' }).title).toBeTruthy()
    expect(bad({ title: 'x'.repeat(81) }).title).toBeTruthy()
    expect(bad({ requiredTag: 'has space' }).requiredTag).toBeTruthy()
    expect(bad({ link: 'http://insecure.example' }).link).toBeTruthy()
    expect(bad({ cpm: '0' }).cpm).toBeTruthy()
    expect(bad({ maxPerPost: '5', maxPerCreator: '4' }).maxPerCreator).toBeTruthy()
    expect(bad({ bonusPct: '101' }).bonusPct).toBeTruthy()
    expect(bad({ durationDays: '366' }).durationDays).toBeTruthy()
    expect(bad({ deposit: '1.1234567' }).deposit).toBeTruthy()
    expect(bad({ minViews: '-1' }).minViews).toBeTruthy()
  })
})
