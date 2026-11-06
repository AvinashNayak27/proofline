// Local-only bridge that runs `cre workflow simulate` once per claim and returns the workflow's
// real outcome to the app.
//
// `cre workflow simulate --listen` answers every POST with an empty 200, so the app cannot tell a
// payout from a rejection (for example a login that is not the expected user) and would wait for a
// payout that never comes. This bridge runs one simulation per request and returns only a coarse,
// whitelisted result: status, reason, and for a delivered report the claim id, payout amount and tx hash.
//
//   SIM_TARGET      default staging-settings (use local-simulation for a no-write dry run)
//   SIM_BROADCAST   "true" (default for staging-settings) sends the report through the mock forwarder
//   BRIDGE_PORT     default 2002
//   CRE_BIN         default "cre"
//
//   CRE_TRIGGER_URL=http://127.0.0.1:2002 bun run dev
//   bun run cre:bridge
//
// The access token must reach the CLI, so the bridge writes the payload to a private temp file
// (mode 0600, own 0700 directory) and deletes it as soon as the run ends. It never logs payloads
// or CLI output. This is a development tool for simulation only; a deployed workflow uses the
// signing relay instead.
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ALLOWED_KEYS = ['encryptedSessionMaterial', 'wallet', 'nonce', 'expiry', 'signature']
const MAX_BODY_BYTES = 16 * 1024
const RUN_TIMEOUT_MS = 120_000
const RESULT_MARKER = 'Workflow Simulation Result:'
const SAFE_FIELDS = ['status', 'reason', 'mode', 'txHash', 'claimId', 'amountUsdc6'] as const

export type BridgeResult = Partial<Record<(typeof SAFE_FIELDS)[number], string>>

/** Extracts the workflow's returned JSON from CLI output and keeps only whitelisted string fields. */
export function parseSimulationOutput(output: string): BridgeResult | null {
  const at = output.indexOf(RESULT_MARKER)
  if (at < 0) return null
  const line = output
    .slice(at + RESULT_MARKER.length)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return null
  try {
    let value: unknown = JSON.parse(line)
    if (typeof value === 'string') value = JSON.parse(value)
    if (typeof value !== 'object' || value === null) return null
    const out: BridgeResult = {}
    for (const key of SAFE_FIELDS) {
      const v = (value as Record<string, unknown>)[key]
      if (typeof v === 'string') out[key] = v
    }
    return out.status ? out : null
  } catch {
    return null
  }
}

function isClaimInput(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === ALLOWED_KEYS.length &&
    keys.every((k) => ALLOWED_KEYS.includes(k) && typeof (value as Record<string, unknown>)[k] === 'string')
  )
}

const projectRoot = resolve(import.meta.dir, '..')
const target = process.env.SIM_TARGET ?? 'staging-settings'
const broadcast = (process.env.SIM_BROADCAST ?? (target === 'staging-settings' ? 'true' : 'false')) === 'true'
const creBin = process.env.CRE_BIN ?? 'cre'

function runSimulation(input: Record<string, string>): Promise<BridgeResult | null> {
  const dir = mkdtempSync(join(tmpdir(), 'claim-'), { encoding: 'utf8' })
  chmodSync(dir, 0o700)
  const file = join(dir, 'payload.json')
  writeFileSync(file, JSON.stringify(input), { mode: 0o600 })
  const args = [
    'workflow', 'simulate', 'claim-workflow',
    '--target', target,
    '--non-interactive', '--trigger-index', '0',
    '--http-payload', file,
    ...(broadcast ? ['--broadcast'] : []),
  ]
  return new Promise((done) => {
    let output = ''
    const child = spawn(creBin, args, { cwd: projectRoot })
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS)
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const finish = () => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      done(parseSimulationOutput(output))
    }
    child.on('error', finish)
    child.on('close', finish)
  })
}

if (import.meta.main) {
  const port = Number(process.env.BRIDGE_PORT ?? 2002)
  let queue: Promise<unknown> = Promise.resolve() // one simulation at a time

  Bun.serve({
    hostname: '127.0.0.1',
    port,
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/health') return new Response('OK')
      if (url.pathname !== '/trigger' || req.method !== 'POST') return new Response('Not found', { status: 404 })
      if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return Response.json({ ok: false }, { status: 413 })

      let input: unknown
      try {
        input = ((await req.json()) as { input?: unknown }).input
      } catch {
        return Response.json({ ok: false }, { status: 400 })
      }
      if (!isClaimInput(input)) return Response.json({ ok: false }, { status: 400 })

      const run = queue.then(() => runSimulation(input))
      queue = run.catch(() => null)
      const result = await run
      console.log(`simulation finished: ${result?.status ?? 'no result'}`)
      if (!result) return Response.json({ ok: false, error: 'workflow_error' }, { status: 502 })
      return Response.json({ ok: true, result })
    },
  })
  console.log(`simulation bridge on http://127.0.0.1:${port} (target ${target}, broadcast ${String(broadcast)})`)
}
