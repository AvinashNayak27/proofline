import { parseAbi } from 'viem'

const input =
  '(string brandName, string title, string brief, string requiredTag, string link, uint64 startsAt, uint64 endsAt, uint32 minViews, uint16 bonusBps, uint96 cpmUsdc6, uint96 maxPerPost, uint96 maxPerCreator, bool requireProofCode)'

export const campaignCreatedEvent = parseAbi([
  'event CampaignCreated(uint256 indexed id, address indexed brand, (string brandName, string title, string brief, string requiredTag, string link, uint64 startsAt, uint64 endsAt, uint32 minViews, uint16 bonusBps, uint96 cpmUsdc6, uint96 maxPerPost, uint96 maxPerCreator, bool requireProofCode, uint256 deposit) data)',
])[0]

export const postRewardedEvent = parseAbi([
  'event PostRewarded(uint256 indexed campaignId, bytes32 indexed postKey, bytes32 indexed creatorCommitment, address recipient, uint256 uniqueViews, uint256 completions, uint256 amount)',
])[0]

export const prooflineAbi = parseAbi([
  `function createCampaign(${input} input, uint256 deposit) returns (uint256 id)`,
  'function fund(uint256 id, uint256 amount)',
  'function setPaused(uint256 id, bool paused_)',
  'function close(uint256 id)',
  'function getCampaign(uint256 id) view returns ((address brand, uint64 startsAt, uint64 endsAt, uint32 minViews, uint16 bonusBps, uint8 status, bool requireProofCode, uint96 cpmUsdc6, uint96 maxPerPost, uint96 maxPerCreator, uint128 deposited, uint128 paid, uint128 withdrawn))',
  'function remaining(uint256 id) view returns (uint256)',
  'function quote(uint256 id, uint256 uniqueViews, uint256 completions) view returns (uint256)',
  'function previewPayout(uint256 id, bytes32 creatorCommitment, uint256 uniqueViews, uint256 completions) view returns (uint256)',
  'function creatorPaid(uint256 campaignId, bytes32 creatorCommitment) view returns (uint256)',
  'function postRewarded(uint256 campaignId, bytes32 postKey) view returns (bool)',
  'function nextCampaignId() view returns (uint256)',
  'function totalEscrowed() view returns (uint256)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function allowAnyWorkflow() view returns (bool)',
  'function reportSigner() view returns (address)',
  'function workflowIdentityLocked() view returns (bool)',
  'function setReportSigner(address newSigner)',
  'function lockWorkflowIdentity()',
  'function pause()',
  'function unpause()',
  'error CampaignNotFound(uint256 id)',
  'error NotCampaignBrand(uint256 id, address sender)',
  'error CampaignIsClosed(uint256 id)',
  'error FieldTooLong(string field)',
  'error EmptyTitle()',
  'error InvalidCpm()',
  'error InvalidMaxPerPost()',
  'error InvalidMaxPerCreator()',
  'error InvalidBonusBps()',
  'error InvalidCampaignDates()',
  'error InvalidAmount()',
  'error DepositTooLarge()',
  'error ReportSignerNotConfigured()',
  'error WorkflowIdentityNotLocked()',
  'error WorkflowIdentityIsLocked()',
  'error WorkflowIdentityNotConfigured()',
  'error EnforcedPause()',
  'error OwnableUnauthorizedAccount(address account)',
])

/** Campaign status values in the contract's enum. */
export const STATUS = { None: 0, Active: 1, Paused: 2, Closed: 3 } as const
