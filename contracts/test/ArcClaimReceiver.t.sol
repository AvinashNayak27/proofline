// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ArcClaimReceiver} from "../ArcClaimReceiver.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract ArcClaimReceiverTest is Test {
    ArcClaimReceiver internal r;
    MockERC20 internal usdc;

    address internal forwarder = makeAddr("forwarder");
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant REWARD = 1_000_000;
    uint256 internal constant MAX_CLAIM = 5_000_000;
    uint256 internal constant BUDGET = 10_000_000;
    uint256 internal constant FUND = 100_000_000;
    bytes32 internal constant CLAIM = keccak256("claim-1");
    bytes32 internal constant WF_ID = keccak256("workflow-id");
    address internal wfOwner = address(0xBEEF);

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        r = _deploy(true, FUND);
    }

    // ---------------------------------------------------------------- helpers
    function _deploy(bool anyWf, uint256 fund) internal returns (ArcClaimReceiver c) {
        c = new ArcClaimReceiver(forwarder, address(usdc), owner, BUDGET, MAX_CLAIM, anyWf);
        if (fund > 0) usdc.mint(address(c), fund);
    }

    function _commit(bytes32 id) internal pure returns (bytes32) {
        return keccak256(abi.encode("user", id));
    }

    /// Default report: userCommitment is derived from the claimId, so distinct claimIds are distinct users.
    function _report(bytes32 id, address to, uint256 amount, uint256 expiry) internal pure returns (bytes memory) {
        return abi.encode(uint8(2), id, _commit(id), to, amount, expiry);
    }

    function _reportU(bytes32 id, bytes32 commitment, address to, uint256 amount, uint256 expiry)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(uint8(2), id, commitment, to, amount, expiry);
    }

    function _meta(bytes32 id, address wOwner) internal pure returns (bytes memory) {
        return abi.encodePacked(id, bytes10("wfname"), wOwner, bytes2(0x0001));
    }

    function _send(ArcClaimReceiver c, bytes memory meta, bytes memory report) internal {
        vm.prank(forwarder);
        c.onReport(meta, report);
    }

    function _pay(bytes32 id, address to) internal {
        _send(r, "", _report(id, to, REWARD, block.timestamp + 1 days));
    }

    // ------------------------------------------------- (1) authorization
    function test_Constructor_StoresConfig() public view {
        assertEq(r.forwarder(), forwarder);
        assertEq(address(r.usdc()), address(usdc));
        assertEq(r.owner(), owner);
        assertEq(r.maxRewardBudget(), BUDGET);
        assertTrue(r.allowAnyWorkflow());
        assertEq(r.totalPaid(), 0);
        assertEq(r.maxClaimAmount(), MAX_CLAIM);
        assertEq(r.REPORT_SCHEMA_VERSION(), 2);
    }

    function test_Constructor_RevertsOnZeroForwarder() public {
        vm.expectRevert(ArcClaimReceiver.InvalidForwarder.selector);
        new ArcClaimReceiver(address(0), address(usdc), owner, BUDGET, MAX_CLAIM, true);
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(ArcClaimReceiver.InvalidUSDC.selector);
        new ArcClaimReceiver(forwarder, address(0), owner, BUDGET, MAX_CLAIM, true);
    }

    function test_Constructor_RevertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ArcClaimReceiver(forwarder, address(usdc), address(0), BUDGET, MAX_CLAIM, true);
    }

    function test_OnReport_RevertsForNonForwarder() public {
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.UnauthorizedForwarder.selector, stranger));
        r.onReport("", rep);
    }

    function test_OnReport_RevertsForOwner() public {
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.UnauthorizedForwarder.selector, owner));
        r.onReport("", rep);
    }

    function test_OnReport_RevertsForTestContractCaller() public {
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.UnauthorizedForwarder.selector, address(this)));
        r.onReport("", rep);
    }

    // ------------------------------------------------- (4) exact amount / happy path
    function test_OnReport_PaysExactRewardAndUpdatesState() public {
        uint256 contractBefore = usdc.balanceOf(address(r));
        _pay(CLAIM, alice);
        assertEq(usdc.balanceOf(alice), REWARD);
        assertEq(usdc.balanceOf(address(r)), contractBefore - REWARD);
        assertEq(r.totalPaid(), REWARD);
        assertTrue(r.claimed(CLAIM));
    }

    function test_OnReport_EmitsClaimPaid() public {
        uint256 expiry = block.timestamp + 5;
        vm.expectEmit(true, true, false, true, address(r));
        emit ArcClaimReceiver.ClaimPaid(CLAIM, alice, _commit(CLAIM), REWARD, expiry);
        _send(r, "", _report(CLAIM, alice, REWARD, expiry));
    }

    function test_OnReport_EmitsOnlyClaimPaidFromReceiver() public {
        uint256 expiry = block.timestamp + 5;
        vm.recordLogs();
        _send(r, "", _report(CLAIM, alice, REWARD, expiry));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(r)) continue;
            n++;
            assertEq(logs[i].topics[0], ArcClaimReceiver.ClaimPaid.selector);
            assertEq(logs[i].topics.length, 3);
            assertEq(logs[i].topics[1], CLAIM);
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(alice))));
            assertEq(logs[i].data, abi.encode(_commit(CLAIM), REWARD, expiry));
        }
        assertEq(n, 1);
    }

    function test_OnReport_RevertsOnWrongAmounts() public {
        bytes memory rep = _report(CLAIM, alice, 0, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidAmount.selector);
        r.onReport("", rep);

        uint256[3] memory amts = [MAX_CLAIM + 1, MAX_CLAIM * 2, type(uint256).max];
        for (uint256 i; i < amts.length; i++) {
            rep = _report(CLAIM, alice, amts[i], block.timestamp);
            vm.prank(forwarder);
            vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.AmountExceedsMaxClaim.selector, amts[i], MAX_CLAIM));
            r.onReport("", rep);
        }
        assertFalse(r.claimed(CLAIM));
        assertFalse(r.claimedUser(_commit(CLAIM)));
    }

    function test_OnReport_AmountExactlyMaxSucceeds() public {
        _send(r, "", _report(CLAIM, alice, MAX_CLAIM, block.timestamp));
        assertEq(usdc.balanceOf(alice), MAX_CLAIM);
        assertEq(r.totalPaid(), MAX_CLAIM);
    }

    function test_OnReport_AmountOneSucceeds() public {
        _send(r, "", _report(CLAIM, alice, 1, block.timestamp));
        assertEq(usdc.balanceOf(alice), 1);
    }

    function testFuzz_OnReport_RevertsOnAmountAboveMax(uint256 amount) public {
        amount = bound(amount, MAX_CLAIM + 1, type(uint256).max);
        bytes memory rep = _report(CLAIM, alice, amount, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.AmountExceedsMaxClaim.selector, amount, MAX_CLAIM));
        r.onReport("", rep);
    }

    function testFuzz_OnReport_PaysExactAmount(address recipient, bytes32 id, bytes32 commitment, uint256 amount) public {
        vm.assume(recipient != address(0) && recipient != address(r) && id != bytes32(0) && commitment != bytes32(0));
        amount = bound(amount, 1, MAX_CLAIM);
        uint256 recBefore = usdc.balanceOf(recipient);
        uint256 rBefore = usdc.balanceOf(address(r));
        _send(r, "", _reportU(id, commitment, recipient, amount, block.timestamp + 1 days));
        assertEq(usdc.balanceOf(recipient), recBefore + amount);
        assertEq(usdc.balanceOf(address(r)), rBefore - amount);
        assertEq(r.totalPaid(), amount);
        assertTrue(r.claimed(id));
        assertTrue(r.claimedUser(commitment));
    }

    function testFuzz_OnReport_ExpiryBoundary(uint256 expiry, uint256 ts) public {
        ts = bound(ts, 1, type(uint64).max);
        vm.warp(ts);
        expiry = bound(expiry, 0, type(uint64).max);
        bytes memory rep = _report(CLAIM, alice, REWARD, expiry);
        vm.prank(forwarder);
        if (ts > expiry) vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.ClaimExpired.selector, expiry, ts));
        r.onReport("", rep);
        assertEq(r.claimed(CLAIM), ts <= expiry);
    }

    function test_OnReport_WorksAtCanonicalUsdcAddress() public {
        address canonical = 0x3600000000000000000000000000000000000000;
        MockERC20 impl = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(canonical, address(impl).code);
        MockERC20 u = MockERC20(canonical);
        assertEq(u.decimals(), 6);
        ArcClaimReceiver c = new ArcClaimReceiver(forwarder, canonical, owner, BUDGET, MAX_CLAIM, true);
        u.mint(address(c), 3 * REWARD);
        _send(c, "", _report(CLAIM, alice, REWARD, block.timestamp));
        assertEq(u.balanceOf(alice), REWARD);
        assertEq(u.balanceOf(address(c)), 2 * REWARD);
    }

    // ------------------------------------------------- (2) replay prevention
    function test_Replay_SameClaimIdTwiceReverts() public {
        _pay(CLAIM, alice);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp + 1 days);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.ClaimAlreadyProcessed.selector, CLAIM));
        r.onReport("", rep);
        assertEq(usdc.balanceOf(alice), REWARD);
        assertEq(r.totalPaid(), REWARD);
    }

    function test_Replay_SameClaimIdDifferentRecipientReverts() public {
        _pay(CLAIM, alice);
        bytes memory rep = _report(CLAIM, bob, REWARD, block.timestamp + 1 days);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.ClaimAlreadyProcessed.selector, CLAIM));
        r.onReport("", rep);
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_Replay_RevertedReportDoesNotConsumeClaim_Paused() public {
        vm.prank(owner);
        r.pause();
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp + 1 days);
        vm.prank(forwarder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        r.onReport("", rep);
        assertFalse(r.claimed(CLAIM));
        vm.prank(owner);
        r.unpause();
        _pay(CLAIM, alice);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Replay_RevertedReportDoesNotConsumeClaim_InsufficientFunds() public {
        ArcClaimReceiver c = _deploy(true, 0);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp + 1 days);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InsufficientFunds.selector, 0, REWARD));
        c.onReport("", rep);
        assertFalse(c.claimed(CLAIM));
        assertEq(c.totalPaid(), 0);
        usdc.mint(address(c), REWARD);
        _send(c, "", rep);
        assertEq(usdc.balanceOf(alice), REWARD);
        assertTrue(c.claimed(CLAIM));
    }

    // ------------------------------------------------- (2b) one payout per user
    function test_User_SecondClaimSameCommitmentNewClaimIdReverts() public {
        bytes32 u = keccak256("user-A");
        uint256 exp = block.timestamp + 1 days;
        _send(r, "", _reportU(bytes32(uint256(1)), u, alice, REWARD, exp));
        assertTrue(r.claimedUser(u));

        bytes memory rep = _reportU(bytes32(uint256(2)), u, bob, REWARD, exp);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.UserAlreadyClaimed.selector, u));
        r.onReport("", rep);
        assertFalse(r.claimed(bytes32(uint256(2))));
        assertEq(usdc.balanceOf(bob), 0);
        assertEq(r.totalPaid(), REWARD);
    }

    function test_User_SameCommitmentSameRecipientNewClaimIdReverts() public {
        bytes32 u = keccak256("user-A");
        uint256 exp = block.timestamp + 1 days;
        _send(r, "", _reportU(bytes32(uint256(1)), u, alice, REWARD, exp));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.UserAlreadyClaimed.selector, u));
        r.onReport("", _reportU(bytes32(uint256(2)), u, alice, REWARD, exp));
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_User_DifferentCommitmentNewClaimIdSucceeds() public {
        uint256 exp = block.timestamp + 1 days;
        _send(r, "", _reportU(bytes32(uint256(1)), keccak256("A"), alice, REWARD, exp));
        _send(r, "", _reportU(bytes32(uint256(2)), keccak256("B"), alice, 2 * REWARD, exp));
        assertEq(usdc.balanceOf(alice), 3 * REWARD);
        assertEq(r.totalPaid(), 3 * REWARD);
        assertTrue(r.claimedUser(keccak256("A")));
        assertTrue(r.claimedUser(keccak256("B")));
    }

    function test_User_ClaimIdReplayWithNewCommitmentStillReverts() public {
        uint256 exp = block.timestamp + 1 days;
        _send(r, "", _reportU(CLAIM, keccak256("A"), alice, REWARD, exp));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.ClaimAlreadyProcessed.selector, CLAIM));
        r.onReport("", _reportU(CLAIM, keccak256("B"), bob, REWARD, exp));
        assertFalse(r.claimedUser(keccak256("B")));
    }

    function test_User_RevertedReportsConsumeNeitherFlag() public {
        bytes32 u = keccak256("A");
        uint256 exp = block.timestamp + 1 days;
        bytes memory ok = _reportU(CLAIM, u, alice, REWARD, exp);

        // paused
        vm.prank(owner);
        r.pause();
        vm.prank(forwarder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        r.onReport("", ok);
        assertFalse(r.claimed(CLAIM));
        assertFalse(r.claimedUser(u));
        vm.prank(owner);
        r.unpause();

        // over cap
        bytes memory over = _reportU(CLAIM, u, alice, MAX_CLAIM + 1, exp);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.AmountExceedsMaxClaim.selector, MAX_CLAIM + 1, MAX_CLAIM));
        r.onReport("", over);
        assertFalse(r.claimed(CLAIM));
        assertFalse(r.claimedUser(u));

        // budget
        vm.prank(owner);
        r.setMaxRewardBudget(0);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.BudgetExceeded.selector);
        r.onReport("", ok);
        assertFalse(r.claimed(CLAIM));
        assertFalse(r.claimedUser(u));
        vm.prank(owner);
        r.setMaxRewardBudget(BUDGET);

        // insufficient funds
        ArcClaimReceiver c = _deploy(true, 0);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InsufficientFunds.selector, 0, REWARD));
        c.onReport("", ok);
        assertFalse(c.claimed(CLAIM));
        assertFalse(c.claimedUser(u));

        // the same user and claim can still be paid afterwards
        _send(r, "", ok);
        assertEq(usdc.balanceOf(alice), REWARD);
        assertTrue(r.claimed(CLAIM));
        assertTrue(r.claimedUser(u));
    }

    function test_User_ExpiredReportDoesNotConsumeUser() public {
        bytes32 u = keccak256("A");
        uint256 exp = block.timestamp;
        vm.warp(exp + 1);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.ClaimExpired.selector, exp, exp + 1));
        r.onReport("", _reportU(CLAIM, u, alice, REWARD, exp));
        assertFalse(r.claimedUser(u));
        _send(r, "", _reportU(CLAIM, u, alice, REWARD, exp + 1));
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    // ------------------------------------------------- (2c) max claim amount
    function test_MaxClaim_ConstructorZeroReverts() public {
        vm.expectRevert(ArcClaimReceiver.InvalidMaxClaimAmount.selector);
        new ArcClaimReceiver(forwarder, address(usdc), owner, BUDGET, 0, true);
    }

    function test_MaxClaim_SetEmitsAndStores() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(r));
        emit ArcClaimReceiver.MaxClaimAmountUpdated(MAX_CLAIM, 42);
        r.setMaxClaimAmount(42);
        assertEq(r.maxClaimAmount(), 42);
    }

    function test_MaxClaim_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.setMaxClaimAmount(1);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, forwarder));
        r.setMaxClaimAmount(1);
        assertEq(r.maxClaimAmount(), MAX_CLAIM);
    }

    function test_MaxClaim_ZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(ArcClaimReceiver.InvalidMaxClaimAmount.selector);
        r.setMaxClaimAmount(0);
        assertEq(r.maxClaimAmount(), MAX_CLAIM);
    }

    function test_MaxClaim_LoweringAppliesToNextClaim() public {
        vm.prank(owner);
        r.setMaxClaimAmount(REWARD - 1);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.AmountExceedsMaxClaim.selector, REWARD, REWARD - 1));
        r.onReport("", rep);
        vm.prank(owner);
        r.setMaxClaimAmount(REWARD);
        _send(r, "", rep);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    // ------------------------------------------------- (3) expiry
    function test_Expiry_EqualToTimestampSucceeds() public {
        _send(r, "", _report(CLAIM, alice, REWARD, block.timestamp));
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Expiry_OneSecondPastReverts() public {
        uint256 expiry = block.timestamp;
        bytes memory rep = _report(CLAIM, alice, REWARD, expiry);
        vm.warp(expiry + 1);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.ClaimExpired.selector, expiry, expiry + 1));
        r.onReport("", rep);
        assertFalse(r.claimed(CLAIM));
    }

    // ------------------------------------------------- (5) pause
    function test_Pause_BlocksOnReportAndResumesAfterUnpause() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(r));
        emit Pausable.Paused(owner);
        r.pause();
        assertTrue(r.paused());

        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        r.onReport("", rep);

        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(r));
        emit Pausable.Unpaused(owner);
        r.unpause();
        assertFalse(r.paused());
        _send(r, "", rep);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.pause();
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, forwarder));
        r.pause();
    }

    function test_Unpause_OnlyOwner() public {
        vm.prank(owner);
        r.pause();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.unpause();
        assertTrue(r.paused());
    }

    function test_Pause_WithdrawStillWorksWhilePaused() public {
        vm.startPrank(owner);
        r.pause();
        r.withdraw(alice, 5 * REWARD);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 5 * REWARD);
    }

    function test_Pause_DoubleStateReverts() public {
        vm.startPrank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        r.unpause();
        r.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        r.pause();
        vm.stopPrank();
    }

    // ------------------------------------------------- (6) withdrawal
    function test_Withdraw_OwnerWithdrawsAndEmits() public {
        uint256 before = usdc.balanceOf(address(r));
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(r));
        emit ArcClaimReceiver.Withdrawn(alice, 7e6);
        r.withdraw(alice, 7e6);
        assertEq(usdc.balanceOf(alice), 7e6);
        assertEq(usdc.balanceOf(address(r)), before - 7e6);
    }

    function test_Withdraw_DoesNotChangeTotalPaid() public {
        _pay(CLAIM, alice);
        vm.prank(owner);
        r.withdraw(bob, 1e6);
        assertEq(r.totalPaid(), REWARD);
    }

    function test_Withdraw_FullBalance() public {
        vm.prank(owner);
        r.withdraw(alice, FUND);
        assertEq(usdc.balanceOf(address(r)), 0);
    }

    function test_Withdraw_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.withdraw(stranger, 1);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, forwarder));
        r.withdraw(forwarder, 1);
    }

    function test_Withdraw_RevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ArcClaimReceiver.InvalidRecipient.selector);
        r.withdraw(address(0), 1);
    }

    function test_Withdraw_RevertsOnZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(ArcClaimReceiver.InvalidAmount.selector);
        r.withdraw(alice, 0);
    }

    function test_Withdraw_RevertsWhenInsufficient() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InsufficientFunds.selector, FUND, FUND + 1));
        r.withdraw(alice, FUND + 1);
    }

    // ------------------------------------------------- (7) insufficient funds
    function test_OnReport_RevertsWhenBalanceBelowReward() public {
        ArcClaimReceiver c = _deploy(true, REWARD - 1);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InsufficientFunds.selector, REWARD - 1, REWARD));
        c.onReport("", rep);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_OnReport_SucceedsWithExactlyOneRewardBalance() public {
        ArcClaimReceiver c = _deploy(true, REWARD);
        _send(c, "", _report(CLAIM, alice, REWARD, block.timestamp));
        assertEq(usdc.balanceOf(address(c)), 0);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    // ------------------------------------------------- (8) budget
    function test_Budget_ExceededWhenNextClaimWouldCrossIt() public {
        vm.prank(owner);
        r.setMaxRewardBudget(2 * REWARD);
        _pay(bytes32(uint256(1)), alice);
        _pay(bytes32(uint256(2)), alice);
        bytes memory rep = _report(bytes32(uint256(3)), alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.BudgetExceeded.selector);
        r.onReport("", rep);
        assertEq(r.totalPaid(), 2 * REWARD);
        assertFalse(r.claimed(bytes32(uint256(3))));
    }

    function test_Budget_ZeroBudgetBlocksClaims() public {
        vm.prank(owner);
        r.setMaxRewardBudget(0);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.BudgetExceeded.selector);
        r.onReport("", rep);
    }

    function test_Budget_RaisingBudgetResumesClaims() public {
        vm.prank(owner);
        r.setMaxRewardBudget(REWARD);
        _pay(bytes32(uint256(1)), alice);
        bytes memory rep = _report(bytes32(uint256(2)), bob, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.BudgetExceeded.selector);
        r.onReport("", rep);
        vm.prank(owner);
        r.setMaxRewardBudget(2 * REWARD);
        _send(r, "", rep);
        assertEq(usdc.balanceOf(bob), REWARD);
        assertEq(r.totalPaid(), 2 * REWARD);
    }

    function test_Budget_SetEmitsAndStores() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(r));
        emit ArcClaimReceiver.MaxRewardBudgetUpdated(BUDGET, 42);
        r.setMaxRewardBudget(42);
        assertEq(r.maxRewardBudget(), 42);
    }

    function test_Budget_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.setMaxRewardBudget(1);
    }

    function test_Budget_CannotGoBelowPaid() public {
        _pay(CLAIM, alice);
        vm.startPrank(owner);
        vm.expectRevert(ArcClaimReceiver.BudgetBelowPaid.selector);
        r.setMaxRewardBudget(REWARD - 1);
        r.setMaxRewardBudget(REWARD); // equal to paid is allowed
        vm.stopPrank();
        assertEq(r.maxRewardBudget(), REWARD);
    }

    // ------------------------------------------------- (9) report validation
    function test_Report_WrongLengthReverts() public {
        bytes memory good = _report(CLAIM, alice, REWARD, block.timestamp);
        bytes[3] memory bad = [bytes(""), abi.encodePacked(good, bytes1(0)), _slice(good, 191)];
        uint256[3] memory lens = [uint256(0), 193, 191];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(forwarder);
            vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InvalidReportLength.selector, lens[i]));
            r.onReport("", bad[i]);
        }
        assertEq(good.length, 192);
    }

    function _slice(bytes memory b, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = b[i];
    }

    function test_Report_UnsupportedSchemaVersionReverts() public {
        uint8[4] memory vs = [uint8(0), uint8(1), uint8(3), uint8(255)];
        for (uint256 i; i < vs.length; i++) {
            bytes memory rep = abi.encode(vs[i], CLAIM, _commit(CLAIM), alice, REWARD, block.timestamp);
            vm.prank(forwarder);
            vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.UnsupportedSchemaVersion.selector, vs[i]));
            r.onReport("", rep);
        }
    }

    function test_Report_V1ShapedReportRevertsInvalidLength() public {
        bytes memory v1 = abi.encode(uint8(1), CLAIM, alice, REWARD, block.timestamp);
        assertEq(v1.length, 160);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InvalidReportLength.selector, 160));
        r.onReport("", v1);
        assertFalse(r.claimed(CLAIM));
    }

    function test_Report_ZeroUserCommitmentReverts() public {
        bytes memory rep = _reportU(CLAIM, bytes32(0), alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidUserCommitment.selector);
        r.onReport("", rep);
        assertFalse(r.claimed(CLAIM));
    }

    function test_Report_ZeroClaimIdReverts() public {
        bytes memory rep = _report(bytes32(0), alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidClaimId.selector);
        r.onReport("", rep);
    }

    function test_Report_ZeroRecipientReverts() public {
        bytes memory rep = _report(CLAIM, address(0), REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidRecipient.selector);
        r.onReport("", rep);
    }

    // ------------------------------------------------- (10) workflow identity
    function test_Identity_StrictUnconfiguredReverts() public {
        ArcClaimReceiver c = _deploy(false, FUND);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.WorkflowIdentityNotConfigured.selector);
        c.onReport(_meta(WF_ID, wfOwner), rep);
        assertFalse(c.allowAnyWorkflow());
    }

    function test_Identity_AllowAnyWorkflowSkipsUnconfiguredRevert() public {
        _pay(CLAIM, alice); // setUp receiver: allowAny=true, nothing configured, empty metadata
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Identity_WorkflowIdOnly() public {
        ArcClaimReceiver c = _deploy(false, FUND);
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(c));
        emit ArcClaimReceiver.ExpectedWorkflowIdUpdated(bytes32(0), WF_ID);
        c.setExpectedWorkflowId(WF_ID);
        assertEq(c.expectedWorkflowId(), WF_ID);

        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidWorkflowId.selector);
        c.onReport(_meta(keccak256("other"), wfOwner), rep);

        _send(c, _meta(WF_ID, address(0x1234)), rep); // owner not enforced
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Identity_WorkflowOwnerOnly() public {
        ArcClaimReceiver c = _deploy(false, FUND);
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(c));
        emit ArcClaimReceiver.ExpectedWorkflowOwnerUpdated(address(0), wfOwner);
        c.setExpectedWorkflowOwner(wfOwner);
        assertEq(c.expectedWorkflowOwner(), wfOwner);

        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidWorkflowOwner.selector);
        c.onReport(_meta(WF_ID, address(0x1234)), rep);

        _send(c, _meta(keccak256("anything"), wfOwner), rep); // id not enforced
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Identity_BothConfigured() public {
        ArcClaimReceiver c = _deploy(false, FUND);
        vm.startPrank(owner);
        c.setExpectedWorkflowId(WF_ID);
        c.setExpectedWorkflowOwner(wfOwner);
        vm.stopPrank();
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);

        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidWorkflowId.selector);
        c.onReport(_meta(keccak256("x"), wfOwner), rep);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidWorkflowOwner.selector);
        c.onReport(_meta(WF_ID, address(0x1234)), rep);

        _send(c, _meta(WF_ID, wfOwner), rep);
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Identity_ConfiguredStillEnforcedWhenAllowAnyTrue() public {
        vm.prank(owner);
        r.setExpectedWorkflowId(WF_ID);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InvalidMetadataLength.selector, 0));
        r.onReport("", rep);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.InvalidWorkflowId.selector);
        r.onReport(_meta(keccak256("x"), wfOwner), rep);
    }

    function test_Identity_ShortMetadataReverts() public {
        vm.prank(owner);
        r.setExpectedWorkflowOwner(wfOwner);
        bytes memory full = _meta(WF_ID, wfOwner);
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        assertEq(full.length, 64);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ArcClaimReceiver.InvalidMetadataLength.selector, 61));
        r.onReport(_slice(full, 61), rep);
        _send(r, _slice(full, 62), rep); // exactly 62 bytes is enough
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Identity_ReportIdTrailingBytesIgnored() public {
        vm.startPrank(owner);
        r.setExpectedWorkflowId(WF_ID);
        r.setExpectedWorkflowOwner(wfOwner);
        vm.stopPrank();
        bytes memory m2 = abi.encodePacked(WF_ID, bytes10("wfname"), wfOwner, bytes2(0xFFFF));
        _send(r, m2, _report(CLAIM, alice, REWARD, block.timestamp));
        assertEq(usdc.balanceOf(alice), REWARD);
    }

    function test_Identity_SettersOnlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.setExpectedWorkflowId(WF_ID);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.setExpectedWorkflowOwner(wfOwner);
        vm.stopPrank();
    }

    function test_Identity_ClearingBackToZeroRestoresUnconfiguredRevert() public {
        ArcClaimReceiver c = _deploy(false, FUND);
        vm.startPrank(owner);
        c.setExpectedWorkflowId(WF_ID);
        c.setExpectedWorkflowId(bytes32(0));
        vm.stopPrank();
        bytes memory rep = _report(CLAIM, alice, REWARD, block.timestamp);
        vm.prank(forwarder);
        vm.expectRevert(ArcClaimReceiver.WorkflowIdentityNotConfigured.selector);
        c.onReport(_meta(WF_ID, wfOwner), rep);
    }

    // ------------------------------------------------- (11) ownership
    function test_Renounce_AlwaysRevertsForOwner() public {
        vm.prank(owner);
        vm.expectRevert(ArcClaimReceiver.RenounceOwnershipDisabled.selector);
        r.renounceOwnership();
        assertEq(r.owner(), owner);
    }

    function test_Renounce_NonOwnerRejected() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.renounceOwnership();
    }

    function test_Ownership_TwoStepTransfer() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(r));
        emit Ownable2Step.OwnershipTransferStarted(owner, alice);
        r.transferOwnership(alice);
        assertEq(r.owner(), owner);
        assertEq(r.pendingOwner(), alice);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        r.acceptOwnership();

        vm.prank(alice);
        r.acceptOwnership();
        assertEq(r.owner(), alice);
        assertEq(r.pendingOwner(), address(0));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        r.pause();
        vm.prank(alice);
        r.pause();
        assertTrue(r.paused());
    }

    // ------------------------------------------------- (12) no native / ERC165
    function test_NativeSendReverts() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(r).call{value: 1}("");
        assertFalse(ok);
        (ok,) = address(r).call{value: 1}(hex"deadbeef");
        assertFalse(ok);
        assertEq(address(r).balance, 0);
    }

    function test_SupportsInterface() public view {
        assertTrue(r.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(r.supportsInterface(type(IERC165).interfaceId));
        assertFalse(r.supportsInterface(0xffffffff));
        assertFalse(r.supportsInterface(0xdeadbeef));
    }
}
