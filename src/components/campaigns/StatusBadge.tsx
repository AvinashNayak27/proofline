import { Badge } from '@/components/ui/Feedback'
import type { Phase } from '@/lib/proofline/events'

const COPY: Record<Phase, { tone: 'success' | 'warn' | 'neutral'; label: string }> = {
  live: { tone: 'success', label: 'Live' },
  upcoming: { tone: 'neutral', label: 'Starting soon' },
  paused: { tone: 'warn', label: 'Paused' },
  exhausted: { tone: 'warn', label: 'Budget used' },
  ended: { tone: 'neutral', label: 'Ended' },
  closed: { tone: 'neutral', label: 'Closed' },
}

export function StatusBadge({ phase }: { phase: Phase }) {
  const { tone, label } = COPY[phase]
  return <Badge tone={tone}>{label}</Badge>
}
