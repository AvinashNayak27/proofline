import { useAccount } from 'wagmi'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge, Notice, Skeleton } from '@/components/ui/Feedback'
import { useContractStatus } from '@/hooks/useProofline'
import { useOnchainAction } from '@/hooks/useOnchainAction'
import { prooflineAbi } from '@/lib/proofline/abi'
import { EXPLORER_BASE, PROOFLINE_CONTRACT, REPORT_SIGNER_HINT } from '@/lib/proofline/config'
import { shortAddress } from '@/lib/proofline/format'

const ZERO = '0x0000000000000000000000000000000000000000'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <dt style={{ color: 'var(--muted)' }}>{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  )
}

/** Contract configuration. Anyone can read it; only the owner wallet can change it. */
export function Admin() {
  const { address } = useAccount()
  const { status, isPending } = useContractStatus()
  const { state, run, reset, running } = useOnchainAction()

  if (!PROOFLINE_CONTRACT) return <Notice tone="warn" title="Contract address not set">Set VITE_PROOFLINE_CONTRACT to see the contract status.</Notice>
  const contract = PROOFLINE_CONTRACT
  const isOwner = Boolean(address && status && address.toLowerCase() === status.owner.toLowerCase())
  const signerSet = status !== undefined && status.reportSigner !== ZERO
  const call = (label: string, functionName: string, args: readonly unknown[] = []) => run([{ label, address: contract, abi: prooflineAbi, functionName, args }])

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="pl-eyebrow">Contract</p>
        <h1 className="display text-4xl font-bold">Status and administration</h1>
        <p style={{ color: 'var(--muted)' }}>
          The Proofline contract on Arc Testnet.{' '}
          <a className="pl-link" href={`${EXPLORER_BASE}/address/${contract}`} target="_blank" rel="noopener noreferrer">View on the explorer</a>
        </p>
      </header>

      {isPending || !status ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <section className="pl-card p-6">
            <dl className="divide-y" style={{ borderColor: 'var(--border)' }}>
              <Row label="Owner"><span className="mono">{shortAddress(status.owner)}</span> {isOwner ? <Badge tone="success">You</Badge> : null}</Row>
              <Row label="Report signer">{signerSet ? <span className="mono">{shortAddress(status.reportSigner)}</span> : <Badge tone="warn">Not set</Badge>}</Row>
              <Row label="Workflow identity">{status.locked ? <Badge tone="success">Locked</Badge> : <Badge tone="neutral">Unlocked</Badge>}</Row>
              <Row label="Mode">{status.simulation ? <Badge tone="warn">Simulation forwarder</Badge> : <Badge tone="success">Production forwarder</Badge>}</Row>
              <Row label="Contract">{status.paused ? <Badge tone="warn">Paused</Badge> : <Badge tone="success">Running</Badge>}</Row>
            </dl>
          </section>

          {!signerSet ? (
            <Notice tone="warn" title="Campaigns cannot be created yet">
              The owner must register the report signer address, which lets the verification workflow sign rewards. Until then <Link className="pl-link" to="/create">launching a campaign</Link> is blocked.
            </Notice>
          ) : null}
          {status.simulation ? (
            <Notice tone="info" title="Simulation deployment">
              This deployment accepts reports through the simulation forwarder, protected by the report signer. Treat the owner as trusted until the signer is locked, and use test USDC only.
            </Notice>
          ) : null}

          <section className="pl-card space-y-4 p-6">
            <h2 className="display text-xl font-bold">Owner actions</h2>
            {!isOwner ? (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect the owner wallet to change these settings.</p>
            ) : (
              <div className="space-y-4">
                {REPORT_SIGNER_HINT ? (
                  <div className="pl-inner flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="pl-eyebrow">Workflow report signer</p>
                      <p className="mono break-all text-sm">{REPORT_SIGNER_HINT}</p>
                    </div>
                    <Button
                      disabled={running || status.locked || status.reportSigner.toLowerCase() === REPORT_SIGNER_HINT.toLowerCase()}
                      onClick={() => void call('Register the report signer', 'setReportSigner', [REPORT_SIGNER_HINT])}
                    >
                      {status.reportSigner.toLowerCase() === REPORT_SIGNER_HINT.toLowerCase() ? 'Registered' : 'Register signer'}
                    </Button>
                  </div>
                ) : (
                  <Notice tone="info" title="No signer address in this app">Set VITE_PROOFLINE_REPORT_SIGNER to the address printed when the signer key was created.</Notice>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" small disabled={running} onClick={() => void call(status.paused ? 'Resume the contract' : 'Pause the contract', status.paused ? 'unpause' : 'pause')}>
                    {status.paused ? 'Resume contract' : 'Pause contract'}
                  </Button>
                  <Button variant="danger" small disabled={running || status.locked || !signerSet} onClick={() => void call('Lock the workflow identity and signer', 'lockWorkflowIdentity')}>
                    Lock identity permanently
                  </Button>
                </div>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>Locking freezes the workflow identity and report signer for good. It cannot be undone.</p>
                {state.status === 'running' ? <Notice tone="info" title={state.label}>{state.waiting === 'wallet' ? 'Confirm in your wallet.' : 'Waiting for Arc Testnet to confirm.'}</Notice> : null}
                {state.status === 'failed' ? <Notice tone="danger" title="That did not go through">{state.message}</Notice> : null}
                {state.status === 'done' ? <Notice tone="success" title="Done"><button type="button" className="pl-link" onClick={reset}>Dismiss</button></Notice> : null}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
