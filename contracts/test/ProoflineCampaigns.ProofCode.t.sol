// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

/// @dev requireProofCode is stored + emitted only; it must never change on-chain behaviour.
contract ProoflineCampaignsProofCodeTest is ProoflineCampaignsTestBase {
    uint256 internal constant DEP = 100_000_000;

    function _inputWith(bool flag) internal view returns (PC.CampaignInput memory i) {
        i = _input();
        i.requireProofCode = flag;
        i.minViews = 10;
        i.maxPerPost = 5_000_000;
        i.maxPerCreator = 8_000_000;
    }

    function _eventData(PC.CampaignInput memory i, uint256 dep) internal view returns (PC.CreationEventData memory) {
        return PC.CreationEventData({
            brandName: i.brandName,
            title: i.title,
            brief: i.brief,
            requiredTag: i.requiredTag,
            link: i.link,
            startsAt: uint64(block.timestamp),
            endsAt: i.endsAt,
            minViews: i.minViews,
            bonusBps: i.bonusBps,
            cpmUsdc6: i.cpmUsdc6,
            maxPerPost: i.maxPerPost,
            maxPerCreator: i.maxPerCreator,
            requireProofCode: i.requireProofCode,
            deposit: dep
        });
    }

    /// @dev Two campaigns with identical terms/deposit; first has flag=true, second flag=false.
    function _pair() internal returns (uint256 idT, uint256 idF) {
        idT = _create(_inputWith(true), DEP);
        idF = _create(_inputWith(false), DEP);
    }

    // ───────────── default helper ─────────────
    function test_BaseInputDefaultsRequireProofCodeTrue() public view {
        assertTrue(_input().requireProofCode);
    }

    // ───────────── storage ─────────────
    function test_Create_StoresRequireProofCodeTrue() public {
        uint256 id = _create(_inputWith(true), DEP);
        assertTrue(pc.getCampaign(id).requireProofCode);
    }

    function test_Create_StoresRequireProofCodeFalse() public {
        uint256 id = _create(_inputWith(false), DEP);
        assertFalse(pc.getCampaign(id).requireProofCode);
    }

    function test_Create_FlagIsPerCampaign() public {
        (uint256 idT, uint256 idF) = _pair();
        uint256 idT2 = _create(_inputWith(true), DEP);
        assertTrue(pc.getCampaign(idT).requireProofCode);
        assertFalse(pc.getCampaign(idF).requireProofCode);
        assertTrue(pc.getCampaign(idT2).requireProofCode);
    }

    function test_Create_FlagDoesNotDisturbOtherStoredFields() public {
        (uint256 idT, uint256 idF) = _pair();
        PC.Campaign memory t = pc.getCampaign(idT);
        PC.Campaign memory f = pc.getCampaign(idF);
        assertEq(t.brand, f.brand);
        assertEq(t.startsAt, f.startsAt);
        assertEq(t.endsAt, f.endsAt);
        assertEq(t.minViews, f.minViews);
        assertEq(t.bonusBps, f.bonusBps);
        assertEq(uint8(t.status), uint8(PC.Status.Active));
        assertEq(uint8(f.status), uint8(PC.Status.Active));
        assertEq(t.cpmUsdc6, f.cpmUsdc6);
        assertEq(t.maxPerPost, 5_000_000);
        assertEq(f.maxPerPost, 5_000_000);
        assertEq(t.maxPerCreator, 8_000_000);
        assertEq(f.maxPerCreator, 8_000_000);
        assertEq(t.deposited, DEP);
        assertEq(f.deposited, DEP);
        assertEq(t.paid, 0);
        assertEq(f.paid, 0);
        assertEq(t.withdrawn, 0);
        assertEq(f.withdrawn, 0);
    }

    // ───────────── event ─────────────
    function test_Create_EmitsRequireProofCodeTrue() public {
        PC.CampaignInput memory i = _inputWith(true);
        vm.expectEmit(true, true, false, true, address(pc));
        emit PC.CampaignCreated(1, brand, _eventData(i, 5_000_000));
        _create(i, 5_000_000);
    }

    function test_Create_EmitsRequireProofCodeFalse() public {
        PC.CampaignInput memory i = _inputWith(false);
        vm.expectEmit(true, true, false, true, address(pc));
        emit PC.CampaignCreated(1, brand, _eventData(i, 5_000_000));
        _create(i, 5_000_000);
    }

    /// @dev Decodes the raw log so the flag value is asserted independently of expectEmit matching.
    function _createdFlag(bool flag) internal returns (bool emitted, uint256 deposit) {
        vm.recordLogs();
        _create(_inputWith(flag), 3_000_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 k; k < logs.length; ++k) {
            if (logs[k].emitter == address(pc) && logs[k].topics[0] == PC.CampaignCreated.selector) {
                (PC.CreationEventData memory d) = abi.decode(logs[k].data, (PC.CreationEventData));
                return (d.requireProofCode, d.deposit);
            }
        }
        fail("CampaignCreated not found");
    }

    function test_Create_EventDecodedFlagMatchesInput() public {
        (bool eT, uint256 dT) = _createdFlag(true);
        assertTrue(eT);
        assertEq(dT, 3_000_000); // deposit still follows the flag in the tuple
        (bool eF, uint256 dF) = _createdFlag(false);
        assertFalse(eF);
        assertEq(dF, 3_000_000);
    }

    // ───────────── payouts unaffected ─────────────
    function test_Payout_SameInputsPaySameAmountForTrueAndFalse() public {
        (uint256 idT, uint256 idF) = _pair();
        uint256[4] memory views = [uint256(10), 1000, 2500, 1_000_000];
        uint256[4] memory comps = [uint256(0), 500, 2500, 7];
        for (uint256 k; k < 4; ++k) {
            assertEq(pc.quote(idT, views[k], comps[k]), pc.quote(idF, views[k], comps[k]));
            bytes32 ca = keccak256(abi.encode("ca", k));
            bytes32 cb = keccak256(abi.encode("cb", k));
            uint256 pT = _payAmount(idT, keccak256(abi.encode("pT", k)), ca, views[k], comps[k]);
            uint256 pF = _payAmount(idF, keccak256(abi.encode("pF", k)), cb, views[k], comps[k]);
            assertEq(pT, pF);
            assertGt(pT, 0);
        }
        PC.Campaign memory t = pc.getCampaign(idT);
        PC.Campaign memory f = pc.getCampaign(idF);
        assertEq(t.paid, f.paid);
        assertEq(pc.remaining(idT), pc.remaining(idF));
        // flags survive payouts
        assertTrue(t.requireProofCode);
        assertFalse(f.requireProofCode);
    }

    function test_Payout_KnownAmountsForBothFlags() public {
        (uint256 idT, uint256 idF) = _pair();
        // cpm 1.0 USDC, bonus 50%: 1000 views, 500 comps → 1_125_000
        assertEq(_payAmount(idT, POST_1, COMMIT_A, 1000, 500), 1_125_000);
        assertEq(_payAmount(idF, POST_2, COMMIT_A, 1000, 500), 1_125_000);
    }

    function test_Payout_PerPostCapAndCreatorCapIdenticalForBothFlags() public {
        (uint256 idT, uint256 idF) = _pair();
        // per-post cap 5e6: 1e6 views would be 1e9 uncapped
        assertEq(_payAmount(idT, POST_1, COMMIT_A, 1_000_000, 0), 5_000_000);
        assertEq(_payAmount(idF, POST_2, COMMIT_A, 1_000_000, 0), 5_000_000);
        // creator cap 8e6 → only 3e6 remaining allowance
        assertEq(_payAmount(idT, POST_3, COMMIT_A, 1_000_000, 0), 3_000_000);
        assertEq(_payAmount(idF, keccak256("p4"), COMMIT_A, 1_000_000, 0), 3_000_000);
        assertEq(pc.previewPayout(idT, COMMIT_A, 1000, 0), pc.previewPayout(idF, COMMIT_A, 1000, 0));
        assertEq(pc.previewPayout(idT, COMMIT_A, 1000, 0), 0);
    }

    function test_Report_BelowMinViewsRevertsIdenticallyForBothFlags() public {
        (uint256 idT, uint256 idF) = _pair();
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(PC.BelowMinViews.selector, idT, 9, 10));
        pc.onReport("", _rep(idT, POST_1, COMMIT_A, 9, 0));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(PC.BelowMinViews.selector, idF, 9, 10));
        pc.onReport("", _rep(idF, POST_2, COMMIT_A, 9, 0));
    }

    function test_Report_EmitsPostRewardedUnchangedByFlag() public {
        (uint256 idT, uint256 idF) = _pair();
        vm.expectEmit(true, true, true, true, address(pc));
        emit PC.PostRewarded(idT, POST_1, COMMIT_A, creator, 1000, 500, 1_125_000);
        _pay(idT, POST_1, COMMIT_A, 1000, 500);
        vm.expectEmit(true, true, true, true, address(pc));
        emit PC.PostRewarded(idF, POST_2, COMMIT_A, creator, 1000, 500, 1_125_000);
        _pay(idF, POST_2, COMMIT_A, 1000, 500);
    }

    // ───────────── fund / pause / close unaffected ─────────────
    function test_Fund_SameForBothFlagsAndFlagPreserved() public {
        (uint256 idT, uint256 idF) = _pair();
        vm.prank(sponsor);
        pc.fund(idT, 7e6);
        vm.prank(sponsor);
        pc.fund(idF, 7e6);
        assertEq(pc.getCampaign(idT).deposited, DEP + 7e6);
        assertEq(pc.getCampaign(idF).deposited, DEP + 7e6);
        assertEq(pc.totalEscrowed(), 2 * (DEP + 7e6));
        assertTrue(pc.getCampaign(idT).requireProofCode);
        assertFalse(pc.getCampaign(idF).requireProofCode);
    }

    function test_Fund_EmitsSameEventForBothFlags() public {
        (uint256 idT, uint256 idF) = _pair();
        vm.expectEmit(true, true, false, true, address(pc));
        emit PC.CampaignFunded(idT, sponsor, 1e6);
        vm.prank(sponsor);
        pc.fund(idT, 1e6);
        vm.expectEmit(true, true, false, true, address(pc));
        emit PC.CampaignFunded(idF, sponsor, 1e6);
        vm.prank(sponsor);
        pc.fund(idF, 1e6);
    }

    function test_Pause_BehavesSameForBothFlagsAndFlagPreserved() public {
        (uint256 idT, uint256 idF) = _pair();
        vm.startPrank(brand);
        pc.setPaused(idT, true);
        pc.setPaused(idF, true);
        vm.stopPrank();
        assertEq(uint8(pc.getCampaign(idT).status), uint8(PC.Status.Paused));
        assertEq(uint8(pc.getCampaign(idF).status), uint8(PC.Status.Paused));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotActive.selector, idT));
        pc.onReport("", _rep(idT, POST_1, COMMIT_A, 1000, 0));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotActive.selector, idF));
        pc.onReport("", _rep(idF, POST_2, COMMIT_A, 1000, 0));
        vm.startPrank(brand);
        pc.setPaused(idT, false);
        pc.setPaused(idF, false);
        vm.stopPrank();
        assertEq(_payAmount(idT, POST_1, COMMIT_A, 1000, 0), 1_000_000);
        assertEq(_payAmount(idF, POST_2, COMMIT_A, 1000, 0), 1_000_000);
        assertTrue(pc.getCampaign(idT).requireProofCode);
        assertFalse(pc.getCampaign(idF).requireProofCode);
    }

    function test_Pause_OnlyBrandRegardlessOfFlag() public {
        (uint256 idT, uint256 idF) = _pair();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, idT, stranger));
        pc.setPaused(idT, true);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PC.NotCampaignBrand.selector, idF, stranger));
        pc.setPaused(idF, true);
    }

    function test_Close_RefundsSameForBothFlagsAndFlagPreserved() public {
        (uint256 idT, uint256 idF) = _pair();
        _pay(idT, POST_1, COMMIT_A, 1000, 500);
        _pay(idF, POST_2, COMMIT_A, 1000, 500);
        uint256 expectedRefund = DEP - 1_125_000;
        uint256 before = usdc.balanceOf(brand);
        vm.expectEmit(true, false, false, true, address(pc));
        emit PC.CampaignClosed(idT, expectedRefund);
        vm.prank(brand);
        pc.close(idT);
        assertEq(usdc.balanceOf(brand) - before, expectedRefund);
        before = usdc.balanceOf(brand);
        vm.expectEmit(true, false, false, true, address(pc));
        emit PC.CampaignClosed(idF, expectedRefund);
        vm.prank(brand);
        pc.close(idF);
        assertEq(usdc.balanceOf(brand) - before, expectedRefund);
        assertEq(pc.totalEscrowed(), 0);
        PC.Campaign memory t = pc.getCampaign(idT);
        PC.Campaign memory f = pc.getCampaign(idF);
        assertEq(uint8(t.status), uint8(PC.Status.Closed));
        assertEq(uint8(f.status), uint8(PC.Status.Closed));
        assertTrue(t.requireProofCode);
        assertFalse(f.requireProofCode);
    }

    function test_Close_ReportsAfterCloseRevertSameForBothFlags() public {
        (uint256 idT, uint256 idF) = _pair();
        vm.startPrank(brand);
        pc.close(idT);
        pc.close(idF);
        vm.stopPrank();
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotActive.selector, idT));
        pc.onReport("", _rep(idT, POST_1, COMMIT_A, 1000, 0));
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotActive.selector, idF));
        pc.onReport("", _rep(idF, POST_2, COMMIT_A, 1000, 0));
    }

    function test_GlobalPause_BlocksCreateForBothFlags() public {
        vm.prank(owner);
        pc.pause();
        vm.prank(brand);
        vm.expectRevert();
        pc.createCampaign(_inputWith(true), DEP);
        vm.prank(brand);
        vm.expectRevert();
        pc.createCampaign(_inputWith(false), DEP);
    }

    // ───────────── fuzz ─────────────
    function testFuzz_Create_StoresAndEmitsFlag(
        bool flag,
        uint32 minViews,
        uint16 bps,
        uint96 cpm,
        uint96 maxPost,
        uint96 extraCreator,
        uint128 dep
    ) public {
        cpm = uint96(bound(cpm, 1, type(uint96).max));
        maxPost = uint96(bound(maxPost, 1, type(uint96).max / 2));
        extraCreator = uint96(bound(extraCreator, 0, type(uint96).max / 2));
        bps = uint16(bound(bps, 0, 10_000));
        uint256 deposit = bound(dep, 1, BIG);
        PC.CampaignInput memory i = _input();
        i.requireProofCode = flag;
        i.minViews = minViews;
        i.bonusBps = bps;
        i.cpmUsdc6 = cpm;
        i.maxPerPost = maxPost;
        i.maxPerCreator = maxPost + extraCreator;
        vm.expectEmit(true, true, false, true, address(pc));
        emit PC.CampaignCreated(1, brand, _eventData(i, deposit));
        uint256 id = _create(i, deposit);
        PC.Campaign memory c = pc.getCampaign(id);
        assertEq(c.requireProofCode, flag);
        assertEq(c.deposited, deposit);
        assertEq(c.minViews, minViews);
        assertEq(c.maxPerPost, maxPost);
        assertEq(c.maxPerCreator, i.maxPerCreator);
        assertEq(uint8(c.status), uint8(PC.Status.Active));
    }

    function testFuzz_Payout_IndependentOfFlag(uint256 views, uint256 comps, uint16 bps, uint96 cpm) public {
        views = bound(views, 10, 1_000_000);
        comps = bound(comps, 0, 2_000_000);
        bps = uint16(bound(bps, 0, 10_000));
        cpm = uint96(bound(cpm, 1, 10_000_000));
        PC.CampaignInput memory a = _inputWith(true);
        PC.CampaignInput memory b = _inputWith(false);
        a.bonusBps = bps;
        b.bonusBps = bps;
        a.cpmUsdc6 = cpm;
        b.cpmUsdc6 = cpm;
        uint256 idT = _create(a, DEP);
        uint256 idF = _create(b, DEP);
        assertEq(pc.quote(idT, views, comps), pc.quote(idF, views, comps));
        uint256 q = pc.previewPayout(idT, COMMIT_A, views, comps);
        assertEq(q, pc.previewPayout(idF, COMMIT_A, views, comps));
        if (q == 0) return;
        uint256 pT = _payAmount(idT, POST_1, COMMIT_A, views, comps);
        uint256 pF = _payAmount(idF, POST_2, COMMIT_A, views, comps);
        assertEq(pT, q);
        assertEq(pF, q);
        assertEq(pc.remaining(idT), pc.remaining(idF));
    }
}
