import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { buildShareLink } from '@/lib/share'

/** Copies a link people outside the preview can open. Disabled until the share base is known. */
export function ShareButton({ path }: { path: string }) {
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void buildShareLink(path).then((l) => {
      if (alive) setLink(l)
    })
    return () => {
      alive = false
    }
  }, [path])
  return (
    <Button
      variant="secondary"
      small
      disabled={!link}
      icon={<Link2 className="size-4" aria-hidden />}
      onClick={() => {
        if (!link) return
        navigator.clipboard.writeText(link).then(
          () => toast.success('Campaign link copied'),
          () => toast.error('Copy failed. Select the address bar link instead.'),
        )
      }}
    >
      Copy link
    </Button>
  )
}
