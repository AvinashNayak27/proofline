import { useCallback, useRef, useState } from 'react'
import type { Abi, Address, Hex, TransactionReceipt } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { describeError, isUserRejection } from '@/lib/proofline/errors'
import { CHAIN_ID } from '@/lib/proofline/config'
import { useRefreshProofline } from './useProofline'

export type OnchainStep = {
  /** Shown while this step runs, for example "Allow Proofline to hold your USDC". */
  label: string
  address: Address
  abi: Abi | readonly unknown[]
  functionName: string
  args: readonly unknown[]
}

export type ActionState =
  | { status: 'idle' }
  | { status: 'running'; label: string; index: number; total: number; waiting: 'wallet' | 'chain' }
  | { status: 'done'; hash: Hex; receipt: TransactionReceipt }
  | { status: 'failed'; message: string }

/**
 * Runs one or more contract writes in order: switch to Arc Testnet if needed, ask the wallet, then wait
 * for the transaction to be mined before the next step. Every state is a real wallet or chain state.
 */
export function useOnchainAction() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const refresh = useRefreshProofline()
  const [state, setState] = useState<ActionState>({ status: 'idle' })
  const busy = useRef(false)

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  const run = useCallback(
    async (steps: OnchainStep[]): Promise<TransactionReceipt | null> => {
      if (busy.current || steps.length === 0 || !publicClient) return null
      busy.current = true
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        let receipt: TransactionReceipt | null = null
        for (const [index, step] of steps.entries()) {
          setState({ status: 'running', label: step.label, index, total: steps.length, waiting: 'wallet' })
          const hash = await writeContractAsync({
            address: step.address,
            abi: step.abi as Abi,
            functionName: step.functionName,
            args: step.args,
            chainId: CHAIN_ID,
          })
          setState({ status: 'running', label: step.label, index, total: steps.length, waiting: 'chain' })
          receipt = await publicClient.waitForTransactionReceipt({ hash })
          if (receipt.status !== 'success') throw new Error('reverted')
          if (index === steps.length - 1) setState({ status: 'done', hash, receipt })
        }
        await refresh()
        return receipt
      } catch (err) {
        if (isUserRejection(err)) setState({ status: 'idle' })
        else setState({ status: 'failed', message: describeError(err) })
        return null
      } finally {
        busy.current = false
      }
    },
    [chainId, publicClient, refresh, switchChainAsync, writeContractAsync],
  )

  return { state, run, reset, running: state.status === 'running' }
}
