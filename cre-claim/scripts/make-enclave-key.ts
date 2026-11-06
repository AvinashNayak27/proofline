// Generates the enclave keypair used to protect creators' captured X session requests.
//
//   bun cre-claim/scripts/make-enclave-key.ts [--rotate]
//
// The PRIVATE key is written straight into .env as ENCLAVE_PRIVATE_KEY and is never printed. In
// simulation the CRE CLI reads it from the environment; for a deployed workflow upload it with
// `cre secrets create` (see cre-claim/secrets.yaml). The PUBLIC key is written to .env as
// VITE_ENCLAVE_PUBLIC_KEY (the app encrypts to it) and printed. An existing key is never replaced
// unless --rotate is passed; rotating invalidates the old public key everywhere it was published.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { x25519 } from '@noble/curves/ed25519'
import { bytesToHex, hexToBytes } from 'viem'

const envPath = resolve(import.meta.dir, '../../.env')
const rotate = process.argv.includes('--rotate')
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''

if (/^ENCLAVE_PRIVATE_KEY=.+$/m.test(current) && !rotate) {
  console.error('ENCLAVE_PRIVATE_KEY already exists in .env. Pass --rotate to replace it.')
  process.exit(1)
}

const privateKey = bytesToHex(x25519.utils.randomPrivateKey())
const publicKey = bytesToHex(x25519.getPublicKey(hexToBytes(privateKey)))

const upsert = (text: string, name: string, value: string): string => {
  const line = `${name}=${value}`
  const re = new RegExp(`^${name}=.*$`, 'm')
  if (re.test(text)) return text.replace(re, line)
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`
}

let next = upsert(current, 'ENCLAVE_PRIVATE_KEY', privateKey)
next = upsert(next, 'VITE_ENCLAVE_PUBLIC_KEY', publicKey)
writeFileSync(envPath, next, { mode: 0o600 })
console.log(`Enclave keypair written to .env. Public key: ${publicKey}`)
