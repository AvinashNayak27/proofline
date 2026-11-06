import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { shortAddress } from '@/lib/proofline/format'

export function WalletButton() {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, address }) => (
        <button type="button" onClick={show} className="pl-btn pl-btn-secondary pl-btn-sm">
          <Wallet className="size-4" aria-hidden />
          <span className="mono tabular-nums">{isConnected && address ? shortAddress(address) : 'Connect wallet'}</span>
        </button>
      )}
    </ConnectKitButton.Custom>
  )
}
