import { parseUsdc } from '@/onchain-money'

export type FormValues = {
  brandName: string
  title: string
  brief: string
  requiredTag: string
  link: string
  durationDays: string
  minViews: string
  cpm: string
  bonusPct: string
  maxPerPost: string
  maxPerCreator: string
  deposit: string
  requireProofCode: boolean
}

export type FormErrors = Partial<Record<keyof FormValues, string>>

/** The exact tuple createCampaign takes. */
export type CampaignInput = {
  brandName: string
  title: string
  brief: string
  requiredTag: string
  link: string
  startsAt: bigint
  endsAt: bigint
  minViews: number
  bonusBps: number
  cpmUsdc6: bigint
  maxPerPost: bigint
  maxPerCreator: bigint
  requireProofCode: boolean
}

export const DEFAULTS: FormValues = {
  brandName: '',
  title: '',
  brief: '',
  requiredTag: '',
  link: '',
  durationDays: '14',
  minViews: '1000',
  cpm: '1.00',
  bonusPct: '50',
  maxPerPost: '5.00',
  maxPerCreator: '10.00',
  deposit: '50.00',
  requireProofCode: true,
}

const MAX_UINT96 = (1n << 96n) - 1n
const MAX_UINT32 = 0xffff_ffff
const bytes = (s: string): number => new TextEncoder().encode(s).length

function usdc(value: string, errors: FormErrors, key: keyof FormValues, label: string): bigint | undefined {
  try {
    const n = parseUsdc(value.trim())
    if (n <= 0n) throw new Error('zero')
    if (n > MAX_UINT96) throw new Error('big')
    return n
  } catch {
    errors[key] = `${label} must be an amount above zero, with up to 6 decimals.`
    return undefined
  }
}

export function validateForm(v: FormValues, nowSec: number): { ok: true; input: CampaignInput; deposit: bigint } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {}

  if (bytes(v.brandName) > 40) errors.brandName = 'Keep the brand name to 40 characters.'
  if (v.title.trim() === '') errors.title = 'Give the campaign a title.'
  else if (bytes(v.title) > 80) errors.title = 'Keep the title to 80 characters.'
  if (bytes(v.brief) > 800) errors.brief = 'Keep the brief to 800 characters.'
  if (!/^[\x21-\x7e]{0,32}$/.test(v.requiredTag)) errors.requiredTag = 'Use up to 32 characters with no spaces, for example #YourBrand.'
  if (v.link !== '' && !(/^https:\/\/[^\s]+$/.test(v.link) && bytes(v.link) <= 200)) errors.link = 'Use a full https:// link of up to 200 characters, or leave it empty.'

  const days = /^[0-9]{1,3}$/.test(v.durationDays) ? Number(v.durationDays) : 0
  if (days < 1 || days > 365) errors.durationDays = 'Choose between 1 and 365 days.'

  let minViews = 0
  if (/^[0-9]{1,10}$/.test(v.minViews) && Number(v.minViews) <= MAX_UINT32) minViews = Number(v.minViews)
  else errors.minViews = 'Enter a whole number of views, or 0 for none.'

  let bonusBps = 0
  const bonus = /^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$/.exec(v.bonusPct.trim())
  if (bonus) bonusBps = Math.round(Number(v.bonusPct) * 100)
  else errors.bonusPct = 'Enter a bonus from 0 to 100 percent.'

  const cpm = usdc(v.cpm, errors, 'cpm', 'The rate')
  const maxPerPost = usdc(v.maxPerPost, errors, 'maxPerPost', 'The per-post cap')
  const maxPerCreator = usdc(v.maxPerCreator, errors, 'maxPerCreator', 'The per-creator cap')
  const deposit = usdc(v.deposit, errors, 'deposit', 'The budget')
  if (maxPerPost !== undefined && maxPerCreator !== undefined && maxPerCreator < maxPerPost) {
    errors.maxPerCreator = 'The per-creator cap cannot be lower than the per-post cap.'
  }

  if (Object.keys(errors).length > 0 || cpm === undefined || maxPerPost === undefined || maxPerCreator === undefined || deposit === undefined) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    deposit,
    input: {
      brandName: v.brandName.trim(),
      title: v.title.trim(),
      brief: v.brief.trim(),
      requiredTag: v.requiredTag,
      link: v.link,
      startsAt: 0n, // zero means "start now"
      endsAt: BigInt(nowSec + days * 86_400),
      minViews,
      bonusBps,
      cpmUsdc6: cpm,
      maxPerPost,
      maxPerCreator,
      requireProofCode: v.requireProofCode,
    },
  }
}
