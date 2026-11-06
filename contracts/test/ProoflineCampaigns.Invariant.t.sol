// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ProoflineCampaigns} from "../ProoflineCampaigns.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Bounded action surface driven by the invariant fuzzer.
contract ProoflineCampaignsHandler is Test {
    ProoflineCampaigns public pc;
    MockERC20 public usdc;
    address public forwarder;
    address public owner;

    address[3] public brands;
    address public sponsor;
    address public donor;
    address[3] public recipients;
    bytes32[4] public commitments;
    uint256 public constant MAX_CAMPAIGNS = 8;
    uint256 public constant POST_KEYS = 12;

    uint256 public campaignCount;
    uint256 public ghostPaidTotal; // sum of payouts observed via recipient balance deltas
    uint256 public ghostDonated;
    uint256 public successCount;
    mapping(uint256 campaignId => mapping(bytes32 postKey => uint256)) public postPayCount;

    uint256 internal signerPk;
    address public attacker;
    bool public forgedAccepted;
    uint256 public forgedAttempts;
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    constructor(ProoflineCampaigns pc_, MockERC20 usdc_, address forwarder_, address owner_, uint256 signerPk_) {
        pc = pc_;
        usdc = usdc_;
        forwarder = forwarder_;
        owner = owner_;
        signerPk = signerPk_;
        attacker = makeAddr("h_attacker");
        sponsor = makeAddr("h_sponsor");
        donor = makeAddr("h_donor");
        for (uint256 i; i < 3; ++i) {
            brands[i] = makeAddr(string.concat("h_brand", vm.toString(i)));
            recipients[i] = makeAddr(string.concat("h_recipient", vm.toString(i)));
            usdc.mint(brands[i], 1e15);
            vm.prank(brands[i]);
            usdc.approve(address(pc), type(uint256).max);
        }
        usdc.mint(sponsor, 1e15);
        vm.prank(sponsor);
        usdc.approve(address(pc), type(uint256).max);
        usdc.mint(donor, 1e15);
        for (uint256 i; i < 4; ++i) commitments[i] = keccak256(abi.encode("commit", i));
    }

    function _id(uint256 seed) internal view returns (uint256) {
        return bound(seed, 1, campaignCount);
    }

    function createCampaign(
        uint256 brandSeed,
        uint256 dep,
        uint256 maxPost,
        uint256 extraCreator,
        uint256 cpm,
        uint256 bps,
        uint256 minViews,
        uint256 startOffset,
        uint256 dur
    ) external {
        if (campaignCount >= MAX_CAMPAIGNS) return;
        ProoflineCampaigns.CampaignInput memory i;
        i.title = "t";
        i.requireProofCode = ((cpm ^ dur ^ brandSeed) & 1) == 0; // flag must never affect accounting
        i.cpmUsdc6 = uint96(bound(cpm, 1, 5_000_000));
        i.bonusBps = uint16(bound(bps, 0, 10_000));
        i.minViews = uint32(bound(minViews, 0, 2000));
        i.maxPerPost = uint96(bound(maxPost, 1, 3_000_000));
        i.maxPerCreator = uint96(uint256(i.maxPerPost) + bound(extraCreator, 0, 5_000_000));
        uint256 off = bound(startOffset, 0, 3 days);
        i.startsAt = off < 1 days ? 0 : uint64(block.timestamp + off);
        i.endsAt = uint64(block.timestamp + off + bound(dur, 1 hours, 60 days));
        address b = brands[bound(brandSeed, 0, 2)];
        vm.prank(b);
        try pc.createCampaign(i, bound(dep, 1, 10_000_000)) {
            campaignCount++;
        } catch {}
    }

    function fund(uint256 idSeed, uint256 amt) external {
        if (campaignCount == 0) return;
        vm.prank(sponsor);
        try pc.fund(_id(idSeed), bound(amt, 1, 10_000_000)) {} catch {}
    }

    function donate(uint256 amt) external {
        amt = bound(amt, 1, 1_000_000);
        vm.prank(donor);
        usdc.transfer(address(pc), amt);
        ghostDonated += amt;
    }

    function report(
        uint256 idSeed,
        uint256 postSeed,
        uint256 commitSeed,
        uint256 recSeed,
        uint256 views,
        uint256 comps
    ) external {
        if (campaignCount == 0) return;
        uint256 id = _id(idSeed);
        bytes32 postKey = bytes32(bound(postSeed, 1, POST_KEYS));
        address rec = recipients[bound(recSeed, 0, 2)];
        bytes memory body = abi.encode(
            uint8(3),
            id,
            postKey,
            commitments[bound(commitSeed, 0, 3)],
            rec,
            bound(views, 0, 5000),
            bound(comps, 0, 6000),
            block.timestamp + 1 days
        );
        bytes memory r = abi.encodePacked(body, _sigOf(signerPk, body));
        uint256 before = usdc.balanceOf(rec);
        vm.prank(forwarder);
        try pc.onReport("", r) {
            postPayCount[id][postKey]++;
            successCount++;
            ghostPaidTotal += usdc.balanceOf(rec) - before;
        } catch {}
    }

    function _sigOf(uint256 pk, bytes memory body) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encode(keccak256("ProoflineCampaigns.Report.v3"), block.chainid, address(pc), keccak256(body))
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(rr, s, v);
    }

    /// @dev Adversarial reports relayed through the (mock) forwarder; none may ever be accepted.
    function forgedReport(uint256 idSeed, uint256 mode, uint256 keySeed, uint256 postSeed, uint256 flipSeed)
        external
    {
        if (campaignCount == 0) return;
        bytes32 postKey = bytes32(bound(postSeed, 1, POST_KEYS));
        bytes memory body = abi.encode(
            uint8(3), _id(idSeed), postKey, commitments[0], attacker, uint256(5000), uint256(5000), block.timestamp + 1 days
        );
        bytes memory rep;
        mode = bound(mode, 0, 3);
        if (mode == 0) {
            uint256 pk = bound(keySeed, 1, SECP_N - 1);
            if (pk == signerPk) return;
            rep = abi.encodePacked(body, _sigOf(pk, body)); // wrong signer
        } else if (mode == 1) {
            // genuine signature, but over a different (smaller) body
            bytes memory other = abi.encode(
                uint8(3), _id(idSeed), postKey, commitments[0], attacker, uint256(1), uint256(0), block.timestamp + 1 days
            );
            rep = abi.encodePacked(body, _sigOf(signerPk, other));
        } else if (mode == 2) {
            rep = abi.encodePacked(body, new bytes(65)); // empty signature
        } else {
            rep = abi.encodePacked(body, _sigOf(signerPk, body)); // valid, then flip one bit
            uint256 pos = bound(flipSeed, 0, 320);
            rep[pos] = bytes1(uint8(rep[pos]) ^ (uint8(1) << (flipSeed % 8)));
        }
        forgedAttempts++;
        vm.prank(forwarder);
        try pc.onReport("", rep) {
            forgedAccepted = true;
        } catch {}
    }

    function setCampaignPaused(uint256 idSeed, bool p) external {
        if (campaignCount == 0) return;
        uint256 id = _id(idSeed);
        address b = pc.getCampaign(id).brand;
        vm.prank(b);
        try pc.setPaused(id, p) {} catch {}
    }

    function close(uint256 idSeed) external {
        if (campaignCount == 0) return;
        uint256 id = _id(idSeed);
        address b = pc.getCampaign(id).brand;
        vm.prank(b);
        try pc.close(id) {} catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 10 days));
    }

    function setGlobalPause(bool p) external {
        vm.prank(owner);
        if (p) {
            try pc.pause() {} catch {}
        } else {
            try pc.unpause() {} catch {}
        }
    }
}

