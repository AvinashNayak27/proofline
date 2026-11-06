import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'

type Shared = { label: string; hint?: ReactNode; error?: string | null; suffix?: ReactNode }

function Wrap({ id, label, hint, error, children }: Shared & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="text-pretty text-xs" style={{ color: 'var(--muted)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function TextField({ label, hint, error, suffix, className, ...rest }: Shared & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={id}
          className={`pl-input ${suffix ? 'pr-16' : ''} ${className ?? ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          {...rest}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            {suffix}
          </span>
        ) : null}
      </div>
    </Wrap>
  )
}

export function TextArea({ label, hint, error, className, ...rest }: Shared & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        rows={4}
        className={`pl-input resize-y ${className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        {...rest}
      />
    </Wrap>
  )
}
