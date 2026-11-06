import type { ReactNode } from 'react'
import { Skeleton } from './Feedback'

export function Stat({ label, value, sub, loading }: { label: string; value: ReactNode; sub?: ReactNode; loading?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="pl-eyebrow">{label}</p>
      {loading ? <Skeleton className="h-8 w-24" /> : <p className="display text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>}
      {sub ? <p className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</p> : null}
    </div>
  )
}
