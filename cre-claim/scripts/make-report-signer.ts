// Generates the report-signer key that authenticates every reward report to the Proofline contract.
//
//   bun cre-claim/scripts/make-report-signer.ts [--rotate]
//
// The PRIVATE key is written straight into .env as REPORT_SIGNER_PRIVATE_KEY and is never printed.
// It is read only by the CRE workflow inside the enclave (declared in cre-claim/secrets.yaml). The
// contract owner must register the printed ADDRESS once with setReportSigner(address). An existing
// key is never replaced unless --rotate is passed; rotating invalidates reports signed by the old key.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const envPath = resolve(import.meta.dir, '../../.env')
const rotate = process.argv.includes('--rotate')
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''

if (/^REPORT_SIGNER_PRIVATE_KEY=.+$/m.test(current) && !rotate) {
  console.error('REPORT_SIGNER_PRIVATE_KEY already exists in .env. Pass --rotate to replace it.')
  process.exit(1)
}

const privateKey = generatePrivateKey()
const address = privateKeyToAccount(privateKey).address

const upsert = (text: string, name: string, value: string): string => {
  const line = `${name}=${value}`
  const re = new RegExp(`^${name}=.*$`, 'm')
  if (re.test(text)) return text.replace(re, line)
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`
}

let next = upsert(current, 'REPORT_SIGNER_PRIVATE_KEY', privateKey)
next = upsert(next, 'VITE_PROOFLINE_REPORT_SIGNER', address)
writeFileSync(envPath, next, { mode: 0o600 })
console.log(`Report signer written to .env. Register this address with setReportSigner: ${address}`)
