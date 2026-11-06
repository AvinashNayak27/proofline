// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/**
 * @title ProoflineCampaigns
 * @notice USDC campaign escrow and on-chain creator reward engine for Proofline on Arc Testnet.
 * @dev Uses OpenZeppelin Contracts 5.6.1. The constructor token must be the standard, non-rebasing,
 * non-fee-on-transfer six-decimal USDC ERC-20 interface. No token address is hardcoded.
 * Every report requires a dedicated secp256k1 report signer's signature, bound to this contract and
 * chain, in addition to the immutable CRE forwarder; this contract computes all rewards.
 * Configure a nonzero report signer before campaign creation or funding in either mode.
 * With allowAnyWorkflow false, the owner must configure and permanently lock the workflow identity
 * and report signer before campaign creation or funding. The owner can pause globally but cannot
 * replace the locked workflow ID, workflow owner or report signer, or administratively move campaign
 * funds. An owner acting as a brand has only that brand's ordinary rights. With allowAnyWorkflow true,
 * this is a simulation-only deployment: anyone can call the mock forwarder, but every report still
 * requires the report signer's signature. Deposits are allowed without locking; the owner is trusted
 * because it can change the report signer before lock. Configured identity checks still apply.
 * Direct USDC transfers are not credited to any campaign and cannot be rescued. Native payments
 * are unsupported: there is no payable entry point, receive function or fallback function.
 * Reward records contain only opaque commitments, wallet addresses and measurements, never X
 * handles, tweet text or World ID subjects. creatorCommitment is keccak256 of an unambiguous
 * off-chain encoding of (application, World ID issuer, subject). Campaign display metadata is
 * public event data; do not put personal data in it or in public report calldata.
 */
