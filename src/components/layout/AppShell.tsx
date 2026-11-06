import { useEffect } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { WORLD_ERROR_COPY } from '@/lib/worldErrors'
import { CreatorChip } from './CreatorChip'
import { Wordmark } from './Logo'
import { WalletButton } from './WalletButton'

const NAV = [
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/create', label: 'Launch a campaign' },
  { to: '/dashboard', label: 'Brand dashboard' },
  { to: '/rewards', label: 'My rewards' },
]

/** Reads ?auth_error=<code> once, shows it, and removes it from the address bar. */
function useAuthErrorToast() {
  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('auth_error')
    if (!code) return
    toast.error(WORLD_ERROR_COPY[code] ?? 'Sign-in did not complete. Try again.')
    url.searchParams.delete('auth_error')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])
}

export function AppShell() {
  useAuthErrorToast()
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b backdrop-blur-xl" style={{ background: 'rgba(250,247,242,0.82)', borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="rounded-lg" aria-label="Proofline home">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? '' : 'hover:bg-white/70'}`
                }
                style={({ isActive }) => ({ color: isActive ? 'var(--ink)' : 'var(--muted)', background: isActive ? 'rgba(255,255,255,0.9)' : undefined })}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <CreatorChip />
            <WalletButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8 sm:pt-10">
        <Outlet />
      </main>

      <footer className="border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <Wordmark />
            <p style={{ color: 'var(--muted)' }}>Brands fund attention. Creators earn from performance.</p>
          </div>
          <p className="max-w-md text-pretty text-xs" style={{ color: 'var(--subtle)' }}>
            Proofline runs on Arc Testnet with test USDC. It holds no real funds. Human verification by World ID, measurements by Chainlink CRE, payments on Arc.
          </p>
        </div>
      </footer>
    </div>
  )
}
