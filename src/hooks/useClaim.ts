import { useCallback, useRef, useState } from 'react'
import type { Hex, PublicClient } from 'viem'
import { useAccount, usePublicClient, useSignTypedData, useSwitchChain } from 'wagmi'
import { isUserRejection } from '@/lib/proofline/errors'
import { prooflineAbi } from '@/lib/proofline/abi'
import { submitClaim } from '@/lib/proofline/claimApi'
import { REJECTION_COPY, SERVER_COPY } from '@/lib/proofline/claimCopy'
import { buildTypedData, newIntent, parsePostUrl, postKey } from '@/lib/proofline/claim'
import { CHAIN_ID, ENCLAVE_PUBLIC_KEY, PROOFLINE_CONTRACT } from '@/lib/proofline/config'
import { beginCapture, captureStatus, ExtensionError, getCapture } from '@/lib/proofline/extension'
import { useRefreshProofline } from './useProofline'
import { useWorldSession } from './useWorldSession'

export type ClaimPhase =
  | { name: 'idle' }
  | { name: 'switching' }
  | { name: 'signing' }
  | { name: 'capturing' }
  | { name: 'verifying' }
  | { name: 'confirming'; txHash: Hex }
  | { name: 'paid'; txHash: Hex; amountUsdc6: bigint | null; views: string | null; completions: string | null }
  | { name: 'failed'; message: string }

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const CAPTURE_POLLS = 60
const CAPTURE_INTERVAL_MS = 2_000

/**
 * The creator's claim, step by step. Every phase here is something that actually happened:
 * a wallet signature, the extension reporting a capture, the server returning a result, a mined transaction.
 */
export function useClaim(campaignId: bigint) {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const publicClient = usePublicClient({ chainId: CHAIN_ID }) as PublicClient | undefined
  const { session } = useWorldSession()
  const refreshChain = useRefreshProofline()
  const [phase, setPhase] = useState<ClaimPhase>({ name: 'idle' })
  const running = useRef(false)

  const reset = useCallback(() => setPhase({ name: 'idle' }), [])

  const submit = useCallback(
    async (postLink: string) => {
      if (running.current) return
      const post = parsePostUrl(postLink)
      if (!post) return setPhase({ name: 'failed', message: 'Paste the link to your post, like https://x.com/you/status/123…, without anything after the number.' })
      if (!address || session.status !== 'signed-in') return setPhase({ name: 'failed', message: 'Sign in with World ID and connect your wallet first.' })
      if (!ENCLAVE_PUBLIC_KEY || !PROOFLINE_CONTRACT) return setPhase({ name: 'failed', message: 'Proofline is not fully configured yet.' })

      running.current = true
      try {
        if (chainId !== CHAIN_ID) {
          setPhase({ name: 'switching' })
          await switchChainAsync({ chainId: CHAIN_ID })
        }

        setPhase({ name: 'signing' })
        const intent = newIntent({ campaignId, postId: post.postId, wallet: address, creatorCommitment: session.creatorCommitment })
        const signature = await signTypedDataAsync(buildTypedData(intent))

        setPhase({ name: 'capturing' })
        const begun = await beginCapture({
          link: postLink.trim(),
          campaignId: campaignId.toString(),
          wallet: address,
          nonce: intent.nonce,
          expiry: intent.expiry.toString(),
          enclavePublicKey: ENCLAVE_PUBLIC_KEY,
        })
        if (!begun?.ok) throw new Error('capture-start')
        let sealed: string | undefined
        for (let i = 0; i < CAPTURE_POLLS; i++) {
          await delay(CAPTURE_INTERVAL_MS)
          const status = await captureStatus()
          if (status?.ready && status.postId === post.postId) {
            const capture = await getCapture()
            if (capture?.ok && capture.postId === post.postId) sealed = capture.encryptedSessionMaterial
            break
          }
        }
        if (!sealed) {
          return setPhase({ name: 'failed', message: 'Your analytics page was not captured. Stay signed in to X, open the post\'s Analytics, and try again.' })
        }

        setPhase({ name: 'verifying' })
        const result = await submitClaim({
          campaignId: campaignId.toString(),
          postUrl: postLink.trim(),
          wallet: address,
          nonce: intent.nonce,
          expiry: intent.expiry.toString(),
          signature,
          encryptedSessionMaterial: sealed,
        })

        if (result.kind === 'rejected') return setPhase({ name: 'failed', message: REJECTION_COPY[result.reason] ?? 'The post was not accepted.' })
        if (result.kind === 'server') return setPhase({ name: 'failed', message: SERVER_COPY[result.error] ?? 'The verification service could not complete the check.' })
        if (result.kind === 'network') return setPhase({ name: 'failed', message: 'Could not reach Proofline. Check your connection and try again.' })
        if (result.kind === 'verified') return setPhase({ name: 'failed', message: 'The check passed in dry-run mode, so nothing was paid. The server is running without broadcast.' })
        if (!result.txHash || !publicClient) return setPhase({ name: 'failed', message: 'The reward was submitted but the transaction could not be confirmed.' })

        setPhase({ name: 'confirming', txHash: result.txHash as Hex })
        await publicClient.waitForTransactionReceipt({ hash: result.txHash as Hex, timeout: 60_000 })
        const rewarded = await publicClient.readContract({
          address: PROOFLINE_CONTRACT,
          abi: prooflineAbi,
          functionName: 'postRewarded',
          args: [campaignId, postKey(post.postId)],
        })
        if (!rewarded) return setPhase({ name: 'failed', message: REJECTION_COPY.delivery_reverted })
        void refreshChain()
        setPhase({
          name: 'paid',
          txHash: result.txHash as Hex,
          amountUsdc6: result.amountUsdc6 ? BigInt(result.amountUsdc6) : null,
          views: result.views,
          completions: result.completions,
        })
      } catch (err) {
        if (isUserRejection(err)) return setPhase({ name: 'idle' })
        if (err instanceof ExtensionError) {
          return setPhase({
            name: 'failed',
            message:
              err.kind === 'not-configured'
                ? 'The Proofline companion extension is not set up in this app. Add its ID to VITE_PROOFLINE_EXTENSION_ID.'
                : 'The Proofline companion extension did not answer. Install or reload it, then reload this page.',
          })
        }
        setPhase({ name: 'failed', message: 'Something went wrong. Please try again.' })
      } finally {
        running.current = false
      }
    },
    [address, campaignId, chainId, publicClient, refreshChain, session, signTypedDataAsync, switchChainAsync],
  )

  return { phase, submit, reset, busy: ['switching', 'signing', 'capturing', 'verifying', 'confirming'].includes(phase.name) }
}
