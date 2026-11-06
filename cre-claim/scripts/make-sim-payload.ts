// Builds a local HTTP-trigger payload for `cre workflow simulate --http-payload`.
// It does what the browser does: logs in to DummyJSON, then signs the claim intent.
//
//   DUMMYJSON_USERNAME=... DUMMYJSON_PASSWORD=... bun scripts/make-sim-payload.ts payloads/claim.json
//
// Credentials come from the environment only and are never printed. The signing key is a fresh
// in-memory throwaway (never saved, never funded), so this proves the signature path without
// touching any real wallet. The output file holds a live access token: it is git-ignored, written
// with mode 0600, and should be deleted after the simulation.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { buildTypedData, newIntent } from '../../src/lib/claimIntent'

const out = process.argv[2]
const tamper = process.argv.includes('--tamper-signature')
const username = process.env.DUMMYJSON_USERNAME
const password = process.env.DUMMYJSON_PASSWORD
if (!out || !username || !password) {
  console.error('usage: DUMMYJSON_USERNAME=.. DUMMYJSON_PASSWORD=.. bun scripts/make-sim-payload.ts <out.json> [--tamper-signature]')
  process.exit(2)
}

const login = await fetch('https://dummyjson.com/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'omit',
  body: JSON.stringify({ username, password, expiresInMins: 30 }),
})
if (!login.ok) {
  console.error(`login failed with HTTP ${login.status}`)
  process.exit(1)
}
const { accessToken } = (await login.json()) as { accessToken: string }

const account = privateKeyToAccount(generatePrivateKey())
const intent = newIntent(account.address)
let signature = await account.signTypedData(buildTypedData(intent))
if (tamper) {
  // Flip the first byte of r so the recovered signer is no longer the wallet.
  const flipped = (Number.parseInt(signature.slice(2, 4), 16) ^ 0xff).toString(16).padStart(2, '0')
  signature = `0x${flipped}${signature.slice(4)}` as typeof signature
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(
  out,
  JSON.stringify({
    accessToken,
    wallet: intent.wallet,
    nonce: intent.nonce,
    expiry: intent.expiry.toString(),
    signature,
  }),
  { mode: 0o600 },
)
chmodSync(out, 0o600)
console.log(`wrote ${out} (wallet ${intent.wallet}, expiry ${intent.expiry})`)
