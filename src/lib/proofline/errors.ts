import { BaseError, ContractFunctionRevertedError } from 'viem'

const MESSAGES: Record<string, string> = {
  ReportSignerNotConfigured: 'The Proofline contract is not ready for campaigns yet: its owner still has to register the report signer on the Admin page.',
  WorkflowIdentityNotLocked: 'The contract owner has not locked the workflow identity yet.',
  EnforcedPause: 'The Proofline contract is paused right now.',
  InvalidCampaignDates: 'The campaign dates are not valid. The end must be in the future, after the start, and within 365 days.',
  InvalidCpm: 'The rate per 1,000 views must be more than zero.',
  InvalidMaxPerPost: 'The per-post cap must be more than zero.',
  InvalidMaxPerCreator: 'The per-creator cap cannot be lower than the per-post cap.',
  InvalidBonusBps: 'The completion bonus cannot be more than 100%.',
  InvalidAmount: 'The amount must be more than zero.',
  EmptyTitle: 'Give the campaign a title.',
  FieldTooLong: 'One of the text fields is too long.',
  NotCampaignBrand: 'Only the wallet that created this campaign can do that.',
  CampaignIsClosed: 'This campaign is already closed.',
  CampaignNotFound: 'That campaign does not exist.',
  OwnableUnauthorizedAccount: 'Only the contract owner can do that. Connect the owner wallet.',
  WorkflowIdentityIsLocked: 'The workflow identity is locked permanently and cannot change.',
}

/** True when the person closed the wallet prompt. That is not an error to show. */
export function isUserRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown }
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  if (e.code === 4001 || e.name === 'UserRejectedRequestError' || msg.includes('user rejected') || msg.includes('user denied')) return true
  return e.cause ? isUserRejection(e.cause) : false
}

/** A short, human message for a failed onchain call. Never shows raw RPC text. */
export function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && MESSAGES[name]) return MESSAGES[name]
    }
  }
  const msg = (err instanceof Error ? err.message : '').toLowerCase()
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance') || msg.includes('transfer amount exceeds')) {
    return 'Not enough USDC in this wallet. Use "Get test USDC" in the sidebar, then try again.'
  }
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch')) return 'Network issue. Check your connection and try again.'
  if (msg.includes('reverted')) return 'The transaction was rejected by the contract. Check the values and try again.'
  return 'Something went wrong. Please try again.'
}
