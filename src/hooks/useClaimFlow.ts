import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSignTypedData, useSwitchChain } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import type { Hex } from 'viem'
import { buildTypedData, computeClaimId, newIntent } from '@/lib/claimIntent'
import { ClaimApiError, loginToDummyJson, submitClaimToCre, type ApiFailure } from '@/lib/claimApi'
import { CLAIM_RECEIVER, receiverAbi } from '@/lib/receiver'
import { isEnclavePublicKey, sealSessionMaterial } from '@/lib/sessionCrypto'

export type Phase =
  | { name: 'signed-out' }
  | { name: 'logging-in' }
  | { name: 'signed-in' }
  | { name: 'awaiting-signature' }
  | { name: 'submitting' }
  | { name: 'verifying'; claimId: Hex; expiry: bigint; startedAt: number; reportTx: Hex | null }
  | { name: 'submitted' }
  | { name: 'paid'; txHash: Hex | null; amount: bigint | null }
  | { name: 'timed-out' }
  | { name: 'failed'; message: string }

const FAILURE_COPY: Record<ApiFailure, string> = {
  invalid_credentials: 'Sign in failed. Check the username and password and try again.',
  network: 'Could not reach the service. Check your connection and try again.',
  unavailable: 'The service did not accept the request. Try again in a moment.',
  unexpected: 'Something went wrong. Please try again.',
}

const ENCLAVE_PUBLIC_KEY: unknown = import.meta.env.VITE_ENCLAVE_PUBLIC_KEY
const NOT_CONFIGURED_COPY = 'Secure claiming is not set up yet: the enclave public key is missing from this app.'

const POLL_MS = 3_000
/** How long to wait for an onchain payout after the trigger accepted the claim. */
const PAYOUT_WAIT_MS = 120_000
const REJECTION_COPY: Record<string, string> = {
  weight_invalid: 'This account has no valid weight to reward.',
  amount_over_cap: 'The reward for this account is above the per-claim limit.',
  identity_unreadable: 'The DummyJSON profile could not be read. Try again.',
  already_claimed: 'This DummyJSON account has already claimed its reward. Each account can claim once.',
  delivery_reverted: 'The payout was not made. This account may already have claimed.',
  session_unreadable: 'The secure session could not be opened. Sign in again and retry.',
  token_rejected: 'Your DummyJSON session was not accepted. Sign in again.',
  bad_signature: 'The wallet signature did not verify. Try again.',
  intent_expired: 'The claim expired before it was checked. Try again.',
  intent_expiry_too_far: 'The claim window was invalid. Try again.',
  invalid_request: 'The claim request was not valid. Try again.',
}

const ALREADY_CLAIMED_COPY =
  'The payout was not made. This DummyJSON account has probably already claimed, since each account can claim once.'

const LOG_LOOKBACK_BLOCKS = 5_000n

function isUserRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; name?: unknown; message?: unknown }
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  return e.code === 4001 || e.name === 'UserRejectedRequestError' || msg.includes('user rejected')
}

/**
 * Holds the DummyJSON access token in memory only (a ref, never storage, URL or state that is
 * rendered) and drops it the moment a claim is submitted, whatever the outcome.
 */
