import { EmptyState } from '@/components/ui/Feedback'
import { LinkButton } from '@/components/ui/Button'

export function NotFound() {
  return (
    <EmptyState title="That page does not exist" action={<LinkButton to="/">Back to Proofline</LinkButton>}>
      The link may be old or mistyped.
    </EmptyState>
  )
}
