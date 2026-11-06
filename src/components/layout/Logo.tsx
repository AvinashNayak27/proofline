/** The Proofline mark: a rising line that ends in a verified point. */
export function ProoflineMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role="img" aria-label="Proofline">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path d="M7 22.5 13.2 15.3 18 18.6 24.6 9.6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.6" cy="9.6" r="3" fill="var(--signal)" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <ProoflineMark />
      <span className="display text-xl font-bold">Proofline</span>
    </span>
  )
}