contract ProoflineCampaignsInvariantTest is Test {
    ProoflineCampaigns internal pc;
    MockERC20 internal usdc;
    ProoflineCampaignsHandler internal h;

    function setUp() public {
        vm.warp(1_000_000);
        address forwarder = makeAddr("forwarder");
        address owner = makeAddr("owner");
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        pc = new ProoflineCampaigns(forwarder, address(usdc), owner, true);
        vm.prank(owner);
        pc.setReportSigner(vm.addr(SIGNER_PK)); // before any deposit
        h = new ProoflineCampaignsHandler(pc, usdc, forwarder, owner, SIGNER_PK);
        targetContract(address(h));
    }

    uint256 internal constant SIGNER_PK = 0xA11CE0FF1CE5167;

    /// @dev Sanity: forged reports are actually exercised and rejected (not vacuous).
    function test_HandlerForgedReportsRejected() public {
        h.createCampaign(0, 10_000_000, 3_000_000, 0, 1_000_000, 5000, 0, 0, 30 days);
        for (uint256 m; m < 4; ++m) h.forgedReport(1, m, m + 7, 1, m * 13 + 5);
        assertEq(h.forgedAttempts(), 4);
        assertFalse(h.forgedAccepted());
        assertEq(usdc.balanceOf(h.attacker()), 0);
        assertEq(pc.totalEscrowed(), 10_000_000);
    }

    /// @dev No report not signed over its exact body by the signer is ever paid.
    function invariant_ForgedReportsNeverAccepted() public view {
        assertFalse(h.forgedAccepted());
        assertEq(usdc.balanceOf(h.attacker()), 0);
    }

    /// @dev Sanity: the handler can reach the success path, so the invariants are not vacuous.
    function test_HandlerReachesPayoutPath() public {
        h.createCampaign(0, 10_000_000, 3_000_000, 0, 1_000_000, 5000, 0, 0, 30 days);
        assertEq(h.campaignCount(), 1);
        h.report(1, 1, 0, 0, 1000, 1000);
        assertEq(h.successCount(), 1);
        assertEq(h.ghostPaidTotal(), 1_500_000);
        assertEq(pc.totalEscrowed(), 8_500_000);
    }

    function _n() internal view returns (uint256) {
        return pc.nextCampaignId() - 1;
    }

    function invariant_BalanceCoversEscrow() public view {
        assertGe(usdc.balanceOf(address(pc)), pc.totalEscrowed());
    }

    function invariant_BalanceEqualsEscrowPlusDonations() public view {
        assertEq(usdc.balanceOf(address(pc)), pc.totalEscrowed() + h.ghostDonated());
    }

    function invariant_TotalEscrowedEqualsSumOfCampaignRemainders() public view {
        uint256 sum;
        for (uint256 id = 1; id <= _n(); ++id) {
            ProoflineCampaigns.Campaign memory c = pc.getCampaign(id);
            sum += uint256(c.deposited) - c.paid - c.withdrawn;
        }
        assertEq(pc.totalEscrowed(), sum);
    }

    function invariant_PaidNeverExceedsDeposited() public view {
        for (uint256 id = 1; id <= _n(); ++id) {
            ProoflineCampaigns.Campaign memory c = pc.getCampaign(id);
            assertLe(c.paid, c.deposited);
            assertLe(uint256(c.paid) + c.withdrawn, c.deposited);
            assertEq(pc.remaining(id), uint256(c.deposited) - c.paid - c.withdrawn);
        }
    }

    function invariant_CreatorPaidNeverExceedsMaxPerCreator() public view {
        for (uint256 id = 1; id <= _n(); ++id) {
            ProoflineCampaigns.Campaign memory c = pc.getCampaign(id);
            for (uint256 k; k < 4; ++k) {
                assertLe(pc.creatorPaid(id, h.commitments(k)), c.maxPerCreator);
            }
        }
    }

    /// @dev Each (campaignId, postKey) pair pays at most once; the same key may pay once per campaign.
    function invariant_CampaignPostPairPaysAtMostOnce() public view {
        uint256 rewarded;
        for (uint256 id = 1; id <= _n(); ++id) {
            for (uint256 k = 1; k <= h.POST_KEYS(); ++k) {
                bytes32 key = bytes32(k);
                assertLe(h.postPayCount(id, key), 1);
                assertEq(pc.postRewarded(id, key), h.postPayCount(id, key) == 1);
                if (pc.postRewarded(id, key)) rewarded++;
            }
        }
        assertEq(rewarded, h.successCount());
    }

    /// @dev Sanity: the same key can pay in two different campaigns through the handler.
    function test_HandlerSamePostKeyPaysInTwoCampaigns() public {
        h.createCampaign(0, 10_000_000, 3_000_000, 0, 1_000_000, 5000, 0, 0, 30 days);
        h.createCampaign(1, 10_000_000, 3_000_000, 0, 1_000_000, 5000, 0, 0, 30 days);
        h.report(1, 1, 0, 0, 1000, 1000);
        h.report(2, 1, 0, 0, 1000, 1000);
        h.report(2, 1, 0, 0, 1000, 1000); // repeat in campaign 2: rejected
        assertEq(h.successCount(), 2);
        assertEq(h.postPayCount(1, bytes32(uint256(1))), 1);
        assertEq(h.postPayCount(2, bytes32(uint256(1))), 1);
        assertTrue(pc.postRewarded(1, bytes32(uint256(1))));
        assertTrue(pc.postRewarded(2, bytes32(uint256(1))));
    }

    function invariant_PaidTotalsMatchRecipientsAndCampaigns() public view {
        uint256 sumPaid;
        uint256 sumCreator;
        for (uint256 id = 1; id <= _n(); ++id) {
            sumPaid += pc.getCampaign(id).paid;
            for (uint256 k; k < 4; ++k) sumCreator += pc.creatorPaid(id, h.commitments(k));
        }
        assertEq(sumPaid, h.ghostPaidTotal());
        assertEq(sumCreator, sumPaid);
    }

    function invariant_ClosedCampaignsHoldNothing() public view {
        for (uint256 id = 1; id <= _n(); ++id) {
            ProoflineCampaigns.Campaign memory c = pc.getCampaign(id);
            if (c.status == ProoflineCampaigns.Status.Closed) assertEq(pc.remaining(id), 0);
        }
    }
}
