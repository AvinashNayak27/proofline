// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

contract ProoflineCampaignsFuzzTest is ProoflineCampaignsTestBase {
    uint256 internal constant MAXM = 1_000_000_000;

    function _mk(uint96 cpm, uint16 bps, uint32 minViews, uint96 maxPost, uint96 maxCreator, uint256 dep)
        internal
        returns (uint256)
    {
        PC.CampaignInput memory i = _input();
        i.cpmUsdc6 = cpm;
        i.bonusBps = bps;
        i.minViews = minViews;
        i.maxPerPost = maxPost;
        i.maxPerCreator = maxCreator;
        return _create(i, dep);
    }

    function _ref(uint256 views, uint256 comps, uint256 cpm, uint256 bps, uint256 minViews, uint256 cap)
        internal
        pure
        returns (uint256)
    {
        if (views == 0 || views < minViews) return 0;
        uint256 base = views * cpm / 1000;
        uint256 m = comps < views ? comps : views;
        uint256 bonus = ((base * bps) / 10_000) * (m * m) / (views * views);
        uint256 total = base + bonus;
        return total < cap ? total : cap;
    }

    function testFuzz_Quote_MatchesReference(
        uint96 cpm,
        uint16 bps,
        uint32 minViews,
        uint96 maxPost,
        uint256 views,
        uint256 comps
    ) public {
        cpm = uint96(bound(cpm, 1, type(uint96).max));
        bps = uint16(bound(bps, 0, 10_000));
        maxPost = uint96(bound(maxPost, 1, type(uint96).max));
        views = bound(views, 0, MAXM);
        comps = bound(comps, 0, MAXM);
        uint256 id = _mk(cpm, bps, minViews, maxPost, maxPost, 1);
        assertEq(pc.quote(id, views, comps), _ref(views, comps, cpm, bps, minViews, maxPost));
    }

    function testFuzz_Quote_BoundedByBaseAndCap(
        uint96 cpm,
        uint16 bps,
        uint96 maxPost,
        uint256 views,
        uint256 comps
    ) public {
        cpm = uint96(bound(cpm, 1, type(uint96).max));
        bps = uint16(bound(bps, 0, 10_000));
        maxPost = uint96(bound(maxPost, 1, type(uint96).max));
        views = bound(views, 1, MAXM);
        comps = bound(comps, 0, MAXM);
        uint256 id = _mk(cpm, bps, 0, maxPost, maxPost, 1);
        uint256 q = pc.quote(id, views, comps);
        uint256 base = views * cpm / 1000;
        uint256 maxAll = base + (base * bps) / 10_000;
        assertLe(q, maxPost, "per-post cap");
        assertLe(q, maxAll, "never above full-bonus payout");
        assertGe(q, base < maxPost ? base : maxPost, "never below base (capped)");
    }

    function testFuzz_Quote_MonotonicInCompletions(
        uint96 cpm,
        uint16 bps,
        uint256 views,
        uint256 c1,
        uint256 c2
    ) public {
        cpm = uint96(bound(cpm, 1, type(uint96).max));
        bps = uint16(bound(bps, 0, 10_000));
        views = bound(views, 1, MAXM);
        c1 = bound(c1, 0, MAXM);
        c2 = bound(c2, c1, MAXM);
        uint256 id = _mk(cpm, bps, 0, type(uint96).max, type(uint96).max, 1);
        assertLe(pc.quote(id, views, c1), pc.quote(id, views, c2));
    }

    function testFuzz_Quote_CompletionsClampedToViews(uint96 cpm, uint16 bps, uint256 views, uint256 comps) public {
        cpm = uint96(bound(cpm, 1, type(uint96).max));
        bps = uint16(bound(bps, 0, 10_000));
        views = bound(views, 0, MAXM);
        comps = bound(comps, views, MAXM);
        uint256 id = _mk(cpm, bps, 0, type(uint96).max, type(uint96).max, 1);
        assertEq(pc.quote(id, views, comps), pc.quote(id, views, views));
    }

    function testFuzz_Quote_RevertsAboveMaxMetric(uint256 views, uint256 comps) public {
        uint256 id = _createDefault(1);
        views = bound(views, MAXM + 1, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(PC.InputTooLarge.selector, views, MAXM));
        pc.quote(id, views, 0);
        comps = bound(comps, MAXM + 1, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(PC.InputTooLarge.selector, comps, MAXM));
        pc.quote(id, 1, comps);
    }

    function testFuzz_PreviewPayout_ClampsToAllowanceAndBudget(
        uint96 maxPost,
        uint96 extraCreator,
        uint256 dep,
        uint256 v1,
        uint256 c1,
        uint256 v2,
        uint256 c2
    ) public {
        maxPost = uint96(bound(maxPost, 1, 1e12));
        extraCreator = uint96(bound(extraCreator, 0, 1e12));
        dep = bound(dep, 1, 1e13);
        v1 = bound(v1, 0, MAXM);
        v2 = bound(v2, 0, MAXM);
        c1 = bound(c1, 0, MAXM);
        c2 = bound(c2, 0, MAXM);
        uint96 maxCreator = maxPost + extraCreator;
        uint256 id = _mk(1_000_000, 5000, 0, maxPost, maxCreator, dep);

        bytes memory rep1 = _rep(id, POST_1, COMMIT_A, v1, c1);
        vm.prank(forwarder);
        try pc.onReport("", rep1) {} catch {}

        uint256 q = pc.quote(id, v2, c2);
        uint256 paid = pc.creatorPaid(id, COMMIT_A);
        uint256 allowance = paid >= maxCreator ? 0 : maxCreator - paid;
        uint256 rem = pc.remaining(id);
        uint256 exp = q;
        if (allowance < exp) exp = allowance;
        if (rem < exp) exp = rem;
        assertEq(pc.previewPayout(id, COMMIT_A, v2, c2), exp);
    }

    function testFuzz_Report_AccountingConsistent(
        uint96 maxPost,
        uint96 extraCreator,
        uint256 dep,
        uint256 views,
        uint256 comps
    ) public {
        maxPost = uint96(bound(maxPost, 1, 1e12));
        extraCreator = uint96(bound(extraCreator, 0, 1e12));
        dep = bound(dep, 1, 1e13);
        views = bound(views, 0, MAXM);
        comps = bound(comps, 0, MAXM);
        uint96 maxCreator = maxPost + extraCreator;
        uint256 id = _mk(1_000_000, 5000, 0, maxPost, maxCreator, dep);

        uint256 expected = pc.previewPayout(id, COMMIT_A, views, comps);
        uint256 before = usdc.balanceOf(creator);
        bytes memory rep2 = _rep(id, POST_1, COMMIT_A, views, comps);
        vm.prank(forwarder);
        try pc.onReport("", rep2) {
            uint256 got = usdc.balanceOf(creator) - before;
            assertEq(got, expected);
            assertGt(got, 0);
            assertLe(got, maxPost);
            assertLe(got, maxCreator);
            assertLe(got, dep);
            PC.Campaign memory c = pc.getCampaign(id);
            assertEq(c.paid, got);
            assertEq(pc.creatorPaid(id, COMMIT_A), got);
            assertEq(pc.remaining(id), dep - got);
            assertEq(pc.totalEscrowed(), dep - got);
            assertEq(usdc.balanceOf(address(pc)), dep - got);
            assertTrue(pc.postRewarded(id, POST_1));
        } catch {
            // Only legal reason without a revert-by-design is zero payout.
            assertEq(expected, 0);
            assertFalse(pc.postRewarded(id, POST_1));
            assertEq(usdc.balanceOf(creator), before);
        }
    }

    function testFuzz_Close_RefundsExactRemainder(uint256 dep, uint256 views, uint256 comps, uint256 topUp) public {
        dep = bound(dep, 1, 1e13);
        topUp = bound(topUp, 0, 1e13);
        views = bound(views, 0, MAXM);
        comps = bound(comps, 0, MAXM);
        uint256 id = _mk(1_000_000, 5000, 0, 1e12, 1e12, dep);
        if (topUp != 0) {
            vm.prank(sponsor);
            pc.fund(id, topUp);
        }
        bytes memory rep3 = _rep(id, POST_1, COMMIT_A, views, comps);
        vm.prank(forwarder);
        try pc.onReport("", rep3) {} catch {}
        uint256 rem = pc.remaining(id);
        uint256 bBefore = usdc.balanceOf(brand);
        vm.prank(brand);
        pc.close(id);
        assertEq(usdc.balanceOf(brand) - bBefore, rem);
        assertEq(pc.remaining(id), 0);
        assertEq(pc.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(pc)), 0);
    }

    function testFuzz_Create_DateWindow(uint64 startsAt, uint64 endsAt) public {
        PC.CampaignInput memory i = _input();
        i.startsAt = startsAt;
        i.endsAt = endsAt;
        uint256 start = startsAt > block.timestamp ? startsAt : block.timestamp;
        bool valid = endsAt > block.timestamp && endsAt > start && uint256(endsAt) - start <= 365 days;
        vm.prank(brand);
        if (!valid) vm.expectRevert(PC.InvalidCampaignDates.selector);
        uint256 id = pc.createCampaign(i, 1e6);
        if (valid) assertEq(pc.getCampaign(id).startsAt, start);
    }

    // ───────────── signature fuzz ─────────────
    function _expectRejectedUnchanged(bytes memory rep, uint256 id, uint256 escrow) internal {
        vm.prank(forwarder);
        try pc.onReport("", rep) {
            fail("forged/tampered report accepted");
        } catch {}
        assertFalse(pc.postRewarded(id, POST_1));
        assertEq(pc.creatorPaid(id, COMMIT_A), 0);
        assertEq(pc.totalEscrowed(), escrow);
        assertEq(usdc.balanceOf(address(pc)), escrow);
        assertEq(usdc.balanceOf(creator), 0);
    }

    function testFuzz_Report_RandomKeySignatureRejected(uint256 pk, uint256 views, uint256 comps) public {
        pk = bound(pk, 1, SECP_N - 1);
        vm.assume(pk != SIGNER_PK);
        views = bound(views, 1, MAXM);
        comps = bound(comps, 0, MAXM);
        uint256 id = _createDefault(1e9);
        bytes memory body = _body(3, id, POST_1, COMMIT_A, creator, views, comps, block.timestamp + 1 days);
        bytes memory rep = _signWith(pk, body);
        vm.prank(forwarder);
        vm.expectRevert(PC.InvalidReportSignature.selector);
        pc.onReport("", rep);
        assertEq(pc.totalEscrowed(), 1e9);
    }

    function testFuzz_Report_AnySingleBitFlipRejected(uint256 pos, uint8 bit, uint256 views) public {
        views = bound(views, 1000, 100_000);
        uint256 id = _createDefault(1e9);
        bytes memory rep = _rep(id, POST_1, COMMIT_A, views, 0);
        assertEq(rep.length, 321);
        pos = bound(pos, 0, 320);
        rep[pos] = bytes1(uint8(rep[pos]) ^ (uint8(1) << (bit % 8)));
        _expectRejectedUnchanged(rep, id, 1e9);
    }

    function testFuzz_Report_BodyFieldTamperRejected(uint256 viewsSigned, uint256 viewsSent, address recipient) public {
        viewsSigned = bound(viewsSigned, 1, MAXM / 2);
        viewsSent = bound(viewsSent, 1, MAXM);
        vm.assume(recipient != address(0));
        vm.assume(viewsSent != viewsSigned || recipient != creator);
        uint256 id = _createDefault(1e9);
        bytes memory signedBody = _body(3, id, POST_1, COMMIT_A, creator, viewsSigned, 0, block.timestamp + 1 days);
        bytes memory sig = _sigOf(SIGNER_PK, _digest(signedBody));
        bytes memory sentBody = _body(3, id, POST_1, COMMIT_A, recipient, viewsSent, 0, block.timestamp + 1 days);
        _expectRejectedUnchanged(abi.encodePacked(sentBody, sig), id, 1e9);
    }
}
