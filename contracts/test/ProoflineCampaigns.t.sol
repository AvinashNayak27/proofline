// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";

contract ProoflineCampaignsTest is ProoflineCampaignsTestBase {
    // ───────────── constructor / admin ─────────────
    function test_Constructor_StoresImmutables() public view {
        assertEq(pc.forwarder(), forwarder);
        assertEq(address(pc.usdc()), address(usdc));
        assertTrue(pc.allowAnyWorkflow());
        assertEq(pc.owner(), owner);
        assertEq(pc.nextCampaignId(), 1);
        assertEq(pc.totalEscrowed(), 0);
        assertEq(pc.REPORT_SCHEMA_VERSION(), 3);
        assertEq(pc.MAX_METRIC(), 1_000_000_000);
        assertEq(pc.reportSigner(), signer); // configured by Base.setUp
        assertFalse(pc.workflowIdentityLocked());
    }

    function test_Constructor_ReportSignerDefaultsToZero() public {
        PC fresh = new PC(forwarder, address(usdc), owner, true);
        assertEq(fresh.reportSigner(), address(0));
    }

    function test_Create_RevertsWhenReportSignerNotConfigured() public {
        PC fresh = new PC(forwarder, address(usdc), owner, true);
        _fundActors(fresh);
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(PC.ReportSignerNotConfigured.selector);
        fresh.createCampaign(i, 1e6);
        assertEq(fresh.nextCampaignId(), 1);
        assertEq(fresh.totalEscrowed(), 0);
        // once configured it works
        vm.prank(owner);
        fresh.setReportSigner(signer);
        vm.prank(brand);
        assertEq(fresh.createCampaign(i, 1e6), 1);
    }

    function test_Create_RevertsAfterSignerClearedToZero() public {
        vm.prank(owner);
        pc.setReportSigner(address(0));
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(PC.ReportSignerNotConfigured.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_ReportDigest_MatchesExpectedConstruction() public view {
        bytes memory b = _body(3, 1, POST_1, COMMIT_A, creator, 1000, 0, 123);
        bytes32 expected = keccak256(
            abi.encode(keccak256("ProoflineCampaigns.Report.v3"), block.chainid, address(pc), keccak256(b))
        );
        assertEq(pc.reportDigest(b), expected);
        assertEq(pc.reportDigest(b), _digest(b));
    }

    function test_Constructor_RevertsZeroForwarder() public {
        vm.expectRevert(PC.InvalidForwarder.selector);
        new PC(address(0), address(usdc), owner, true);
    }

    function test_Constructor_RevertsZeroUsdc() public {
        vm.expectRevert(PC.InvalidUSDC.selector);
        new PC(forwarder, address(0), owner, true);
    }

    function test_Constructor_RevertsZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PC(forwarder, address(usdc), address(0), true);
    }

    function test_SupportsInterface() public view {
        assertTrue(pc.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(pc.supportsInterface(type(IERC165).interfaceId));
        assertFalse(pc.supportsInterface(0xffffffff));
        assertFalse(pc.supportsInterface(0x12345678));
    }

    function test_RenounceOwnership_RevertsForOwner() public {
        vm.prank(owner);
        vm.expectRevert(PC.RenounceOwnershipDisabled.selector);
        pc.renounceOwnership();
        assertEq(pc.owner(), owner);
    }

    function test_RenounceOwnership_RevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pc.renounceOwnership();
    }

    function test_TwoStepOwnershipTransfer() public {
        vm.prank(owner);
        pc.transferOwnership(stranger);
        assertEq(pc.owner(), owner);
        vm.prank(stranger);
        pc.acceptOwnership();
        assertEq(pc.owner(), stranger);
    }

    function test_PauseUnpause_OwnerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pc.pause();

        vm.prank(owner);
        pc.pause();
        assertTrue(pc.paused());

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pc.unpause();

        vm.prank(owner);
        pc.unpause();
        assertFalse(pc.paused());
    }

    function test_NoPayableEntryPoints() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(pc).call{value: 1}("");
        assertFalse(ok);
        vm.prank(stranger);
        (ok,) = address(pc).call{value: 1}(hex"deadbeef");
        assertFalse(ok);
        assertEq(address(pc).balance, 0);
    }

    // ───────────── createCampaign happy path / events ─────────────
    function test_Create_StoresCampaignAndEscrows() public {
        PC.CampaignInput memory i = _input();
        i.minViews = 7;
        i.maxPerPost = 2_000_000;
        i.maxPerCreator = 3_000_000;
        uint256 balBefore = usdc.balanceOf(brand);
        uint256 id = _create(i, 10_000_000);
        assertEq(id, 1);
        assertEq(pc.nextCampaignId(), 2);
        PC.Campaign memory c = pc.getCampaign(id);
        assertEq(c.brand, brand);
        assertEq(c.startsAt, block.timestamp);
        assertEq(c.endsAt, i.endsAt);
        assertEq(c.minViews, 7);
        assertEq(c.bonusBps, 5000);
        assertEq(uint8(c.status), uint8(PC.Status.Active));
        assertEq(c.cpmUsdc6, 1_000_000);
        assertEq(c.maxPerPost, 2_000_000);
        assertEq(c.maxPerCreator, 3_000_000);
        assertEq(c.deposited, 10_000_000);
        assertEq(c.paid, 0);
        assertEq(c.withdrawn, 0);
        assertEq(pc.remaining(id), 10_000_000);
        assertEq(pc.totalEscrowed(), 10_000_000);
        assertEq(usdc.balanceOf(address(pc)), 10_000_000);
        assertEq(balBefore - usdc.balanceOf(brand), 10_000_000);
    }

    function test_Create_EmitsCampaignCreatedTuple() public {
        PC.CampaignInput memory i = _input();
        PC.CreationEventData memory d = PC.CreationEventData({
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
            deposit: 5_000_000
        });
        vm.expectEmit(true, true, false, true, address(pc));
        emit PC.CampaignCreated(1, brand, d);
        _create(i, 5_000_000);
    }

    function test_Create_StartsAtInPastNormalizedToNow() public {
        PC.CampaignInput memory i = _input();
        i.startsAt = uint64(T0 - 500);
        uint256 id = _create(i, 1e6);
        assertEq(pc.getCampaign(id).startsAt, T0);
    }

    function test_Create_FutureStartKept() public {
        PC.CampaignInput memory i = _input();
        i.startsAt = uint64(T0 + 2 days);
        uint256 id = _create(i, 1e6);
        assertEq(pc.getCampaign(id).startsAt, T0 + 2 days);
    }

    function test_Create_MaxLengthFieldsAccepted() public {
        PC.CampaignInput memory i = _input();
        i.brandName = string(new bytes(40));
        i.title = string(new bytes(80));
        i.brief = string(new bytes(800));
        i.requiredTag = string(new bytes(32));
        i.link = string(new bytes(200));
        _create(i, 1e6);
    }

    function test_Create_Exactly365DaysAccepted() public {
        PC.CampaignInput memory i = _input();
        i.endsAt = uint64(T0 + 365 days);
        _create(i, 1e6);
        // future start, window exactly 365 days
        i.startsAt = uint64(T0 + 100 days);
        i.endsAt = uint64(T0 + 465 days);
        _create(i, 1e6);
    }

    function test_Create_MaxPerCreatorEqualMaxPerPostAccepted() public {
        PC.CampaignInput memory i = _input();
        i.maxPerCreator = i.maxPerPost;
        _create(i, 1e6);
    }

    function test_Create_BonusBpsMaxAccepted() public {
        PC.CampaignInput memory i = _input();
        i.bonusBps = 10_000;
        _create(i, 1e6);
    }

    function test_Create_MaxUint128DepositAccepted() public {
        usdc.mint(brand, type(uint128).max);
        uint256 id = _createDefault(type(uint128).max);
        assertEq(pc.getCampaign(id).deposited, type(uint128).max);
    }

    // ───────────── createCampaign reverts ─────────────
    function test_Create_RevertsEmptyTitle() public {
        PC.CampaignInput memory i = _input();
        i.title = "";
        vm.prank(brand);
        vm.expectRevert(PC.EmptyTitle.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsBrandNameTooLong() public {
        PC.CampaignInput memory i = _input();
        i.brandName = string(new bytes(41));
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.FieldTooLong.selector, "brandName"));
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsTitleTooLong() public {
        PC.CampaignInput memory i = _input();
        i.title = string(new bytes(81));
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.FieldTooLong.selector, "title"));
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsBriefTooLong() public {
        PC.CampaignInput memory i = _input();
        i.brief = string(new bytes(801));
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.FieldTooLong.selector, "brief"));
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsTagTooLong() public {
        PC.CampaignInput memory i = _input();
        i.requiredTag = string(new bytes(33));
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.FieldTooLong.selector, "requiredTag"));
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsLinkTooLong() public {
        PC.CampaignInput memory i = _input();
        i.link = string(new bytes(201));
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.FieldTooLong.selector, "link"));
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsZeroCpm() public {
        PC.CampaignInput memory i = _input();
        i.cpmUsdc6 = 0;
        vm.prank(brand);
        vm.expectRevert(PC.InvalidCpm.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsZeroMaxPerPost() public {
        PC.CampaignInput memory i = _input();
        i.maxPerPost = 0;
        vm.prank(brand);
        vm.expectRevert(PC.InvalidMaxPerPost.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsMaxPerCreatorBelowMaxPerPost() public {
        PC.CampaignInput memory i = _input();
        i.maxPerCreator = i.maxPerPost - 1;
        vm.prank(brand);
        vm.expectRevert(PC.InvalidMaxPerCreator.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsBonusBpsTooHigh() public {
        PC.CampaignInput memory i = _input();
        i.bonusBps = 10_001;
        vm.prank(brand);
        vm.expectRevert(PC.InvalidBonusBps.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsEndsAtZero() public {
        PC.CampaignInput memory i = _input();
        i.endsAt = 0;
        vm.prank(brand);
        vm.expectRevert(PC.InvalidCampaignDates.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsEndsAtNow() public {
        PC.CampaignInput memory i = _input();
        i.endsAt = uint64(T0);
        vm.prank(brand);
        vm.expectRevert(PC.InvalidCampaignDates.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsEndsBeforeFutureStart() public {
        PC.CampaignInput memory i = _input();
        i.startsAt = uint64(T0 + 10 days);
        i.endsAt = uint64(T0 + 5 days);
        vm.prank(brand);
        vm.expectRevert(PC.InvalidCampaignDates.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsEndsEqualFutureStart() public {
        PC.CampaignInput memory i = _input();
        i.startsAt = uint64(T0 + 10 days);
        i.endsAt = uint64(T0 + 10 days);
        vm.prank(brand);
        vm.expectRevert(PC.InvalidCampaignDates.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsWindowOver365Days() public {
        PC.CampaignInput memory i = _input();
        i.endsAt = uint64(T0 + 365 days + 1);
        vm.prank(brand);
        vm.expectRevert(PC.InvalidCampaignDates.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsFutureStartWindowOver365Days() public {
        PC.CampaignInput memory i = _input();
        i.startsAt = uint64(T0 + 100 days);
        i.endsAt = uint64(T0 + 465 days + 1);
        vm.prank(brand);
        vm.expectRevert(PC.InvalidCampaignDates.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsZeroDeposit() public {
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(PC.InvalidAmount.selector);
        pc.createCampaign(i, 0);
    }

    function test_Create_RevertsDepositOverUint128() public {
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(PC.DepositTooLarge.selector);
        pc.createCampaign(i, uint256(type(uint128).max) + 1);
    }

    function test_Create_RevertsWhenGloballyPaused() public {
        vm.prank(owner);
        pc.pause();
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pc.createCampaign(i, 1e6);
    }

    function test_Create_RevertsWithoutAllowance() public {
        PC.CampaignInput memory i = _input();
        vm.prank(stranger);
        vm.expectRevert();
        pc.createCampaign(i, 1e6);
        assertEq(pc.totalEscrowed(), 0);
        assertEq(pc.nextCampaignId(), 1);
    }

    function test_GetCampaign_RevertsNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotFound.selector, 1));
        pc.getCampaign(1);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotFound.selector, 0));
        pc.remaining(0);
    }
}
