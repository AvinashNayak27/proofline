// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcClaimReceiver} from "../ArcClaimReceiver.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Acts as both forwarder and owner so the fuzzer drives realistic, bounded actions.
contract ClaimHandler is Test {
    ArcClaimReceiver public receiver;
    MockERC20 public usdc;

    uint256 public constant MAX_CLAIM = 3e6;

    uint256 public ghostFunded;
    uint256 public ghostWithdrawn;
    uint256 public ghostPaid; // sum of amounts of successful claims
    uint256 public ghostClaims;
    uint256 public ghostDuplicateUserPaid; // must remain 0
    uint256 internal nonce;
    mapping(bytes32 => bool) public ghostUserPaid;
    bytes32[] internal users;

    constructor(MockERC20 u) {
        usdc = u;
        receiver = new ArcClaimReceiver(address(this), address(u), address(this), 10e6, MAX_CLAIM, true);
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 0, 20e6);
        usdc.mint(address(receiver), amount);
        ghostFunded += amount;
    }

    /// userSeed picks among a small user pool so per-user dedupe is exercised often;
    /// reuseId replays an earlier claimId; amount may exceed the cap or be zero to hit reverts.
    function claim(uint256 seed, uint256 userSeed, address to, uint256 amount, bool reuseId) external {
        if (to == address(0) || to == address(receiver)) to = address(uint160(0xA11CE));
        amount = bound(amount, 0, MAX_CLAIM + 1e6);
        bytes32 id = reuseId && nonce > 0 ? keccak256(abi.encode(seed % nonce)) : keccak256(abi.encode(nonce++));
        bytes32 commitment = keccak256(abi.encode("user", userSeed % 6));
        bytes memory rep = abi.encode(uint8(2), id, commitment, to, amount, block.timestamp);
        bool alreadyPaid = ghostUserPaid[commitment];
        try receiver.onReport("", rep) {
            ghostClaims++;
            ghostPaid += amount;
            if (alreadyPaid) ghostDuplicateUserPaid++;
            ghostUserPaid[commitment] = true;
        } catch {}
    }

    function withdraw(uint256 amount) external {
        uint256 bal = usdc.balanceOf(address(receiver));
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        receiver.withdraw(address(0xB0B), amount);
        ghostWithdrawn += amount;
    }

    function setBudget(uint256 newBudget) external {
        newBudget = bound(newBudget, receiver.totalPaid(), 30e6);
        receiver.setMaxRewardBudget(newBudget);
    }

    function togglePause(bool p) external {
        if (p && !receiver.paused()) receiver.pause();
        else if (!p && receiver.paused()) receiver.unpause();
    }
}

contract ArcClaimReceiverInvariantTest is Test {
    ArcClaimReceiver internal r;
    MockERC20 internal usdc;
    ClaimHandler internal h;

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        h = new ClaimHandler(usdc);
        r = h.receiver();
        targetContract(address(h));
    }

    /// Conservation: tokens in = tokens out (claims + withdrawals) + balance held.
    function invariant_BalanceConservation() public view {
        assertEq(usdc.balanceOf(address(r)), h.ghostFunded() - h.ghostWithdrawn() - h.ghostPaid());
    }

    /// totalPaid equals the sum of successfully paid amounts and never exceeds the budget.
    function invariant_TotalPaidMatchesPaidAmountsAndRespectsBudget() public view {
        assertEq(r.totalPaid(), h.ghostPaid());
        assertLe(r.totalPaid(), r.maxRewardBudget());
    }

    /// No user commitment is ever paid twice.
    function invariant_OnePayoutPerUser() public view {
        assertEq(h.ghostDuplicateUserPaid(), 0);
    }

    /// Every successful claim paid at most the cap, so the sum is bounded by claims * cap.
    function invariant_PaidBoundedByClaimsTimesCap() public view {
        assertLe(h.ghostPaid(), h.ghostClaims() * h.MAX_CLAIM());
        assertLe(h.ghostClaims(), 6);
    }
}