contract ProoflineCampaigns is IReceiver, ERC165, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant REPORT_SCHEMA_VERSION = 3;
    uint256 public constant MAX_METRIC = 1_000_000_000;

    enum Status { None, Active, Paused, Closed }

    // Field order is intentional: requireProofCode follows status to preserve compact packing.
    struct Campaign {
        address brand;
        uint64 startsAt;
        uint64 endsAt;
        uint32 minViews;
        uint16 bonusBps;
        Status status;
        bool requireProofCode;
        uint96 cpmUsdc6;
        uint96 maxPerPost;
        uint96 maxPerCreator;
        uint128 deposited;
        uint128 paid;
        uint128 withdrawn;
    }

    struct CampaignInput {
        string brandName;
        string title;
        string brief;
        string requiredTag;
        string link;
        uint64 startsAt;
        uint64 endsAt;
        uint32 minViews;
        uint16 bonusBps;
        uint96 cpmUsdc6;
        uint96 maxPerPost;
        uint96 maxPerCreator;
        bool requireProofCode;
    }

    struct RewardReport {
        uint8 schemaVersion;
        uint256 campaignId;
        bytes32 postKey;
        bytes32 creatorCommitment;
        address recipient;
        uint256 uniqueViews;
        uint256 completions;
        uint256 expiry;
    }

    /// @notice Public, event-only display metadata and terms for a newly funded campaign.
    /// @dev CampaignCreated emits this tuple; text is not stored and startsAt is normalized.
    /// brandName: display brand name, at most 40 bytes.
    /// title: nonempty display title, at most 80 bytes.
    /// brief: display brief, at most 800 bytes.
    /// requiredTag: display tag, at most 32 bytes; not enforced on-chain.
    /// link: display link, at most 200 bytes; not enforced on-chain.
    /// startsAt: effective inclusive start timestamp; endsAt: exclusive end timestamp.
    /// minViews: minimum unique views for eligibility; bonusBps: maximum retention bonus in basis points.
    /// cpmUsdc6: six-decimal USDC per 1,000 unique views.
    /// maxPerPost: maximum payout for one post, in USDC base units.
    /// maxPerCreator: lifetime campaign cap per creator commitment.
    /// requireProofCode: brand's choice for whether posts must contain the creator's Proofline code; enforced off-chain by the CRE workflow, not by this contract.
    /// deposit: initial campaign escrow in USDC base units.
    struct CreationEventData {
        string brandName;
        string title;
        string brief;
        string requiredTag;
        string link;
        uint64 startsAt;
        uint64 endsAt;
        uint32 minViews;
        uint16 bonusBps;
        uint96 cpmUsdc6;
        uint96 maxPerPost;
        uint96 maxPerCreator;
        bool requireProofCode;
        uint256 deposit;
    }

    address public immutable forwarder;
    IERC20 public immutable usdc;
    bool public immutable allowAnyWorkflow;
    bytes32 public expectedWorkflowId;
    address public expectedWorkflowOwner;
    uint256 public nextCampaignId = 1;
    uint256 public totalEscrowed;
    mapping(uint256 => Campaign) private campaigns;
    mapping(bytes32 postKey => bool) public postRewarded;
    mapping(uint256 campaignId => mapping(bytes32 creatorCommitment => uint256)) public creatorPaid;
    bool public workflowIdentityLocked;
    address public reportSigner;

    error InvalidForwarder();
    error InvalidUSDC();
    error UnauthorizedForwarder(address sender);
    error WorkflowIdentityNotConfigured();
    error ReportSignerNotConfigured();
    error InvalidReportSignature();
    /// @notice The workflow ID, workflow owner and report signer cannot be changed or locked again.
    error WorkflowIdentityIsLocked();
    /// @notice Real-forwarder deposits require a permanently locked workflow identity.
    error WorkflowIdentityNotLocked();
    error InvalidMetadataLength(uint256 length);
    error InvalidWorkflowId();
    error InvalidWorkflowOwner();
    error RenounceOwnershipDisabled();
    error CampaignNotFound(uint256 id);
    error NotCampaignBrand(uint256 id, address sender);
    error CampaignIsClosed(uint256 id);
    error CampaignNotActive(uint256 id);
    error CampaignNotStarted(uint256 id);
    error CampaignEnded(uint256 id);
    error FieldTooLong(string field);
    error EmptyTitle();
    error InvalidCpm();
    error InvalidMaxPerPost();
    error InvalidMaxPerCreator();
    error InvalidBonusBps();
    error InvalidCampaignDates();
    error InvalidAmount();
    error DepositTooLarge();
    /// @notice A supplied metric exceeds its permitted maximum.
    /// @param value Rejected metric value.
    /// @param max Maximum permitted metric value.
    error InputTooLarge(uint256 value, uint256 max);
    error InvalidReportLength(uint256 length);
    error UnsupportedSchemaVersion(uint8 version);
    error ReportExpired(uint256 expiry);
    error InvalidRecipient();
    error InvalidPostKey();
    error InvalidCreatorCommitment();
    error PostAlreadyRewarded(bytes32 postKey);
    /// @notice A report does not meet its campaign's minimum views.
    /// @param campaignId Campaign rejecting the report.
    /// @param uniqueViews Reported unique views.
    /// @param minViews Campaign's required minimum views.
    error BelowMinViews(uint256 campaignId, uint256 uniqueViews, uint256 minViews);
    /// @notice A creator has exhausted the campaign's lifetime creator cap.
    /// @param campaignId Campaign whose cap was reached.
    /// @param creatorCommitment Opaque creator identity commitment.
    /// @param paid Cumulative amount already paid to the creator in this campaign.
    /// @param cap Campaign's lifetime creator cap in USDC base units.
    error CreatorCapReached(uint256 campaignId, bytes32 creatorCommitment, uint256 paid, uint256 cap);
    /// @notice The campaign has no remaining escrow.
    /// @param campaignId Campaign with an exhausted budget.
    error BudgetExhausted(uint256 campaignId);
    /// @notice The capped and rounded report payout is zero.
    /// @param campaignId Campaign with no payable reward for the report.
    error NothingToPay(uint256 campaignId);

    /// @notice Records a funded campaign and its public, event-only display metadata.
    /// @dev Text is not stored; startsAt is normalized to at least the creation timestamp.
    /// @param id Sequential campaign identifier, starting at one.
    /// @param brand Creating wallet, entitled to close and receive refunds.
    /// @param data Display metadata, normalized dates, reward terms and initial USDC deposit.
    event CampaignCreated(uint256 indexed id, address indexed brand, CreationEventData data);

    /// @notice Records an additional campaign deposit.
    /// @dev Sponsors acquire no control or refund rights.
    /// @param id Campaign identifier.
    /// @param funder Wallet contributing USDC.
    /// @param amount Contributed USDC base units.
    event CampaignFunded(uint256 indexed id, address indexed funder, uint256 amount);

    /// @notice Records a brand-controlled campaign status change.
    /// @dev Global pause changes emit OpenZeppelin's separate Paused/Unpaused events.
    /// @param id Campaign identifier.
    /// @param newStatus New campaign status.
    event CampaignStatusChanged(uint256 indexed id, Status newStatus);

    /// @notice Records permanent closure and refund to the campaign brand.
    /// @dev A zero refund is valid if all deposited USDC has already been paid.
    /// @param id Campaign identifier.
    /// @param refunded USDC base units returned to the brand.
    event CampaignClosed(uint256 indexed id, uint256 refunded);

    /// @notice Records a paid post and its opaque creator commitment.
    /// @dev Contains no X handles, tweet text or World ID subjects; keys must be canonical off-chain.
    /// @param campaignId Campaign paying the reward.
    /// @param postKey Globally unique opaque post key, consumed across all campaigns.
    /// @param creatorCommitment Off-chain commitment to (application, World ID issuer, subject).
    /// @param recipient Report-bound payout wallet.
    /// @param uniqueViews Measured unique video views.
    /// @param completions Measured video completions; clamped to views by the reward formula.
    /// @param amount Actual USDC base units paid after all caps.
    event PostRewarded(
        uint256 indexed campaignId, bytes32 indexed postKey, bytes32 indexed creatorCommitment,
        address recipient, uint256 uniqueViews, uint256 completions, uint256 amount
    );

    /// @notice Records an expected workflow ID update.
    /// @dev Zero disables the ID check, not the owner check.
    /// @param oldWorkflowId Previously configured ID.
    /// @param newWorkflowId Newly configured ID.
    event ExpectedWorkflowIdUpdated(bytes32 oldWorkflowId, bytes32 newWorkflowId);

    /// @notice Records an expected workflow owner update.
    /// @dev Zero disables the owner check, not the ID check.
    /// @param oldWorkflowOwner Previously configured owner.
    /// @param newWorkflowOwner Newly configured owner.
    event ExpectedWorkflowOwnerUpdated(address oldWorkflowOwner, address newWorkflowOwner);

    /// @notice Records a report signer update; zero disables reports and deposits.
    event ReportSignerUpdated(address oldSigner, address newSigner);

    /// @notice Records the permanent lock of the workflow ID, workflow owner and report signer.
    /// @param workflowId Permanently fixed workflow ID; zero disables the ID check.
    /// @param workflowOwner Permanently fixed workflow owner; zero disables the owner check.
    event WorkflowIdentityLocked(bytes32 workflowId, address workflowOwner);

    /// @notice Initializes the immutable forwarder and USDC token and two-step ownership.
    /// @dev allowAnyWorkflow_ true is ONLY for MockKeystoneForwarder simulation deployments on
    /// testnet. After deployment, configure a dedicated nonzero report signer with setReportSigner
    /// before deposits in either mode. Real-forwarder deployments must pass false and configure and
    /// lock an expected identity and the report signer before deposits. Simulation reports also require
    /// signatures; the owner is trusted to change the signer until lockWorkflowIdentity is called.
    /// No administrative withdrawal or rescue exists. Zero initialOwner uses OZ's custom error.
    /// @param forwarder_ Nonzero trusted CRE forwarder.
    /// @param usdc_ Nonzero six-decimal USDC ERC-20 address; supplied, never hardcoded.
    /// @param initialOwner Initial global pause and workflow-configuration administrator.
    /// @param allowAnyWorkflow_ Whether unconfigured identity is allowed for mock simulations only.
    constructor(address forwarder_, address usdc_, address initialOwner, bool allowAnyWorkflow_)
        Ownable(initialOwner)
    {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        if (usdc_ == address(0)) revert InvalidUSDC();
        forwarder = forwarder_;
        usdc = IERC20(usdc_);
        allowAnyWorkflow = allowAnyWorkflow_;
    }

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        _;
    }

    /// @notice Creates an active campaign and escrows the caller's approved USDC.
    /// @dev Text is emitted only. Zero/past startsAt means now; the effective campaign window
    /// cannot exceed 365 days. Accounting and the creation event precede the token interaction and
    /// revert with it. Reverts ReportSignerNotConfigured unless a nonzero report signer is configured.
    /// Reverts WorkflowIdentityNotLocked unless allowAnyWorkflow or the identity is locked.
    /// allowAnyWorkflow permits unlocked deposits ONLY in testnet mock-forwarder simulation mode,
    /// where reports still require signatures and the owner is trusted to change the signer before lock.
    /// @param input Display metadata, effective dates, immutable reward terms and the brand's Proofline-code choice.
    /// @dev requireProofCode is recorded only; the CRE workflow enforces it off-chain.
    /// @param deposit Nonzero initial USDC base units, bounded to uint128.
    /// @return id Newly allocated campaign identifier.
    function createCampaign(CampaignInput calldata input, uint256 deposit)
        external whenNotPaused nonReentrant returns (uint256 id)
    {
        if (reportSigner == address(0)) revert ReportSignerNotConfigured();
        if (!allowAnyWorkflow && !workflowIdentityLocked) revert WorkflowIdentityNotLocked();
        uint64 start = _validateInput(input, deposit);
        id = nextCampaignId++;
        Campaign storage c = campaigns[id];
        c.brand = msg.sender;
        c.startsAt = start;
        c.endsAt = input.endsAt;
        c.minViews = input.minViews;
        c.bonusBps = input.bonusBps;
        c.status = Status.Active;
        c.requireProofCode = input.requireProofCode;
        c.cpmUsdc6 = input.cpmUsdc6;
        c.maxPerPost = input.maxPerPost;
        c.maxPerCreator = input.maxPerCreator;
        c.deposited = uint128(deposit); // _validateInput checks the uint128 bound.
        totalEscrowed += deposit;
        CreationEventData memory data = _creationEventData(input, start, deposit);
        emit CampaignCreated(id, msg.sender, data);
        usdc.safeTransferFrom(msg.sender, address(this), deposit);
    }

    /// @notice Adds approved USDC to an existing, nonclosed campaign from any sponsor.
    /// @dev Allowed during global/campaign pauses and after expiry. Only the brand can reclaim
    /// unused sponsor funds through close; funding grants the sponsor no refund entitlement.
    /// Reverts ReportSignerNotConfigured unless a nonzero report signer is configured.
    /// Reverts WorkflowIdentityNotLocked unless allowAnyWorkflow or the identity is locked.
    /// allowAnyWorkflow permits unlocked deposits ONLY in testnet mock-forwarder simulation mode,
    /// where reports still require signatures and the owner is trusted to change the signer before lock.
    /// Accounting and the funding event precede the token transfer; a failed transfer reverts both.
    /// @param id Campaign identifier.
    /// @param amount Nonzero additional USDC base units; lifetime deposited must fit uint128.
    function fund(uint256 id, uint256 amount) external nonReentrant {
        if (reportSigner == address(0)) revert ReportSignerNotConfigured();
        if (!allowAnyWorkflow && !workflowIdentityLocked) revert WorkflowIdentityNotLocked();
        Campaign storage c = _campaign(id);
        if (c.status == Status.Closed) revert CampaignIsClosed(id);
        if (amount == 0) revert InvalidAmount();
        if (amount > type(uint128).max - uint256(c.deposited)) revert DepositTooLarge();
        c.deposited += uint128(amount);
        totalEscrowed += amount;
        emit CampaignFunded(id, msg.sender, amount);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Lets a campaign's brand pause or resume that campaign.
    /// @dev Cannot reopen a closed campaign; does not override global pause or campaign dates.
    /// @param id Campaign identifier.
    /// @param paused_ True selects Paused; false selects Active.
    function setPaused(uint256 id, bool paused_) external {
        Campaign storage c = _campaign(id);
        _requireBrand(c, id);
        if (c.status == Status.Closed) revert CampaignIsClosed(id);
        c.status = paused_ ? Status.Paused : Status.Active;
        emit CampaignStatusChanged(id, c.status);
    }

    /// @notice Permanently closes the caller's campaign and refunds its entire remaining escrow.
    /// @dev Works during global pause, before the start and after expiry. No other wallet,
    /// including the administrator, can close another brand's campaign or redirect the refund.
    /// @param id Campaign identifier.
    function close(uint256 id) external nonReentrant {
        Campaign storage c = _campaign(id);
        _requireBrand(c, id);
        if (c.status == Status.Closed) revert CampaignIsClosed(id);
        uint256 refund = _remaining(c);
        c.status = Status.Closed;
        c.withdrawn += uint128(refund); // refund + withdrawn <= deposited <= uint128.max.
        totalEscrowed -= refund;
        emit CampaignStatusChanged(id, Status.Closed);
        emit CampaignClosed(id, refund);
        if (refund != 0) usdc.safeTransfer(c.brand, refund);
    }

    /// @notice Returns all stored campaign terms and cumulative escrow accounting.
    /// @dev Reverts CampaignNotFound for an unknown identifier. Display text is in creation events.
    /// @param id Campaign identifier.
    /// @return campaign Stored campaign, including its brand, status and off-chain-enforced requireProofCode choice.
    function getCampaign(uint256 id) external view returns (Campaign memory campaign) {
        return _campaign(id);
    }

    /// @notice Returns the campaign's unspent, unwithdrawn USDC balance.
    /// @dev Reverts CampaignNotFound for unknown identifiers; expiry does not remove escrow.
    /// @param id Campaign identifier.
    /// @return balance Deposited minus paid minus withdrawn, in USDC base units.
    function remaining(uint256 id) public view returns (uint256 balance) {
        return _remaining(_campaign(id));
    }

    /// @notice Quotes the formula reward after the per-post cap, rounding down at each division.
    /// @dev Does not check campaign status/dates, budget or creator allowance. Metrics above 1e9
    /// revert InputTooLarge(value, MAX_METRIC) even when views are zero or below the threshold.
    /// Retention is capped at one.
    /// @param id Campaign identifier.
    /// @param uniqueViews Measured unique video views, at most 1e9.
    /// @param completions Measured video completions, at most 1e9.
    /// @return payout Formula payout in USDC base units after the per-post cap.
    function quote(uint256 id, uint256 uniqueViews, uint256 completions) public view returns (uint256 payout) {
        Campaign storage c = _campaign(id);
        if (uniqueViews > MAX_METRIC) revert InputTooLarge(uniqueViews, MAX_METRIC);
        if (completions > MAX_METRIC) revert InputTooLarge(completions, MAX_METRIC);
        if (uniqueViews == 0 || uniqueViews < c.minViews) return 0;
        uint256 base = Math.mulDiv(uniqueViews, c.cpmUsdc6, 1000);
        uint256 m = Math.min(completions, uniqueViews);
        uint256 bonus = Math.mulDiv(Math.mulDiv(base, c.bonusBps, 10_000), m * m, uniqueViews * uniqueViews);
        return Math.min(base + bonus, c.maxPerPost);
    }

    /// @notice Quotes a payout including creator allowance and remaining campaign escrow.
    /// @dev Uses quote's exact rounding; does not assert report eligibility, status or dates.
    /// @param id Campaign identifier.
    /// @param creatorCommitment Opaque creator identity commitment used for the campaign cap.
    /// @param uniqueViews Measured unique video views, at most 1e9.
    /// @param completions Measured video completions, at most 1e9.
    /// @return payout Formula reward clamped to creator allowance and remaining budget.
    function previewPayout(uint256 id, bytes32 creatorCommitment, uint256 uniqueViews, uint256 completions)
        public view returns (uint256 payout)
    {
        payout = quote(id, uniqueViews, completions);
        Campaign storage c = _campaign(id);
        uint256 paid = creatorPaid[id][creatorCommitment];
        uint256 allowance = paid >= c.maxPerCreator ? 0 : uint256(c.maxPerCreator) - paid;
        return Math.min(payout, Math.min(allowance, _remaining(c)));
    }

    /// @notice Validates a CRE report, computes the capped reward and pays its recipient atomically.
    /// @dev Only the immutable forwarder may call. Metadata is packed bytes32 workflowId |
    /// bytes10 workflowName | address workflowOwner, using offsets [0:32] and [42:62]. Trailing
    /// metadata is ignored. Both configured identity checks apply even in mock mode; without
    /// mock mode at least one must be configured and permanently locked before any campaign deposits.
    /// Every report requires a secp256k1 signature from reportSigner over reportDigest of its body,
    /// without an Ethereum signed-message prefix. Signature verification precedes campaign/post access.
    /// allowAnyWorkflow true is simulation-only: anyone can call the mock forwarder, but cannot forge
    /// the signer's signature. The owner is trusted to change the signer before the permanent lock.
    /// A revert consumes neither post nor allowance. If the recipient is blocklisted by the USDC
    /// issuer, the whole report reverts and consumes nothing; the creator can resubmit with a different
    /// wallet. PostRewarded follows accounting and precedes the transfer; failed transfers revert logs too.
    /// Eligibility errors include campaign context; InputTooLarge includes the rejected metric and limit.
    /// The workflow must supply canonical global post keys and stable creator commitments, never
    /// X handles, tweet text or World ID subjects. Measurements, not amounts, are reported.
    /// @param metadata At least 62 bytes if either workflow identity check is configured.
    /// @param report Exactly 321 bytes: the 256-byte abi.encode(uint8 schemaVersion, uint256 campaignId,
    /// bytes32 postKey, bytes32 creatorCommitment, address recipient, uint256 uniqueViews,
    /// uint256 completions, uint256 expiry), followed by a 65-byte (r,s,v) signature. Version stays three.
    function onReport(bytes calldata metadata, bytes calldata report)
        external override onlyForwarder whenNotPaused nonReentrant
    {
        _checkWorkflow(metadata);
        if (report.length != 321) revert InvalidReportLength(report.length);
        RewardReport memory r = abi.decode(report[0:256], (RewardReport));
        if (r.schemaVersion != REPORT_SCHEMA_VERSION) revert UnsupportedSchemaVersion(r.schemaVersion);
        if (reportSigner == address(0)) revert ReportSignerNotConfigured();
        bytes32 digest = keccak256(abi.encode(
            keccak256("ProoflineCampaigns.Report.v3"), block.chainid, address(this), keccak256(report[0:256])
        ));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, report[256:321]);
        if (err != ECDSA.RecoverError.NoError || signer != reportSigner) revert InvalidReportSignature();
        Campaign storage c = _campaign(r.campaignId);
        if (c.status != Status.Active) revert CampaignNotActive(r.campaignId);
        if (block.timestamp < c.startsAt) revert CampaignNotStarted(r.campaignId);
        if (block.timestamp >= c.endsAt) revert CampaignEnded(r.campaignId);
        if (block.timestamp > r.expiry) revert ReportExpired(r.expiry);
        if (r.recipient == address(0)) revert InvalidRecipient();
        if (r.postKey == bytes32(0)) revert InvalidPostKey();
        if (r.creatorCommitment == bytes32(0)) revert InvalidCreatorCommitment();
        if (postRewarded[r.postKey]) revert PostAlreadyRewarded(r.postKey);
        if (r.uniqueViews > MAX_METRIC) revert InputTooLarge(r.uniqueViews, MAX_METRIC);
        if (r.completions > MAX_METRIC) revert InputTooLarge(r.completions, MAX_METRIC);
        if (r.uniqueViews < c.minViews) revert BelowMinViews(r.campaignId, r.uniqueViews, c.minViews);
        if (creatorPaid[r.campaignId][r.creatorCommitment] >= c.maxPerCreator) {
            revert CreatorCapReached(
                r.campaignId, r.creatorCommitment, creatorPaid[r.campaignId][r.creatorCommitment], c.maxPerCreator
            );
        }
        if (_remaining(c) == 0) revert BudgetExhausted(r.campaignId);
        uint256 amount = previewPayout(r.campaignId, r.creatorCommitment, r.uniqueViews, r.completions);
        if (amount == 0) revert NothingToPay(r.campaignId);

        postRewarded[r.postKey] = true;
        c.paid += uint128(amount); // amount + paid <= deposited - withdrawn <= uint128.max.
        creatorPaid[r.campaignId][r.creatorCommitment] += amount;
        totalEscrowed -= amount;
        emit PostRewarded(r.campaignId, r.postKey, r.creatorCommitment, r.recipient, r.uniqueViews, r.completions, amount);
        usdc.safeTransfer(r.recipient, amount);
    }

    /// @notice Returns the raw digest to sign for a version-three report body.
    /// @dev Binds the body to this chain and contract; no Ethereum signed-message prefix is applied.
    /// @param reportBody256 Exactly 256 bytes of ABI-encoded RewardReport, without the signature.
    /// @return Digest authenticated by onReport.
    function reportDigest(bytes calldata reportBody256) external view returns (bytes32) {
        if (reportBody256.length != 256) revert InvalidReportLength(reportBody256.length);
        return keccak256(abi.encode(
            keccak256("ProoflineCampaigns.Report.v3"), block.chainid, address(this), keccak256(reportBody256)
        ));
    }

    /// @notice Reports ERC-165 and IReceiver support for CRE forwarder discovery.
    /// @dev Delegates other interface IDs to OpenZeppelin ERC165.
    /// @param interfaceId Interface selector to query.
    /// @return supported Whether this contract implements the interface.
    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool supported) {
        return interfaceId == type(IReceiver).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @notice Disables renunciation while preserving inherited two-step ownership transfers.
    /// @dev Always reverts for the owner with RenounceOwnershipDisabled; never moves funds.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    /// @notice Globally pauses campaign creation and report payouts.
    /// @dev Owner only; funding, brand status changes and brand refunds remain available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes campaign creation and report payouts.
    /// @dev Owner only; campaign-specific pauses and date restrictions remain effective.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sets the required workflow ID, or zero to disable this individual check.
    /// @dev Owner only; reverts WorkflowIdentityIsLocked after the permanent identity lock.
    /// With allowAnyWorkflow false, configure at least one identity field and lock before deposits.
    /// Mock mode does not bypass a nonzero configured identity check or the setter lock.
    /// @param newWorkflowId Required workflow ID; zero disables only the ID check.
    function setExpectedWorkflowId(bytes32 newWorkflowId) external onlyOwner {
        if (workflowIdentityLocked) revert WorkflowIdentityIsLocked();
        bytes32 oldWorkflowId = expectedWorkflowId;
        expectedWorkflowId = newWorkflowId;
        emit ExpectedWorkflowIdUpdated(oldWorkflowId, newWorkflowId);
    }

    /// @notice Sets the required workflow owner, or zero to disable this individual check.
    /// @dev Owner only; reverts WorkflowIdentityIsLocked after the permanent identity lock.
    /// With allowAnyWorkflow false, configure at least one identity field and lock before deposits.
    /// Mock mode does not bypass a nonzero configured identity check or the setter lock.
    /// @param newWorkflowOwner Required workflow owner; zero disables only the owner check.
    function setExpectedWorkflowOwner(address newWorkflowOwner) external onlyOwner {
        if (workflowIdentityLocked) revert WorkflowIdentityIsLocked();
        address oldWorkflowOwner = expectedWorkflowOwner;
        expectedWorkflowOwner = newWorkflowOwner;
        emit ExpectedWorkflowOwnerUpdated(oldWorkflowOwner, newWorkflowOwner);
    }

    /// @notice Sets the dedicated report signer, or zero to disable reports and deposits.
    /// @dev Owner only; reverts WorkflowIdentityIsLocked after the permanent lock in either mode.
    /// In simulation mode the owner remains trusted to change the signer until the lock is set.
    /// @param newSigner Authorized secp256k1 signer; zero disables report acceptance and deposits.
    function setReportSigner(address newSigner) external onlyOwner {
        if (workflowIdentityLocked) revert WorkflowIdentityIsLocked();
        address oldSigner = reportSigner;
        reportSigner = newSigner;
        emit ReportSignerUpdated(oldSigner, newSigner);
    }

    /// @notice Permanently freezes the workflow ID, workflow owner and report signer.
    /// @dev Owner only; reverts WorkflowIdentityIsLocked if already locked and
    /// ReportSignerNotConfigured if the signer is zero in either mode. Unless allowAnyWorkflow,
    /// reverts WorkflowIdentityNotConfigured when both identity fields are zero. No unlock exists.
    /// Simulation mode may lock an empty identity; every report still requires the fixed signer's signature.
    function lockWorkflowIdentity() external onlyOwner {
        if (workflowIdentityLocked) revert WorkflowIdentityIsLocked();
        if (reportSigner == address(0)) revert ReportSignerNotConfigured();
        if (!allowAnyWorkflow && expectedWorkflowId == bytes32(0) && expectedWorkflowOwner == address(0)) {
            revert WorkflowIdentityNotConfigured();
        }
        workflowIdentityLocked = true;
        emit WorkflowIdentityLocked(expectedWorkflowId, expectedWorkflowOwner);
    }

    function _campaign(uint256 id) private view returns (Campaign storage c) {
        c = campaigns[id];
        if (c.brand == address(0)) revert CampaignNotFound(id);
    }

    function _remaining(Campaign storage c) private view returns (uint256) {
        return uint256(c.deposited) - uint256(c.paid) - uint256(c.withdrawn);
    }

    function _requireBrand(Campaign storage c, uint256 id) private view {
        if (msg.sender != c.brand) revert NotCampaignBrand(id, msg.sender);
    }

    function _validateInput(CampaignInput calldata input, uint256 deposit) private view returns (uint64 start) {
        if (bytes(input.brandName).length > 40) revert FieldTooLong("brandName");
        if (bytes(input.title).length > 80) revert FieldTooLong("title");
        if (bytes(input.title).length == 0) revert EmptyTitle();
        if (bytes(input.brief).length > 800) revert FieldTooLong("brief");
        if (bytes(input.requiredTag).length > 32) revert FieldTooLong("requiredTag");
        if (bytes(input.link).length > 200) revert FieldTooLong("link");
        if (input.cpmUsdc6 == 0) revert InvalidCpm();
        if (input.maxPerPost == 0) revert InvalidMaxPerPost();
        if (input.maxPerCreator < input.maxPerPost) revert InvalidMaxPerCreator();
        if (input.bonusBps > 10_000) revert InvalidBonusBps();
        start = SafeCast.toUint64(Math.max(input.startsAt, block.timestamp));
        if (
            input.endsAt <= block.timestamp || input.endsAt <= start
                || uint256(input.endsAt) - start > 365 days
        ) revert InvalidCampaignDates();
        if (deposit == 0) revert InvalidAmount();
        if (deposit > type(uint128).max) revert DepositTooLarge();
    }

    function _checkWorkflow(bytes calldata metadata) private view {
        bytes32 workflowId = expectedWorkflowId;
        address workflowOwner = expectedWorkflowOwner;
        if (!allowAnyWorkflow && workflowId == bytes32(0) && workflowOwner == address(0)) {
            revert WorkflowIdentityNotConfigured();
        }
        if (workflowId != bytes32(0) || workflowOwner != address(0)) {
            if (metadata.length < 62) revert InvalidMetadataLength(metadata.length);
            if (workflowId != bytes32(0) && bytes32(metadata[0:32]) != workflowId) revert InvalidWorkflowId();
            if (workflowOwner != address(0) && address(bytes20(metadata[42:62])) != workflowOwner) {
                revert InvalidWorkflowOwner();
            }
        }
    }

    function _creationEventData(CampaignInput calldata input, uint64 start, uint256 deposit)
        private pure returns (CreationEventData memory data)
    {
        data.brandName = input.brandName;
        data.title = input.title;
        data.brief = input.brief;
        data.requiredTag = input.requiredTag;
        data.link = input.link;
        data.startsAt = start;
        data.endsAt = input.endsAt;
        data.minViews = input.minViews;
        data.bonusBps = input.bonusBps;
        data.cpmUsdc6 = input.cpmUsdc6;
        data.maxPerPost = input.maxPerPost;
        data.maxPerCreator = input.maxPerCreator;
        data.requireProofCode = input.requireProofCode;
        data.deposit = deposit;
    }
}
