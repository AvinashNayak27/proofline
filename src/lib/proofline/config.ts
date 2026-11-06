import { isAddress, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc, requireChain } from '@/onchain-facts'

export const CHAIN_ID = arcTestnet.id

const contract: unknown = import.meta.env.VITE_PROOFLINE_CONTRACT
const deployBlock: unknown = import.meta.env.VITE_PROOFLINE_DEPLOY_BLOCK
const extensionId: unknown = import.meta.env.VITE_PROOFLINE_EXTENSION_ID ?? import.meta.env.VITE_X_ANALYTICS_EXTENSION_ID
const enclaveKey: unknown = import.meta.env.VITE_ENCLAVE_PUBLIC_KEY
const signerHint: unknown = import.meta.env.VITE_PROOFLINE_REPORT_SIGNER

/** ProoflineCampaigns on Arc Testnet, or null while VITE_PROOFLINE_CONTRACT is unset or malformed. */
export const PROOFLINE_CONTRACT: Address | null = typeof contract === 'string' && isAddress(contract) ? contract : null

/** First block to read events from. Never block 0: the chain is deep. */
export const PROOFLINE_DEPLOY_BLOCK: bigint = typeof deployBlock === 'string' && /^[0-9]{1,12}$/.test(deployBlock) ? BigInt(deployBlock) : 0n

export const EXTENSION_ID: string | null = typeof extensionId === 'string' && /^[a-p]{32}$/.test(extensionId) ? extensionId : null
export const ENCLAVE_PUBLIC_KEY: `0x${string}` | null = typeof enclaveKey === 'string' && /^0x[0-9a-fA-F]{64}$/.test(enclaveKey) ? (enclaveKey as `0x${string}`) : null
export const REPORT_SIGNER_HINT: Address | null = typeof signerHint === 'string' && isAddress(signerHint) ? signerHint : null

export const USDC_ADDRESS: Address = (() => {
  const usdc = getUsdc(CHAIN_ID)
  if (!usdc) throw new Error('USDC is not registered for Arc Testnet')
  return usdc.address as Address
})()

export const EXPLORER_BASE: string = requireChain(CHAIN_ID).explorerBase