export function useClaimFlow() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const tokenRef = useRef<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'signed-out' })

  const signIn = useCallback(async (username: string, password: string) => {
    setPhase({ name: 'logging-in' })
    try {
      tokenRef.current = await loginToDummyJson(username.trim(), password)
      setPhase({ name: 'signed-in' })
    } catch (err) {
      tokenRef.current = null
      const failure = err instanceof ClaimApiError ? err.failure : 'unexpected'
      setPhase({ name: 'failed', message: FAILURE_COPY[failure] })
    }
  }, [])

  const claim = useCallback(async () => {
    const accessToken = tokenRef.current
    if (!accessToken || !address) return
    const enclaveKey = ENCLAVE_PUBLIC_KEY
    if (typeof enclaveKey !== 'string' || !isEnclavePublicKey(enclaveKey)) {
      tokenRef.current = null
      setPhase({ name: 'failed', message: NOT_CONFIGURED_COPY })
      return
    }
    try {
      if (chainId !== arcTestnet.id) await switchChainAsync({ chainId: arcTestnet.id })
      setPhase({ name: 'awaiting-signature' })
      const intent = newIntent(address)
      const signature = await signTypedDataAsync(buildTypedData(intent))

      setPhase({ name: 'submitting' })
      // The readable token never leaves the browser: it is encrypted to the enclave's public key,
      // bound to this signed intent, and dropped from memory before the request is sent.
      const encryptedSessionMaterial = sealSessionMaterial(accessToken, enclaveKey, intent)
      tokenRef.current = null
      const receipt = await submitClaimToCre({
        encryptedSessionMaterial,
        wallet: intent.wallet,
        nonce: intent.nonce,
        expiry: intent.expiry.toString(),
        signature,
      })
      const outcome = receipt.outcome
      if (outcome?.status === 'rejected') {
        setPhase({ name: 'failed', message: REJECTION_COPY[outcome.reason ?? ''] ?? 'The claim was rejected.' })
      } else if (CLAIM_RECEIVER && outcome?.status !== 'verified') {
        setPhase({
          name: 'verifying',
          claimId: computeClaimId(CLAIM_RECEIVER, intent),
          expiry: intent.expiry,
          startedAt: Date.now(),
          reportTx: outcome?.txHash ?? null,
        })
      } else {
        setPhase({ name: 'submitted' })
      }
    } catch (err) {
      if (isUserRejection(err)) {
        setPhase(tokenRef.current ? { name: 'signed-in' } : { name: 'signed-out' })
        return
      }
      tokenRef.current = null
      const failure = err instanceof ClaimApiError ? err.failure : 'unexpected'
      setPhase({ name: 'failed', message: FAILURE_COPY[failure] })
    }
  }, [address, chainId, signTypedDataAsync, switchChainAsync])

  const reset = useCallback(() => {
    tokenRef.current = null
    setPhase({ name: 'signed-out' })
  }, [])

  // Watch the receiver for this claim's opaque id. Only real chain reads move the state forward.
  const verifying = phase.name === 'verifying' ? phase : null
  useEffect(() => {
    const receiver = CLAIM_RECEIVER
    if (!verifying || !receiver || !publicClient) return
    const { claimId, expiry, startedAt, reportTx } = verifying
    const deadline = Math.min(Number(expiry) * 1000, startedAt + PAYOUT_WAIT_MS)
    let stopped = false
    const tick = async () => {
      try {
        const done = await publicClient.readContract({
          address: receiver,
          abi: receiverAbi,
          functionName: 'claimed',
          args: [claimId],
        })
        if (stopped) return
        if (done) {
          let txHash: Hex | null = null
          let amount: bigint | null = null
          try {
            const head = await publicClient.getBlockNumber()
            const logs = await publicClient.getContractEvents({
              address: receiver,
              abi: receiverAbi,
              eventName: 'ClaimPaid',
              args: { claimId },
              fromBlock: head > LOG_LOOKBACK_BLOCKS ? head - LOG_LOOKBACK_BLOCKS : 0n,
              toBlock: head,
            })
            txHash = logs[0]?.transactionHash ?? null
            amount = logs[0]?.args.amount ?? null
          } catch {
            txHash = null
            amount = null
          }
          if (!stopped) setPhase({ name: 'paid', txHash, amount })
          return
        }
        // The report transaction is mined but the receiver never marked this claim paid: it rejected
        // the report (a repeat claim by the same account is the usual cause). Say so right away.
        if (reportTx) {
          const mined = await publicClient.getTransactionReceipt({ hash: reportTx }).catch(() => null)
          if (stopped) return
          if (mined) {
            const again = await publicClient.readContract({
              address: receiver,
              abi: receiverAbi,
              functionName: 'claimed',
              args: [claimId],
            })
            if (stopped) return
            if (!again) {
              setPhase({ name: 'failed', message: ALREADY_CLAIMED_COPY })
              return
            }
          }
        }
      } catch {
        // transient RPC error: keep polling until the deadline
      }
      if (!stopped && Date.now() > deadline) setPhase({ name: 'timed-out' })
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [verifying, publicClient])

  return { phase, signedIn: phase.name === 'signed-in', signIn, claim, reset, receiver: CLAIM_RECEIVER }
}
