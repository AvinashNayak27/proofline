import { useEffect, useState } from 'react'

/** Current time in whole seconds, refreshed every 30 seconds so countdowns stay honest without impure renders. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
