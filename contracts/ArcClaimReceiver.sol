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
import {IReceiver} from "./interfaces/IReceiver.sol";

/**
 * @title ArcClaimReceiver
 * @notice TESTNET-ONLY demo for Arc Testnet (chain 5042002), paying once per user commitment.
 * @dev Trusts only the immutable CRE KeystoneForwarder to authenticate reports. Login and wallet
 * signature verification happen off-chain, not here. Deploy separately for mock-forwarder simulations.
 * allowAnyWorkflow is ONLY for MockKeystoneForwarder broadcast-simulation deployments on testnet,
 * which supply no real workflow metadata. Production (KeystoneForwarder) deployments MUST pass false
 * and configure an expected workflow ID and/or owner before payouts are accepted.
 * Fund by ERC-20 transfer only. Arc USDC at 0x3600000000000000000000000000000000000000
 * exposes six ERC-20 decimals; native-value payments are deliberately unsupported.
 * Payout = weight/100 USDC, computed off-chain and bounded here by maxClaimAmount.
 * Claim IDs are opaque commitments computed off-chain. userCommitment is an opaque off-chain hash
 * of the authenticated user id, not personal data. Claim storage and payment events contain only
 * claim IDs, user commitments, recipient wallets, amounts and expiries, never usernames, tokens,
 * passwords or profile data. Administrative storage/events contain only configuration and wallet addresses.
 * Never submit personal data in report calldata, which is public even though it is not stored.
 */
