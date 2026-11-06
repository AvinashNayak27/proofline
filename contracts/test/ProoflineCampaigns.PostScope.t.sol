// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

/// @dev A post is rewardable once PER CAMPAIGN: unique on (campaignId, postKey).
contract ProoflineCampaignsPostScopeTest is ProoflineCampaignsTestBase {
    uint256 internal constant DEP = 100_000_000;
    uint256 internal id1;
    uint256 internal id2;
    uint256 internal id3;

    function setUp() public override {
        super.setUp();
        id1 = _createDefault(DEP);
        id2 = _createDefault(DEP);
        id3 = _createDefault(DEP);
    }

    function sendExt(bytes memory report) external {
        _send(report);
    }

    function _expectSend(bytes memory revertData, bytes memory report) internal {
        vm.expectRevert(revertData);
        this.sendExt(report);
    }

    function _already(uint256 cid, bytes32 key) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(PC.PostAlreadyRewarded.selector, cid, key);
    }

    function test_SameKeyRewardedOncePerCampaignAcrossThreeCampaigns() public {
        uint256[3] memory ids = [id1, id2, id3];
        for (uint256 k; k < 3; ++k) {
            assertFalse(pc.postRewarded(ids[k], POST_1));
            vm.expectEmit(true, true, true, true, address(pc));
            emit PC.PostRewarded(ids[k], POST_1, COMMIT_A, creator, 1000, 0, 1_000_000);
            _pay(ids[k], POST_1, COMMIT_A, 1000, 0);
            assertTrue(pc.postRewarded(ids[k], POST_1));
            assertEq(pc.creatorPaid(ids[k], COMMIT_A), 1_000_000);
            assertEq(pc.getCampaign(ids[k]).paid, 1_000_000);
        }
        assertEq(usdc.balanceOf(creator), 3_000_000);
        assertEq(pc.totalEscrowed(), 3 * DEP - 3_000_000);
        // other keys untouched
        assertFalse(pc.postRewarded(id1, POST_2));
    }

    function test_RepeatInOneCampaignRevertsAndNothingPaidTwice() public {
        _pay(id1, POST_1, COMMIT_A, 1000, 0);
        _pay(id2, POST_1, COMMIT_A, 1000, 0);
        uint256 bal = usdc.balanceOf(creator);
        uint256 esc = pc.totalEscrowed();

        _expectSend(_already(id2, POST_1), _rep(id2, POST_1, COMMIT_A, 1000, 0));
        // different creator / recipient numbers do not bypass it
        _expectSend(_already(id2, POST_1), _rep(id2, POST_1, COMMIT_B, 5000, 5000));

        assertEq(usdc.balanceOf(creator), bal);
        assertEq(pc.totalEscrowed(), esc);
        assertEq(pc.creatorPaid(id1, COMMIT_A), 1_000_000);
        assertEq(pc.creatorPaid(id2, COMMIT_A), 1_000_000);
        assertEq(pc.creatorPaid(id2, COMMIT_B), 0);
        assertEq(pc.getCampaign(id1).paid, 1_000_000);
        assertEq(pc.getCampaign(id2).paid, 1_000_000);
        assertEq(pc.getCampaign(id3).paid, 0);
        // campaign 3 still free to reward the same key once
        _pay(id3, POST_1, COMMIT_A, 1000, 0);
        _expectSend(_already(id3, POST_1), _rep(id3, POST_1, COMMIT_A, 1000, 0));
    }

    function test_FailedReportDoesNotConsumePairOrOtherCampaigns() public {
        // NothingToPay revert leaves the pair unconsumed in this campaign and untouched elsewhere
        _expectSend(abi.encodeWithSelector(PC.NothingToPay.selector, id1), _rep(id1, POST_1, COMMIT_A, 0, 0));
        assertFalse(pc.postRewarded(id1, POST_1));
        assertFalse(pc.postRewarded(id2, POST_1));
        assertEq(_payAmount(id1, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_PostRewardedGetterIsPerPair() public {
        _pay(id2, POST_2, COMMIT_A, 1000, 0);
        assertTrue(pc.postRewarded(id2, POST_2));
        assertFalse(pc.postRewarded(id1, POST_2));
        assertFalse(pc.postRewarded(id3, POST_2));
        assertFalse(pc.postRewarded(id2, POST_1));
        assertFalse(pc.postRewarded(0, POST_2));
    }

    function test_CreatorCapStaysPerCampaignWhenKeysRepeat() public {
        PC.CampaignInput memory i = _input();
        i.maxPerPost = 1_500_000;
        i.maxPerCreator = 2_000_000;
        uint256 a = _create(i, DEP);
        uint256 b = _create(i, DEP);

        // POST_1 in a: full 1.5M; POST_2 in a: clamped to remaining allowance 0.5M
        assertEq(_payAmount(a, POST_1, COMMIT_A, 1000, 1000), 1_500_000);
        assertEq(_payAmount(a, POST_2, COMMIT_A, 1000, 1000), 500_000);
        // cap reached in a, even for a fresh key
        _expectSend(
            abi.encodeWithSelector(PC.CreatorCapReached.selector, a, COMMIT_A, 2_000_000, 2_000_000),
            _rep(a, POST_3, COMMIT_A, 1000, 1000)
        );
        // the very same keys in b pay with a full, independent allowance
        assertEq(_payAmount(b, POST_1, COMMIT_A, 1000, 1000), 1_500_000);
        assertEq(_payAmount(b, POST_2, COMMIT_A, 1000, 1000), 500_000);
        assertEq(pc.creatorPaid(a, COMMIT_A), 2_000_000);
        assertEq(pc.creatorPaid(b, COMMIT_A), 2_000_000);
        // b is now capped too; a repeated key in b reports the repeat error first
        _expectSend(_already(b, POST_1), _rep(b, POST_1, COMMIT_A, 1000, 1000));
        _expectSend(
            abi.encodeWithSelector(PC.CreatorCapReached.selector, b, COMMIT_A, 2_000_000, 2_000_000),
            _rep(b, POST_3, COMMIT_A, 1000, 1000)
        );
    }

    /// @dev Fuzz over (campaignId, postKey) pairs: each pair pays exactly once; other pairs unaffected.
    function testFuzz_EachCampaignPostPairPaysAtMostOnce(
        uint8 idSeedA,
        uint8 idSeedB,
        bytes32 keyA,
        bytes32 keyB
    ) public {
        vm.assume(keyA != bytes32(0) && keyB != bytes32(0));
        uint256[3] memory ids = [id1, id2, id3];
        uint256 cA = ids[idSeedA % 3];
        uint256 cB = ids[idSeedB % 3];
        bool samePair = (cA == cB && keyA == keyB);

        uint256 before = usdc.balanceOf(creator);
        _pay(cA, keyA, COMMIT_A, 1000, 0);
        assertTrue(pc.postRewarded(cA, keyA));
        assertEq(usdc.balanceOf(creator) - before, 1_000_000);

        if (samePair) {
            _expectSend(_already(cA, keyA), _rep(cB, keyB, COMMIT_B, 1000, 0));
            assertEq(usdc.balanceOf(creator) - before, 1_000_000);
            assertEq(pc.getCampaign(cA).paid, 1_000_000);
        } else {
            assertFalse(pc.postRewarded(cB, keyB));
            _pay(cB, keyB, COMMIT_B, 1000, 0);
            assertTrue(pc.postRewarded(cB, keyB));
            assertEq(usdc.balanceOf(creator) - before, 2_000_000);
            // repeats of either pair now revert
            _expectSend(_already(cA, keyA), _rep(cA, keyA, COMMIT_A, 1000, 0));
            _expectSend(_already(cB, keyB), _rep(cB, keyB, COMMIT_B, 1000, 0));
            assertEq(usdc.balanceOf(creator) - before, 2_000_000);
        }
        assertEq(pc.totalEscrowed(), 3 * DEP - (usdc.balanceOf(creator) - before));
    }
}
