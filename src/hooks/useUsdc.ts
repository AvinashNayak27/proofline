import { erc20Abi, type Address } from 'viem'
import { useAccount, useReadContracts } from 'wagmi'
import { CHAIN_ID, PROOFLINE_CONTRACT, USDC_ADDRESS } from '@/lib/proofline/config'

/** The connected wallet's USDC balance and how much Proofline may already spend. Both in base units. */
export function useUsdc() {
  const { address } = useAccount()
  const result = useReadContracts({
    allowFailure: false,
    query: { enabled: Boolean(address && PROOFLINE_CONTRACT), refetchInterval: 15_000 },
    contracts: [
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address as Address], chainId: CHAIN_ID },
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [address as Address, PROOFLINE_CONTRACT as Address], chainId: CHAIN_ID },
    ],
  })
  return { ...result, balance: result.data?.[0], allowance: result.data?.[1] }
}
