import { useEffect, useState } from 'react'
import { Notice } from '@/components/ui/Feedback'
import { extensionReady } from '@/lib/proofline/extension'

/** Checks the companion extension before anyone starts a claim, and explains setup when it is missing. */
export function ExtensionStatus() {
  const [state, setState] = useState<'checking' | 'ready' | 'not-configured' | 'unavailable'>('checking')
  useEffect(() => {
    let alive = true
    void extensionReady().then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [])

  if (state === 'checking') return null
  if (state === 'ready') return <Notice tone="success" title="Companion extension is ready" />
  return (
    <Notice tone="warn" title={state === 'not-configured' ? 'Companion extension is not set up' : 'Companion extension not found'}>
      Proofline reads your own post analytics through a small Chrome extension, so the analytics never leave your browser unencrypted. In Chrome, open <span className="mono">chrome://extensions</span>, turn on Developer mode, choose Load unpacked and select the <span className="mono">x-analytics-extension</span> folder, then reload this page.
      {state === 'not-configured' ? ' The app also needs its ID in VITE_PROOFLINE_EXTENSION_ID.' : ''}
    </Notice>
  )
}
