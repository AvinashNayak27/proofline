import { Loader2 } from 'lucide-react'
import { Link, type LinkProps } from 'react-router-dom'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const cls = (variant: Variant, small?: boolean, extra?: string) =>
  ['pl-btn', `pl-btn-${variant}`, small ? 'pl-btn-sm' : '', extra ?? ''].filter(Boolean).join(' ')

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  small?: boolean
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', small, loading, icon, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls(variant, small, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

type LinkButtonProps = LinkProps & { variant?: Variant; small?: boolean; icon?: ReactNode }

/** An in-app link that looks like a button. */
export function LinkButton({ variant = 'primary', small, icon, children, className, ...rest }: LinkButtonProps) {
  return (
    <Link className={cls(variant, small, className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}

/** An external link that looks like a button; always opens in a new tab. */
export function ExternalButton({
  href,
  variant = 'secondary',
  small,
  icon,
  children,
}: {
  href: string
  variant?: Variant
  small?: boolean
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls(variant, small)}>
      {icon}
      {children}
    </a>
  )
}
