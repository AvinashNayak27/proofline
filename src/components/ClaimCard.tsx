import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { postJsonPrivate } from '@/lib/privateHttp'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { CLAIM_RECEIVER, receiverAbi } from '@/lib/receiver'
import { createPublicClient, http, parseEventLogs, type Hex } from 'viem'

const extensionId = import.meta.env.VITE_X_ANALYTICS_EXTENSION_ID
const enclavePublicKey = import.meta.env.VITE_ENCLAVE_PUBLIC_KEY
const domain = { name: 'X Analytics Arc Claim', version: '1', chainId: arcTestnet.id } as const
const types = { ClaimIntent: [
  { name:'application',type:'string' }, { name:'chainId',type:'uint256' }, { name:'postId',type:'string' },
  { name:'wallet',type:'address' }, { name:'nonce',type:'bytes32' }, { name:'expiry',type:'uint256' },
] } as const
function postIdFrom(link:string): string | undefined {
  try { const u = new URL(link); const m = /^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,20})\/?$/.exec(u.pathname); return u.protocol === 'https:' && ['x.com','twitter.com'].includes(u.hostname) && !u.search && !u.hash ? m?.[1] : undefined } catch { return }
}
type ChromeWindow = Window & { chrome?: { runtime?: { lastError?: { message?: string }; sendMessage: (id:string, message:unknown, callback:(response:unknown)=>void)=>void } } }
function extension(message:unknown): Promise<any> { return new Promise((resolve,reject) => {
  const runtime = (window as ChromeWindow).chrome?.runtime
  if (!extensionId || !runtime) return reject(new Error('Load the extension and set its ID in VITE_X_ANALYTICS_EXTENSION_ID.'))
  runtime.sendMessage(extensionId,message,(r:unknown) => {
    if (runtime.lastError) reject(new Error('Extension unavailable. Reload it and this page.'))
    else resolve(r)
  })
}) }
const delay = (ms:number) => new Promise(r => setTimeout(r,ms))
export function ClaimCard() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const [link,setLink] = useState('')
  const [phase,setPhase] = useState('')
  const [error,setError] = useState('')
  const [result,setResult] = useState<any>(null)
  const getViews = async () => {
    setError(''); setResult(null)
    const postId = postIdFrom(link)
    if (!postId || !address) { setError('Enter a valid X post link and connect your wallet.'); return }
    if (!enclavePublicKey || !/^0x[0-9a-fA-F]{64}$/.test(enclavePublicKey)) { setError('Set VITE_ENCLAVE_PUBLIC_KEY from the enclave key script.'); return }
    try {
      setPhase('Switching to Arc Testnet')
      if (chainId !== arcTestnet.id) await switchChainAsync({chainId:arcTestnet.id})
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}` as Hex
      const expiry = BigInt(Math.floor(Date.now()/1000)+600)
      setPhase('Sign the post claim in your wallet')
      const signature = await signTypedDataAsync({domain,types,primaryType:'ClaimIntent',message:{application:'x-analytics-arc-v1',chainId:BigInt(arcTestnet.id),postId,wallet:address,nonce,expiry}})
      setPhase('Opening your analytics page')
      const begun = await extension({type:'BEGIN_CAPTURE',link,wallet:address,nonce,expiry:expiry.toString(),enclavePublicKey})
      if (!begun?.ok) throw new Error('Could not open the analytics page through the extension.')
      setPhase('Waiting for the owner analytics request')
      let capture:any
      for (let i=0;i<60;i++) { await delay(2000); const s = await extension({type:'CAPTURE_STATUS'}); if (s?.ready && s.postId === postId) { capture=await extension({type:'GET_CAPTURE'}); break } }
      if (!capture?.ok || capture.postId !== postId) throw new Error('No TweetActivityQuery was captured. Open the Analytics tab while signed into your X account, then try again.')
      setPhase('Replaying in CRE and checking the metrics')
      const response = await postJsonPrivate('/cre/trigger',{input:{postId,wallet:address,nonce,expiry:expiry.toString(),signature,encryptedSessionMaterial:capture.encryptedSessionMaterial}},150_000)
      if (response.status < 200 || response.status >= 300) throw new Error('The local CRE bridge failed. Check that bun run x:bridge is running.')
      const outcome = (response.json as any)?.result
      if (!outcome || outcome.status === 'rejected') throw new Error(`CRE rejected the claim: ${outcome?.reason || 'unknown reason'}`)
      if (outcome.status === 'submitted') {
        const receiver = CLAIM_RECEIVER
        if (!receiver || !/^0x[0-9a-fA-F]{64}$/.test(outcome.txHash || '')) throw new Error('CRE did not return a payout transaction.')
        setPhase('Confirming the USDC transfer')
        const client = createPublicClient({ chain: arcTestnet, transport: http() })
        const receipt = await client.waitForTransactionReceipt({ hash: outcome.txHash as Hex, timeout: 90_000 })
        const paid = receipt.status === 'success' && parseEventLogs({ abi: receiverAbi, logs: receipt.logs, eventName: 'ClaimPaid', strict: false }).some(log =>
          log.address.toLowerCase() === receiver.toLowerCase() &&
          log.args.recipient?.toLowerCase() === address.toLowerCase() &&
          log.args.claimId?.toLowerCase() === outcome.claimId?.toLowerCase() &&
          log.args.amount === BigInt(outcome.amountUsdc6),
        )
        if (!paid) throw new Error(`The transaction did not confirm the expected USDC payout. Check ${outcome.txHash} on the Arc explorer.`)
      }
      setResult(outcome); setPhase('')
    } catch (e) { setPhase(''); setError(e instanceof Error ? e.message : 'The claim failed.') }
  }
  return <section className="rounded-3xl p-5 space-y-4" style={{background:'var(--surface-strong)',border:'1px solid var(--border)'}}>
    <div><p className="text-xs font-semibold uppercase" style={{color:'var(--muted)'}}>Arc Testnet · X analytics</p><h2 className="display text-2xl font-bold">Get views and claim</h2><p className="text-sm" style={{color:'var(--muted)'}}>Unique video views are shown as evidence. Video completions ÷ 1000 sets the USDC reward. One claim per post.</p></div>
    <label className="block text-sm font-semibold">Your post link<input className="mt-2 w-full rounded-xl border p-3 font-normal" placeholder="https://x.com/you/status/1234567890" value={link} onChange={e=>setLink(e.target.value)} /></label>
    <ConnectKitButton.Custom>{({show})=><button onClick={show} className="rounded-xl border px-4 py-2 text-sm">{isConnected && address ? `${address.slice(0,6)}…${address.slice(-4)}` : 'Connect wallet'}</button>}</ConnectKitButton.Custom>
    <button onClick={()=>void getViews()} disabled={!isConnected || !!phase} className="w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-40" style={{background:'var(--accent)'}}>{phase || 'Get views'}</button>
    {error && <p role="alert" className="text-sm" style={{color:'var(--danger)'}}>{error}</p>}
    {result && <div className="rounded-xl p-4 space-y-1" style={{background:'var(--surface-muted)'}}><p>Unique video views: <strong>{Number(result.uniqueViews).toLocaleString()}</strong></p><p>100% completions: <strong>{Number(result.completions).toLocaleString()}</strong></p><p>Reward: <strong>{formatUsdc(BigInt(result.amountUsdc6))} USDC</strong></p><p className="text-xs">{result.status === 'verified' ? 'Local simulation verified; no transfer submitted.' : 'USDC transfer confirmed on Arc Testnet.'}</p>{result.txHash && <a target="_blank" rel="noopener noreferrer" href={buildTxExplorerUrl(arcTestnet.id,result.txHash)} className="text-xs underline">View transaction</a>}</div>}
  </section>
}