contract ArcClaimReceiver is IReceiver, ERC165, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant REPORT_SCHEMA_VERSION = 2;

    address public immutable forwarder;
    IERC20 public immutable usdc;
    bool public immutable allowAnyWorkflow;
    mapping(bytes32 claimId => bool processed) public claimed;
    mapping(bytes32 userCommitment => bool) public claimedUser;
    uint256 public totalPaid;
    uint256 public maxRewardBudget;
    uint256 public maxClaimAmount;
    bytes32 public expectedWorkflowId;
    address public expectedWorkflowOwner;

    error InvalidForwarder();
    error InvalidUSDC();
    error UnauthorizedForwarder(address sender);
    error WorkflowIdentityNotConfigured();
    error RenounceOwnershipDisabled();
    error InvalidMetadataLength(uint256 length);
    error InvalidWorkflowId();
    error InvalidWorkflowOwner();
    error InvalidReportLength(uint256 length);
    error UnsupportedSchemaVersion(uint8 version);
    error InvalidClaimId();
    error InvalidUserCommitment();
    error InvalidRecipient();
    error InvalidAmount();
    error AmountExceedsMaxClaim(uint256 amount, uint256 maxClaimAmount);
    error InvalidMaxClaimAmount();
    error ClaimExpired(uint256 expiry, uint256 currentTimestamp);
    error ClaimAlreadyProcessed(bytes32 claimId);
    error UserAlreadyClaimed(bytes32 userCommitment);
    error BudgetExceeded();
    error InsufficientFunds(uint256 balance, uint256 amount);
    error BudgetBelowPaid();

    event ClaimPaid(bytes32 indexed claimId, address indexed recipient, bytes32 userCommitment, uint256 amount, uint256 expiry);
    event Withdrawn(address indexed to, uint256 amount);
    event MaxRewardBudgetUpdated(uint256 oldBudget, uint256 newBudget);
    event MaxClaimAmountUpdated(uint256 oldMax, uint256 newMax);
    event ExpectedWorkflowIdUpdated(bytes32 oldWorkflowId, bytes32 newWorkflowId);
    event ExpectedWorkflowOwnerUpdated(address oldWorkflowOwner, address newWorkflowOwner);

    /// @notice Sets the trusted forwarder, six-decimal token, initial owner, lifetime budget and claim cap.
    /// @dev Zero owner reverts with OpenZeppelin's OwnableInvalidOwner custom error.
    /// @param maxClaimAmount_ Nonzero maximum payout per claim, in six-decimal USDC units.
    /// @param allowAnyWorkflow_ True ONLY for MockKeystoneForwarder broadcast simulations on testnet;
    /// production (KeystoneForwarder) deployments MUST pass false.
    constructor(address forwarder_, address usdc_, address initialOwner, uint256 maxRewardBudget_, uint256 maxClaimAmount_, bool allowAnyWorkflow_)
        Ownable(initialOwner)
    {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        if (usdc_ == address(0)) revert InvalidUSDC();
        if (maxClaimAmount_ == 0) revert InvalidMaxClaimAmount();
        forwarder = forwarder_;
        usdc = IERC20(usdc_);
        maxRewardBudget = maxRewardBudget_;
        maxClaimAmount = maxClaimAmount_;
        allowAnyWorkflow = allowAnyWorkflow_;
    }

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        _;
    }

    /// @notice Pays a report-bound recipient once per user commitment for a fresh, unexpired claim.
    /// @dev Requires an expected workflow ID and/or owner unless allowAnyWorkflow is true, ONLY for
    /// MockKeystoneForwarder broadcast-simulation deployments on testnet with no real workflow metadata.
    /// Production (KeystoneForwarder) deployments MUST pass false. Nonzero identity checks still apply.
    /// Packed metadata is bytes32 workflowId, bytes10 workflowName, address workflowOwner;
    /// trailing bytes (including the production reportId) are ignored. Reverts consume neither claim nor user flags.
    /// userCommitment is an opaque off-chain hash of the authenticated user id, not personal data.
    /// Payout = weight/100 USDC, computed off-chain and bounded here by maxClaimAmount.
    /// @param metadata Trusted forwarder metadata; at least 62 bytes when either identity check is enabled.
    /// @param report Exactly abi.encode(uint8 schemaVersion, bytes32 claimId, bytes32 userCommitment,
    /// address recipient, uint256 amount, uint256 expiry), totaling 192 bytes.
    function onReport(bytes calldata metadata, bytes calldata report)
        external
        override
        onlyForwarder
        whenNotPaused
        nonReentrant
    {
        bytes32 workflowId = expectedWorkflowId;
        address workflowOwner = expectedWorkflowOwner;
        if (!allowAnyWorkflow && workflowId == bytes32(0) && workflowOwner == address(0)) {
            revert WorkflowIdentityNotConfigured();
        }
        if (workflowId != bytes32(0) || workflowOwner != address(0)) {
            if (metadata.length < 62) revert InvalidMetadataLength(metadata.length);
            if (workflowId != bytes32(0) && bytes32(metadata[0:32]) != workflowId) {
                revert InvalidWorkflowId();
            }
            if (workflowOwner != address(0) && address(bytes20(metadata[42:62])) != workflowOwner) {
                revert InvalidWorkflowOwner();
            }
        }

        if (report.length != 192) revert InvalidReportLength(report.length);
        (uint8 schemaVersion, bytes32 claimId, bytes32 userCommitment, address recipient, uint256 amount, uint256 expiry) =
            abi.decode(report, (uint8, bytes32, bytes32, address, uint256, uint256));
        if (schemaVersion != REPORT_SCHEMA_VERSION) revert UnsupportedSchemaVersion(schemaVersion);
        if (claimId == bytes32(0)) revert InvalidClaimId();
        if (userCommitment == bytes32(0)) revert InvalidUserCommitment();
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (amount > maxClaimAmount) revert AmountExceedsMaxClaim(amount, maxClaimAmount);
        if (block.timestamp > expiry) revert ClaimExpired(expiry, block.timestamp);
        if (claimed[claimId]) revert ClaimAlreadyProcessed(claimId);
        if (claimedUser[userCommitment]) revert UserAlreadyClaimed(userCommitment);

        uint256 paid = totalPaid;
        // Invariant: budget >= paid. Subtraction avoids overflow and preserves BudgetExceeded.
        if (amount > maxRewardBudget - paid) revert BudgetExceeded();
        uint256 balance = usdc.balanceOf(address(this));
        if (balance < amount) revert InsufficientFunds(balance, amount);

        claimed[claimId] = true;
        claimedUser[userCommitment] = true;
        totalPaid = paid + amount;
        usdc.safeTransfer(recipient, amount);
        emit ClaimPaid(claimId, recipient, userCommitment, amount, expiry);
    }

    /// @notice Reports support for IReceiver and IERC165.
    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @notice Disables ownership renunciation; two-step ownership transfers remain available.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceOwnershipDisabled();
    }

    /// @notice Pauses report payments; emits Paused with the owner's address.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes report payments; emits Unpaused with the owner's address.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraws a nonzero USDC amount to a nonzero wallet, including while paused.
    /// @dev Withdrawals do not change lifetime totalPaid or restore reward budget.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        uint256 balance = usdc.balanceOf(address(this));
        if (balance < amount) revert InsufficientFunds(balance, amount);
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Sets the lifetime reward budget, which cannot be less than rewards already paid.
    function setMaxRewardBudget(uint256 newBudget) external onlyOwner {
        if (newBudget < totalPaid) revert BudgetBelowPaid();
        uint256 oldBudget = maxRewardBudget;
        maxRewardBudget = newBudget;
        emit MaxRewardBudgetUpdated(oldBudget, newBudget);
    }

    /// @notice Sets the nonzero maximum payout per claim in six-decimal USDC units.
    function setMaxClaimAmount(uint256 newMax) external onlyOwner {
        if (newMax == 0) revert InvalidMaxClaimAmount();
        uint256 oldMax = maxClaimAmount;
        maxClaimAmount = newMax;
        emit MaxClaimAmountUpdated(oldMax, newMax);
    }

    /// @notice Sets the required workflow ID; zero disables this identity check.
    /// @dev With allowAnyWorkflow false, at least one expected identity must be nonzero for payouts.
    /// allowAnyWorkflow true is ONLY for MockKeystoneForwarder broadcast simulations on testnet with
    /// no real workflow metadata; production (KeystoneForwarder) deployments MUST pass false.
    function setExpectedWorkflowId(bytes32 newWorkflowId) external onlyOwner {
        bytes32 oldWorkflowId = expectedWorkflowId;
        expectedWorkflowId = newWorkflowId;
        emit ExpectedWorkflowIdUpdated(oldWorkflowId, newWorkflowId);
    }

    /// @notice Sets the required workflow owner; zero disables this identity check.
    /// @dev With allowAnyWorkflow false, at least one expected identity must be nonzero for payouts.
    /// allowAnyWorkflow true is ONLY for MockKeystoneForwarder broadcast simulations on testnet with
    /// no real workflow metadata; production (KeystoneForwarder) deployments MUST pass false.
    function setExpectedWorkflowOwner(address newWorkflowOwner) external onlyOwner {
        address oldWorkflowOwner = expectedWorkflowOwner;
        expectedWorkflowOwner = newWorkflowOwner;
        emit ExpectedWorkflowOwnerUpdated(oldWorkflowOwner, newWorkflowOwner);
    }
}
