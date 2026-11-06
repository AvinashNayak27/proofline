import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { ReactNode } from 'react'

type Tone = 'info' | 'success' | 'warn' | 'danger' | 'neutral'

const TONES: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: 'var(--surface-muted)', fg: 'var(--ink-2)' },
  neutral: { bg: 'var(--surface-muted)', fg: 'var(--ink-2)' },
  success: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const t = TONES[tone]
  return (
    <span className="pl-chip" style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  )
}

export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const t = TONES[tone]
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' || tone === 'neutral' ? Info : AlertTriangle
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className="flex gap-3 rounded-2xl px-4 py-3" style={{ background: t.bg, color: t.fg }}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5 text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-pretty" style={{ color: tone === 'info' || tone === 'neutral' ? 'var(--muted)' : undefined }}>{children}</div> : null}
      </div>
    </div>
  )
}

export function Skeleton({ className = 'h-6 w-full' }: { className?: string }) {
  return <div className={`pl-skeleton ${className}`} aria-hidden />
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="pl-inner flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="display text-lg font-semibold">{title}</p>
      {children ? <p className="max-w-sm text-pretty text-sm" style={{ color: 'var(--muted)' }}>{children}</p> : null}
      {action}
    </div>
  )
}

/** Share of a budget already paid out. Pure presentation of two real numbers. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-muted)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--signal)' }} />
    </div>
  )
}
