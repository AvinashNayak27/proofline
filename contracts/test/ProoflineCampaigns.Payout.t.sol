// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

contract ProoflineCampaignsPayoutTest is ProoflineCampaignsTestBase {
    uint256 internal id;
    uint256 internal constant DEP = 100_000_000;

    function setUp() public override {
        super.setUp();
        id = _createDefault(DEP);
    }

    /// @dev external wrapper so expectRevert targets a single call that includes the forwarder prank.
    function sendExt(bytes memory report) external {
        _send(report);
    }

    function _expectSend(bytes memory revertData, bytes memory report) internal {
        vm.expectRevert(revertData);
        this.sendExt(report);
    }

    // ───────────── payout examples (quote + onReport) ─────────────
    function test_Quote_Examples() public view {
        assertEq(pc.quote(id, 1000, 0), 1_000_000);
        assertEq(pc.quote(id, 1000, 1000), 1_500_000);
        assertEq(pc.quote(id, 1000, 500), 1_125_000);
        assertEq(pc.quote(id, 2000, 9999), 3_000_000);
    }

    function test_Report_PaysExamples() public {
        assertEq(_payAmount(id, keccak256("a"), keccak256("ca"), 1000, 0), 1_000_000);
        assertEq(_payAmount(id, keccak256("b"), keccak256("cb"), 1000, 1000), 1_500_000);
        assertEq(_payAmount(id, keccak256("c"), keccak256("cc"), 1000, 500), 1_125_000);
        assertEq(_payAmount(id, keccak256("d"), keccak256("cd"), 2000, 9999), 3_000_000);
        PC.Campaign memory c = pc.getCampaign(id);
        assertEq(c.paid, 6_625_000);
        assertEq(pc.totalEscrowed(), DEP - 6_625_000);
        assertEq(pc.remaining(id), DEP - 6_625_000);
    }

    function test_Report_EmitsPostRewarded() public {
        vm.expectEmit(true, true, true, true, address(pc));
        emit PC.PostRewarded(id, POST_1, COMMIT_A, creator, 1000, 500, 1_125_000);
        _pay(id, POST_1, COMMIT_A, 1000, 500);
        assertTrue(pc.postRewarded(id, POST_1));
        assertEq(pc.creatorPaid(id, COMMIT_A), 1_125_000);
    }

    function test_Report_PaysReportBoundRecipient() public {
        address other = makeAddr("otherWallet");
        _send(_reportBytes(3, id, POST_1, COMMIT_A, other, 1000, 0, block.timestamp));
        assertEq(usdc.balanceOf(other), 1_000_000);
        assertEq(usdc.balanceOf(creator), 0);
    }

    function test_Report_CompletionsAboveViewsClampedToRetentionOne() public {
        uint256 a = _payAmount(id, POST_1, COMMIT_A, 1000, 1000);
        uint256 b = _payAmount(id, POST_2, COMMIT_B, 1000, 1_000_000_000);
        assertEq(a, 1_500_000);
        assertEq(b, a);
    }

    function test_MaxPerPostClamp() public {
        PC.CampaignInput memory i = _input();
        i.maxPerPost = 5_000_000;
        i.maxPerCreator = 50_000_000;
        uint256 id2 = _create(i, DEP);
        // uncapped would be 3_334_000 + 1_667_000 = 5_001_000
        assertEq(pc.quote(id2, 3334, 3334), 5_000_000);
        assertEq(_payAmount(id2, POST_1, COMMIT_A, 3334, 3334), 5_000_000);
        // just below clamp is unclamped: 3333 views -> 3_333_000 + 1_666_500
        assertEq(pc.quote(id2, 3333, 3333), 4_999_500);
    }

    // ───────────── minViews / zero views / metric bounds ─────────────
    function _minViewsCampaign() internal returns (uint256) {
        PC.CampaignInput memory i = _input();
        i.minViews = 1000;
        return _create(i, DEP);
    }

    function test_MinViews_BelowThresholdQuotesZeroAndReportReverts() public {
        uint256 id2 = _minViewsCampaign();
        assertEq(pc.quote(id2, 999, 999), 0);
        _expectSend(abi.encodeWithSelector(PC.BelowMinViews.selector, id2, 999, 1000), _rep(id2, POST_1, COMMIT_A, 999, 999));
        assertFalse(pc.postRewarded(id2, POST_1)); // not consumed
    }

    function test_MinViews_AtThresholdPays() public {
        uint256 id2 = _minViewsCampaign();
        assertEq(pc.quote(id2, 1000, 0), 1_000_000);
        assertEq(_payAmount(id2, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_MinViews_ZeroViewsRevertsBelowMin() public {
        uint256 id2 = _minViewsCampaign();
        _expectSend(abi.encodeWithSelector(PC.BelowMinViews.selector, id2, 0, 1000), _rep(id2, POST_1, COMMIT_A, 0, 0));
    }

    function test_ZeroViews_QuoteZeroAndReportNothingToPay() public {
        assertEq(pc.quote(id, 0, 0), 0);
        assertEq(pc.quote(id, 0, 500), 0);
        _expectSend(abi.encodeWithSelector(PC.NothingToPay.selector, id), _rep(id, POST_1, COMMIT_A, 0, 100));
        assertFalse(pc.postRewarded(id, POST_1));
        assertEq(pc.creatorPaid(id, COMMIT_A), 0);
    }

    function test_NothingToPay_TinyCpmRoundsToZero() public {
        PC.CampaignInput memory i = _input();
        i.cpmUsdc6 = 1;
        i.maxPerPost = 10;
        i.maxPerCreator = 10;
        uint256 id2 = _create(i, 1000);
        assertEq(pc.quote(id2, 999, 999), 0); // 999*1/1000 == 0
        _expectSend(abi.encodeWithSelector(PC.NothingToPay.selector, id2), _rep(id2, POST_1, COMMIT_A, 999, 999));
    }

    function test_Metrics_AboveMaxRevert() public {
        uint256 over = 1_000_000_001;
        vm.expectRevert(abi.encodeWithSelector(PC.InputTooLarge.selector, over, 1_000_000_000));
        pc.quote(id, over, 0);
        vm.expectRevert(abi.encodeWithSelector(PC.InputTooLarge.selector, over, 1_000_000_000));
        pc.quote(id, 1000, over);
        vm.expectRevert(abi.encodeWithSelector(PC.InputTooLarge.selector, over, 1_000_000_000));
        pc.quote(id, 0, over); // even with zero views
        vm.expectRevert(abi.encodeWithSelector(PC.InputTooLarge.selector, over, 1_000_000_000));
        pc.previewPayout(id, COMMIT_A, over, 0);

        _expectSend(abi.encodeWithSelector(PC.InputTooLarge.selector, over, 1_000_000_000), _rep(id, POST_1, COMMIT_A, over, 0));
        _expectSend(abi.encodeWithSelector(PC.InputTooLarge.selector, over, 1_000_000_000), _rep(id, POST_1, COMMIT_A, 1000, over));
    }

    function test_Metrics_AboveMaxRevertEvenBelowMinViews() public {
        uint256 id2 = _minViewsCampaign();
        vm.expectRevert(abi.encodeWithSelector(PC.InputTooLarge.selector, 1_000_000_001, 1_000_000_000));
        pc.quote(id2, 5, 1_000_000_001);
    }

    function test_Metrics_AtMaxAccepted() public {
        PC.CampaignInput memory i = _input();
        i.maxPerPost = type(uint96).max;
        i.maxPerCreator = type(uint96).max;
        uint256 id2 = _create(i, 5_000_000_000_000);
        // base = 1e9 * 1e6 / 1000 = 1e12; bonus = 0.5e12
        assertEq(pc.quote(id2, 1_000_000_000, 1_000_000_000), 1_500_000_000_000);
        assertEq(_payAmount(id2, POST_1, COMMIT_A, 1_000_000_000, 1_000_000_000), 1_500_000_000_000);
    }

    // ───────────── creator cap ─────────────
    function _capCampaign() internal returns (uint256) {
        PC.CampaignInput memory i = _input();
        i.maxPerPost = 1_500_000;
        i.maxPerCreator = 2_000_000;
        return _create(i, DEP);
    }

    function test_CreatorCap_ClampsSecondPostSameCommitment() public {
        uint256 id2 = _capCampaign();
        assertEq(_payAmount(id2, POST_1, COMMIT_A, 1000, 1000), 1_500_000);
        assertEq(pc.previewPayout(id2, COMMIT_A, 1000, 1000), 500_000);
        assertEq(pc.quote(id2, 1000, 1000), 1_500_000); // quote ignores creator allowance
        assertEq(_payAmount(id2, POST_2, COMMIT_A, 1000, 1000), 500_000);
        assertEq(pc.creatorPaid(id2, COMMIT_A), 2_000_000);
        // third post: cap reached
        _expectSend(
            abi.encodeWithSelector(PC.CreatorCapReached.selector, id2, COMMIT_A, 2_000_000, 2_000_000),
            _rep(id2, POST_3, COMMIT_A, 1000, 1000)
        );
        assertEq(pc.previewPayout(id2, COMMIT_A, 1000, 1000), 0);
        // different creator unaffected
        assertEq(_payAmount(id2, POST_3, COMMIT_B, 1000, 1000), 1_500_000);
    }

    function test_CreatorCap_IsPerCampaign() public {
        uint256 id2 = _capCampaign();
        uint256 id3 = _capCampaign();
        assertEq(_payAmount(id2, POST_1, COMMIT_A, 1000, 1000), 1_500_000);
        assertEq(_payAmount(id2, POST_2, COMMIT_A, 1000, 1000), 500_000);
        // same commitment in another campaign still has a full allowance
        assertEq(pc.creatorPaid(id3, COMMIT_A), 0);
        assertEq(_payAmount(id3, POST_3, COMMIT_A, 1000, 1000), 1_500_000);
        assertEq(pc.creatorPaid(id2, COMMIT_A), 2_000_000);
        assertEq(pc.creatorPaid(id3, COMMIT_A), 1_500_000);
    }

    // ───────────── remaining budget ─────────────
    function test_Budget_ClampsToRemainingThenExhausts() public {
        uint256 id2 = _create(_input(), 1_200_000);
        assertEq(pc.previewPayout(id2, COMMIT_A, 1000, 1000), 1_200_000);
        assertEq(_payAmount(id2, POST_1, COMMIT_A, 1000, 1000), 1_200_000);
        assertEq(pc.remaining(id2), 0);
        assertEq(pc.totalEscrowed(), DEP); // id's deposit only
        _expectSend(abi.encodeWithSelector(PC.BudgetExhausted.selector, id2), _rep(id2, POST_2, COMMIT_B, 1000, 1000));
        assertFalse(pc.postRewarded(id2, POST_2));
        // topping up lets it resume
        vm.prank(sponsor);
        pc.fund(id2, 1_000_000);
        assertEq(_payAmount(id2, POST_2, COMMIT_B, 1000, 0), 1_000_000);
    }

    // ───────────── per-campaign dedupe ─────────────
    function test_PostKey_SameKeyInSecondCampaignSucceedsAndPays() public {
        uint256 id2 = _createDefault(DEP);
        _pay(id, POST_1, COMMIT_A, 1000, 0);
        // same key in a different campaign is a different (campaignId, postKey) pair
        assertFalse(pc.postRewarded(id2, POST_1));
        assertEq(_payAmount(id2, POST_1, COMMIT_B, 1000, 0), 1_000_000);
        assertTrue(pc.postRewarded(id2, POST_1));
        assertEq(pc.creatorPaid(id2, COMMIT_B), 1_000_000);
        // a repeat inside the same campaign still reverts with the pair
        _expectSend(abi.encodeWithSelector(PC.PostAlreadyRewarded.selector, id, POST_1), _rep(id, POST_1, COMMIT_A, 1000, 0));
        _expectSend(abi.encodeWithSelector(PC.PostAlreadyRewarded.selector, id2, POST_1), _rep(id2, POST_1, COMMIT_B, 1000, 0));
    }

    // ───────────── report validation ─────────────
    function test_Report_OnlyForwarder() public {
        bytes memory r = _rep(id, POST_1, COMMIT_A, 1000, 0);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PC.UnauthorizedForwarder.selector, stranger));
        pc.onReport("", r);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PC.UnauthorizedForwarder.selector, owner));
        pc.onReport("", r);
        vm.prank(brand);
        vm.expectRevert(abi.encodeWithSelector(PC.UnauthorizedForwarder.selector, brand));
        pc.onReport("", r);
    }

    function test_Report_BadLength() public {
        bytes memory r = _rep(id, POST_1, COMMIT_A, 1000, 0);
        assertEq(r.length, 321);
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 322), abi.encodePacked(r, bytes1(0)));
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 320), _slice(r, 320));
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 256), _slice(r, 256)); // unsigned body
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 255), _slice(r, 255));
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 288), _slice(abi.encodePacked(r, bytes32(0)), 288));
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 0), "");
        assertFalse(pc.postRewarded(id, POST_1));
    }

    function _slice(bytes memory b, uint256 n) internal pure returns (bytes memory out) {
        out = new bytes(n);
        for (uint256 i; i < n; ++i) out[i] = b[i];
    }

    function test_Report_BadVersion() public {
        for (uint8 v = 0; v < 6; ++v) {
            if (v == 3) continue;
            _expectSend(
                abi.encodeWithSelector(PC.UnsupportedSchemaVersion.selector, v),
                _reportBytes(v, id, POST_1, COMMIT_A, creator, 1000, 0, block.timestamp)
            );
        }
    }

    function test_Report_Expiry() public {
        _expectSend(
            abi.encodeWithSelector(PC.ReportExpired.selector, block.timestamp - 1),
            _reportBytes(3, id, POST_1, COMMIT_A, creator, 1000, 0, block.timestamp - 1)
        );
        // expiry == now is still valid
        _send(_reportBytes(3, id, POST_1, COMMIT_A, creator, 1000, 0, block.timestamp));
        assertTrue(pc.postRewarded(id, POST_1));
    }

    function test_Report_ZeroRecipient() public {
        _expectSend(
            _err(PC.InvalidRecipient.selector),
            _reportBytes(3, id, POST_1, COMMIT_A, address(0), 1000, 0, block.timestamp)
        );
    }

    function test_Report_ZeroPostKey() public {
        _expectSend(_err(PC.InvalidPostKey.selector), _rep(id, bytes32(0), COMMIT_A, 1000, 0));
    }

    function test_Report_ZeroCommitment() public {
        _expectSend(_err(PC.InvalidCreatorCommitment.selector), _rep(id, POST_1, bytes32(0), 1000, 0));
    }

    function test_Report_UnknownCampaign() public {
        _expectSend(abi.encodeWithSelector(PC.CampaignNotFound.selector, 0), _rep(0, POST_1, COMMIT_A, 1000, 0));
        _expectSend(abi.encodeWithSelector(PC.CampaignNotFound.selector, 5), _rep(5, POST_1, COMMIT_A, 1000, 0));
    }

    // ───────────── previewPayout ─────────────
    function test_PreviewPayout_MatchesPaid() public {
        uint256 p = pc.previewPayout(id, COMMIT_A, 1234, 777);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1234, 777), p);
        assertGt(p, 0);
    }

    function test_PreviewPayout_UnknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotFound.selector, 9));
        pc.previewPayout(9, COMMIT_A, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(PC.CampaignNotFound.selector, 9));
        pc.quote(9, 1, 1);
    }
}
