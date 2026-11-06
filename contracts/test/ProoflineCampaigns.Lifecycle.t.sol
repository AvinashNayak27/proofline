// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

contract ProoflineCampaignsLifecycleTest is ProoflineCampaignsTestBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _createDefault(10_000_000);
    }

    // ───────────── fund ─────────────
    function test_Fund_ByThirdPartySponsor() public {
        uint256 sBefore = usdc.balanceOf(sponsor);
        vm.expectEmit(true, true, false, true, address(pc));
        emit PC.CampaignFunded(id, sponsor, 4_000_000);
        vm.prank(sponsor);
        pc.fund(id, 4_000_000);
        assertEq(pc.getCampaign(id).deposited, 14_000_000);
        assertEq(pc.remaining(id), 14_000_000);
        assertEq(pc.totalEscrowed(), 14_000_000);
        assertEq(usdc.balanceOf(address(pc)), 14_000_000);
        assertEq(sBefore - usdc.balanceOf(sponsor), 4_000_000);
        // sponsor has no control rights
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, id, sponsor));
        pc.close(id);
    }

    function test_Fund_SponsorFundsRefundedToBrandOnClose() public {
        vm.prank(sponsor);
        pc.fund(id, 4_000_000);
        uint256 bBefore = usdc.balanceOf(brand);
        uint256 sBefore = usdc.balanceOf(sponsor);
        vm.prank(brand);
        pc.close(id);
        assertEq(usdc.balanceOf(brand) - bBefore, 14_000_000);
        assertEq(usdc.balanceOf(sponsor), sBefore);
    }

    function test_Fund_AllowedWhilePausedAndAfterEnd() public {
        vm.prank(owner);
        pc.pause();
        vm.prank(brand);
        pc.setPaused(id, true);
        vm.warp(T0 + 31 days);
        vm.prank(sponsor);
        pc.fund(id, 1);
        assertEq(pc.remaining(id), 10_000_001);
    }

    function test_Fund_RevertsUnknownCampaign() public {
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotFound.selector, 99));
        pc.fund(99, 1);
    }

    function test_Fund_RevertsClosedCampaign() public {
        vm.prank(brand);
        pc.close(id);
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignIsClosed.selector, id));
        pc.fund(id, 1);
    }

    function test_Fund_RevertsZeroAmount() public {
        vm.prank(sponsor);
        vm.expectRevert(PC.InvalidAmount.selector);
        pc.fund(id, 0);
    }

    function test_Fund_RevertsDepositedOverflowUint128() public {
        usdc.mint(sponsor, type(uint128).max);
        vm.prank(sponsor);
        vm.expectRevert(PC.DepositTooLarge.selector);
        pc.fund(id, type(uint128).max);
        // exact fit works
        vm.prank(sponsor);
        pc.fund(id, uint256(type(uint128).max) - 10_000_000);
        assertEq(pc.getCampaign(id).deposited, type(uint128).max);
        vm.prank(sponsor);
        vm.expectRevert(PC.DepositTooLarge.selector);
        pc.fund(id, 1);
    }

    function test_Fund_RevertsWithoutAllowance() public {
        vm.prank(stranger);
        vm.expectRevert();
        pc.fund(id, 1);
        assertEq(pc.totalEscrowed(), 10_000_000);
    }

    // ───────────── setPaused ─────────────
    function test_SetPaused_BrandPausesAndResumes() public {
        vm.expectEmit(true, false, false, true, address(pc));
        emit PC.CampaignStatusChanged(id, PC.Status.Paused);
        vm.prank(brand);
        pc.setPaused(id, true);
        assertEq(uint8(pc.getCampaign(id).status), uint8(PC.Status.Paused));

        vm.expectEmit(true, false, false, true, address(pc));
        emit PC.CampaignStatusChanged(id, PC.Status.Active);
        vm.prank(brand);
        pc.setPaused(id, false);
        assertEq(uint8(pc.getCampaign(id).status), uint8(PC.Status.Active));
    }

    function test_SetPaused_RevertsForNonBrand() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, id, stranger));
        pc.setPaused(id, true);
    }

    function test_SetPaused_OwnerNonBrandCannot() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, id, owner));
        pc.setPaused(id, true);
        assertEq(uint8(pc.getCampaign(id).status), uint8(PC.Status.Active));
    }

    function test_SetPaused_RevertsUnknown() public {
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotFound.selector, 42));
        pc.setPaused(42, true);
    }

    function test_SetPaused_RevertsWhenClosed() public {
        vm.startPrank(brand);
        pc.close(id);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignIsClosed.selector, id));
        pc.setPaused(id, false);
        vm.stopPrank();
    }

    function test_SetPaused_WorksWhileGloballyPaused() public {
        vm.prank(owner);
        pc.pause();
        vm.prank(brand);
        pc.setPaused(id, true);
        assertEq(uint8(pc.getCampaign(id).status), uint8(PC.Status.Paused));
    }

    // ───────────── close ─────────────
    function test_Close_RefundsExactRemainderAndEmits() public {
        _pay(id, POST_1, COMMIT_A, 1000, 1000); // pays 1_500_000
        assertEq(pc.remaining(id), 8_500_000);
        uint256 bBefore = usdc.balanceOf(brand);

        vm.expectEmit(true, false, false, true, address(pc));
        emit PC.CampaignStatusChanged(id, PC.Status.Closed);
        vm.expectEmit(true, false, false, true, address(pc));
        emit PC.CampaignClosed(id, 8_500_000);
        vm.prank(brand);
        pc.close(id);

        assertEq(usdc.balanceOf(brand) - bBefore, 8_500_000);
        PC.Campaign memory c = pc.getCampaign(id);
        assertEq(uint8(c.status), uint8(PC.Status.Closed));
        assertEq(c.withdrawn, 8_500_000);
        assertEq(c.paid, 1_500_000);
        assertEq(pc.remaining(id), 0);
        assertEq(pc.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(pc)), 0);
    }

    function test_Close_ZeroRefundWhenFullyPaid() public {
        PC.CampaignInput memory i = _input();
        uint256 id2 = _create(i, 1_000_000);
        _pay(id2, POST_2, COMMIT_A, 1000, 0); // pays 1_000_000 exactly
        assertEq(pc.remaining(id2), 0);
        uint256 bBefore = usdc.balanceOf(brand);
        vm.expectEmit(true, false, false, true, address(pc));
        emit PC.CampaignClosed(id2, 0);
        vm.prank(brand);
        pc.close(id2);
        assertEq(usdc.balanceOf(brand), bBefore);
    }

    function test_Close_WorksWhileGloballyPaused() public {
        vm.prank(owner);
        pc.pause();
        uint256 bBefore = usdc.balanceOf(brand);
        vm.prank(brand);
        pc.close(id);
        assertEq(usdc.balanceOf(brand) - bBefore, 10_000_000);
    }

    function test_Close_WorksAfterEndsAt() public {
        vm.warp(T0 + 400 days);
        uint256 bBefore = usdc.balanceOf(brand);
        vm.prank(brand);
        pc.close(id);
        assertEq(usdc.balanceOf(brand) - bBefore, 10_000_000);
    }

    function test_Close_WorksBeforeStart() public {
        PC.CampaignInput memory i = _input();
        i.startsAt = uint64(T0 + 5 days);
        uint256 id2 = _create(i, 3_000_000);
        uint256 bBefore = usdc.balanceOf(brand);
        vm.prank(brand);
        pc.close(id2);
        assertEq(usdc.balanceOf(brand) - bBefore, 3_000_000);
    }

    function test_Close_WorksWhenCampaignPaused() public {
        vm.startPrank(brand);
        pc.setPaused(id, true);
        pc.close(id);
        vm.stopPrank();
        assertEq(uint8(pc.getCampaign(id).status), uint8(PC.Status.Closed));
    }

    function test_Close_RevertsTwice() public {
        vm.startPrank(brand);
        pc.close(id);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignIsClosed.selector, id));
        pc.close(id);
        vm.stopPrank();
    }

    function test_Close_RevertsForNonBrand() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, id, stranger));
        pc.close(id);
    }

    function test_Close_OwnerNonBrandCannotMoveFunds() public {
        uint256 ownerBal = usdc.balanceOf(owner);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, id, owner));
        pc.close(id);
        assertEq(usdc.balanceOf(owner), ownerBal);
        assertEq(usdc.balanceOf(address(pc)), 10_000_000);
        assertEq(pc.remaining(id), 10_000_000);
    }

    function test_Close_OwnerAsBrandHasOnlyOrdinaryRights() public {
        usdc.mint(owner, 5e6);
        vm.startPrank(owner);
        usdc.approve(address(pc), type(uint256).max);
        uint256 ownId = pc.createCampaign(_input(), 5e6);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, id, owner));
        pc.close(id);
        pc.close(ownId); // own campaign only
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), 5e6);
    }

    function test_Close_UnknownCampaign() public {
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotFound.selector, 77));
        pc.close(77);
    }

    function test_Close_DoesNotAffectOtherCampaigns() public {
        vm.prank(brand2);
        uint256 id2 = pc.createCampaign(_input(), 2_000_000);
        vm.prank(brand);
        pc.close(id);
        assertEq(pc.remaining(id2), 2_000_000);
        assertEq(pc.totalEscrowed(), 2_000_000);
        assertEq(usdc.balanceOf(address(pc)), 2_000_000);
    }

    // ───────────── payouts blocked after state changes ─────────────
    function test_Report_RevertsAfterClose() public {
        vm.prank(brand);
        pc.close(id);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotActive.selector, id));
        this.sendExt(_rep(id, POST_1, COMMIT_A, 1000, 0));
    }

    function test_Report_RevertsWhileCampaignPaused_ThenResumes() public {
        vm.prank(brand);
        pc.setPaused(id, true);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotActive.selector, id));
        this.sendExt(_rep(id, POST_1, COMMIT_A, 1000, 0));
        vm.prank(brand);
        pc.setPaused(id, false);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_Report_RevertsWhileGloballyPaused() public {
        vm.prank(owner);
        pc.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        this.sendExt(_rep(id, POST_1, COMMIT_A, 1000, 0));
        vm.prank(owner);
        pc.unpause();
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_Report_RevertsBeforeStart() public {
        PC.CampaignInput memory i = _input();
        i.startsAt = uint64(T0 + 1 days);
        uint256 id2 = _create(i, 5e6);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotStarted.selector, id2));
        this.sendExt(_rep(id2, POST_1, COMMIT_A, 1000, 0));
        vm.warp(T0 + 1 days); // inclusive start
        assertEq(_payAmount(id2, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_Report_RevertsAtAndAfterEnd() public {
        uint64 endsAt = pc.getCampaign(id).endsAt;
        vm.warp(endsAt - 1);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
        vm.warp(endsAt); // exclusive end
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignEnded.selector, id));
        this.sendExt(_rep(id, POST_2, COMMIT_A, 1000, 0));
        vm.warp(endsAt + 10 days);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignEnded.selector, id));
        this.sendExt(_rep(id, POST_2, COMMIT_A, 1000, 0));
    }

    /// @dev external wrapper so vm.expectRevert targets the pc call through the helper prank.
    function sendExt(bytes memory report) external {
        _send(report);
    }
}
