import { describe, expect, test } from 'bun:test'
import { parseSimulationOutput } from './sim-bridge'

const wrap = (inner: string) =>
  `noise\n✓ Workflow Simulation Result:\n${JSON.stringify(inner)}\n\n2026 [SIMULATION] Execution finished`

describe('parseSimulationOutput', () => {
  test('returns a whitelisted rejection', () => {
    expect(parseSimulationOutput(wrap(JSON.stringify({ status: 'rejected', reason: 'identity_rejected' })))).toEqual({
      status: 'rejected',
      reason: 'identity_rejected',
    })
  })

  test('keeps only whitelisted string fields for a delivered claim', () => {
    const out = parseSimulationOutput(
      wrap(JSON.stringify({ status: 'submitted', mode: 'production', txHash: '0xab', claimId: '0xcd', wallet: '0x1', secret: 'x' })),
    )
    expect(out).toEqual({ status: 'submitted', mode: 'production', txHash: '0xab', claimId: '0xcd' })
  })

  test('returns null when the workflow failed or produced no result', () => {
    expect(parseSimulationOutput('✗ workflow error: boom')).toBeNull()
    expect(parseSimulationOutput('✓ Workflow Simulation Result:\nnot json')).toBeNull()
  })
})
