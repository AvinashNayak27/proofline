import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { LOGIN_PATH, useWorldSession } from './useWorldSession'

/**
 * Starts World ID sign-in. In a normal tab it navigates. Inside an embedded preview the World page
 * cannot be framed, so it opens a new tab and this page keeps checking for the finished session.
 */
export function useWorldSignIn() {
  const { refresh } = useWorldSession()
  const [waiting, setWaiting] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
    },
    [],
  )

  const begin = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (window.self === window.top) return
      event.preventDefault()
      window.open(LOGIN_PATH, '_blank', 'noopener,noreferrer')
      setWaiting(true)
      if (timer.current) clearInterval(timer.current)
      const stopAt = Date.now() + 5 * 60_000
      timer.current = setInterval(() => {
        void refresh()
        if (Date.now() > stopAt && timer.current) {
          clearInterval(timer.current)
          setWaiting(false)
        }
      }, 2_000)
    },
    [refresh],
  )

  return { begin, waiting, href: LOGIN_PATH }
}
