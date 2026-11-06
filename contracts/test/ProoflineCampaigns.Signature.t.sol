// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

/// @dev onReport signature verification (report = 256-byte body ++ 65-byte (r,s,v) signature).
contract ProoflineCampaignsSignatureTest is ProoflineCampaignsTestBase {
    uint256 internal id;
    uint256 internal constant DEP = 10_000_000;

    function setUp() public override {
        super.setUp();
        id = _createDefault(DEP);
    }

    function sendExt(bytes memory report) external {
        _send(report);
    }

    function _expectSend(bytes memory revertData, bytes memory report) internal {
        vm.expectRevert(revertData);
        this.sendExt(report);
    }

    function _bad() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(PC.InvalidReportSignature.selector);
    }

    function _b(bytes32 postKey, address rec, uint256 views) internal view returns (bytes memory) {
        return _body(3, id, postKey, COMMIT_A, rec, views, 0, block.timestamp + 1 days);
    }

    function _assertNothingPaid() internal view {
        assertEq(usdc.balanceOf(creator), 0);
        assertEq(usdc.balanceOf(address(pc)), DEP);
        assertEq(pc.totalEscrowed(), DEP);
        assertEq(pc.remaining(id), DEP);
        assertFalse(pc.postRewarded(POST_1));
        assertEq(pc.creatorPaid(id, COMMIT_A), 0);
    }

    // ───────────── accepted ─────────────
    function test_Sig_ValidSignatureAccepted() public {
        bytes memory rep = _signed(_b(POST_1, creator, 1000));
        assertEq(rep.length, 321);
        vm.expectEmit(true, true, true, true, address(pc));
        emit PC.PostRewarded(id, POST_1, COMMIT_A, creator, 1000, 0, 1_000_000);
        _send(rep);
        assertEq(usdc.balanceOf(creator), 1_000_000);
        assertTrue(pc.postRewarded(POST_1));
    }

    function test_Sig_ManySignaturesAllAccepted() public {
        // varies r/s/v (both recovery parities appear across digests)
        for (uint256 k = 1; k <= 8; ++k) {
            _send(_signed(_body(3, id, bytes32(k), bytes32(k), creator, 1000, 0, block.timestamp + k)));
        }
        assertEq(usdc.balanceOf(creator), 8_000_000);
    }

    function test_Sig_RecipientIsBoundBySignature() public {
        address other = makeAddr("otherWallet");
        _send(_signed(_b(POST_1, other, 1000)));
        assertEq(usdc.balanceOf(other), 1_000_000);
        assertEq(usdc.balanceOf(creator), 0);
    }

    // ───────────── rejected: wrong signer / tampered body ─────────────
    function test_Sig_WrongSignerRejected() public {
        _expectSend(_bad(), _signWith(OTHER_PK, _b(POST_1, creator, 1000)));
        _assertNothingPaid();
    }

    function test_Sig_AttackerSelfSignedForOwnRecipientRejected() public {
        uint256 attackerPk = 0xA77AC4E2;
        bytes memory body = _body(3, id, POST_1, COMMIT_A, stranger, 1_000_000_000, 1_000_000_000, block.timestamp);
        _expectSend(_bad(), _signWith(attackerPk, body));
        assertEq(usdc.balanceOf(stranger), 0);
        _assertNothingPaid();
    }

    function test_Sig_TamperedViewsRejected() public {
        bytes memory sig = _sigOf(SIGNER_PK, _digest(_b(POST_1, creator, 1000)));
        _expectSend(_bad(), abi.encodePacked(_b(POST_1, creator, 2000), sig));
        _assertNothingPaid();
    }

    function test_Sig_TamperedRecipientRejected() public {
        bytes memory sig = _sigOf(SIGNER_PK, _digest(_b(POST_1, creator, 1000)));
        _expectSend(_bad(), abi.encodePacked(_b(POST_1, stranger, 1000), sig));
        assertEq(usdc.balanceOf(stranger), 0);
        _assertNothingPaid();
    }

    function test_Sig_TamperedPostKeyCommitmentCampaignExpiryCompletionsRejected() public {
        uint256 exp = block.timestamp + 1 days;
        bytes memory sig = _sigOf(SIGNER_PK, _digest(_body(3, id, POST_1, COMMIT_A, creator, 1000, 0, exp)));
        uint256 id2 = _createDefault(DEP);
        _expectSend(_bad(), abi.encodePacked(_body(3, id, POST_2, COMMIT_A, creator, 1000, 0, exp), sig));
        _expectSend(_bad(), abi.encodePacked(_body(3, id, POST_1, COMMIT_B, creator, 1000, 0, exp), sig));
        _expectSend(_bad(), abi.encodePacked(_body(3, id2, POST_1, COMMIT_A, creator, 1000, 0, exp), sig));
        _expectSend(_bad(), abi.encodePacked(_body(3, id, POST_1, COMMIT_A, creator, 1000, 1000, exp), sig));
        _expectSend(_bad(), abi.encodePacked(_body(3, id, POST_1, COMMIT_A, creator, 1000, 0, exp + 1), sig));
        assertEq(usdc.balanceOf(creator), 0);
        assertEq(pc.totalEscrowed(), 2 * DEP);
        assertFalse(pc.postRewarded(POST_1));
        assertFalse(pc.postRewarded(POST_2));
        assertEq(pc.creatorPaid(id, COMMIT_A), 0);
        assertEq(pc.creatorPaid(id2, COMMIT_A), 0);
        // the untampered pair is still valid (nothing was consumed)
        _send(abi.encodePacked(_body(3, id, POST_1, COMMIT_A, creator, 1000, 0, exp), sig));
        assertEq(usdc.balanceOf(creator), 1_000_000);
    }

    // ───────────── rejected: chain / contract binding ─────────────
    function test_Sig_WrongChainIdRejected() public {
        bytes memory body = _b(POST_1, creator, 1000);
        bytes memory sig = _sigOf(SIGNER_PK, _digestFor(address(pc), block.chainid + 1, body));
        _expectSend(_bad(), abi.encodePacked(body, sig));
        _assertNothingPaid();
    }

    function test_Sig_BoundToChain_ReplayAcrossChainIdRejected() public {
        bytes memory rep = _signed(_b(POST_1, creator, 1000)); // signed for the current chain id
        vm.chainId(block.chainid + 1000);
        _expectSend(_bad(), rep);
        // a signature made for the new chain id is accepted there
        _send(_signed(_b(POST_1, creator, 1000)));
        assertEq(usdc.balanceOf(creator), 1_000_000);
    }

    function test_Sig_WrongContractRejected() public {
        bytes memory body = _b(POST_1, creator, 1000);
        bytes memory sig = _sigOf(SIGNER_PK, _digestFor(address(0xdead), block.chainid, body));
        _expectSend(_bad(), abi.encodePacked(body, sig));
        _assertNothingPaid();
    }

    function test_Sig_ReplayAcrossDeploymentsRejected() public {
        PC pc2 = new PC(forwarder, address(usdc), owner, true);
        _setSigner(pc2); // same signer key, same forwarder
        _fundActors(pc2);
        vm.prank(brand);
        assertEq(pc2.createCampaign(_input(), DEP), id); // identical campaign id
        // report signed for `pc`, replayed verbatim on pc2
        bytes memory rep = _signed(_b(POST_1, creator, 1000));
        vm.prank(forwarder);
        vm.expectRevert(_bad());
        pc2.onReport("", rep);
        assertEq(usdc.balanceOf(address(pc2)), DEP);
        assertEq(pc2.totalEscrowed(), DEP);
        // while still valid on the intended contract
        _send(rep);
        assertEq(usdc.balanceOf(creator), 1_000_000);
    }

    function test_ReportDigest_DependsOnChainAndContract() public {
        bytes memory body = _b(POST_1, creator, 1000);
        bytes32 d = pc.reportDigest(body);
        assertEq(d, _digest(body));
        PC pc2 = new PC(forwarder, address(usdc), owner, true);
        assertTrue(pc2.reportDigest(body) != d);
        vm.chainId(block.chainid + 1);
        assertTrue(pc.reportDigest(body) != d);
    }

    function test_ReportDigest_RevertsUnlessExactly256Bytes() public {
        vm.expectRevert(abi.encodeWithSelector(PC.InvalidReportLength.selector, 255));
        pc.reportDigest(new bytes(255));
        vm.expectRevert(abi.encodeWithSelector(PC.InvalidReportLength.selector, 257));
        pc.reportDigest(new bytes(257));
        vm.expectRevert(abi.encodeWithSelector(PC.InvalidReportLength.selector, 0));
        pc.reportDigest("");
        vm.expectRevert(abi.encodeWithSelector(PC.InvalidReportLength.selector, 321));
        pc.reportDigest(_signed(_b(POST_1, creator, 1000)));
    }

    // ───────────── rejected: malformed / malleable signatures ─────────────
    function test_Sig_MalleableHighSRejected() public {
        bytes memory body = _b(POST_1, creator, 1000);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, _digest(body));
        // (r, n-s, flipped v) recovers the same signer but is the malleated twin
        bytes memory twin = abi.encodePacked(body, r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        _expectSend(_bad(), twin);
        _assertNothingPaid();
        _send(abi.encodePacked(body, r, s, v)); // the canonical one works
        assertEq(usdc.balanceOf(creator), 1_000_000);
    }

    function test_Sig_InvalidVRejected() public {
        bytes memory body = _b(POST_1, creator, 1000);
        (, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, _digest(body));
        uint8[5] memory vs = [0, 1, 26, 29, 255];
        for (uint256 k; k < vs.length; ++k) {
            _expectSend(_bad(), abi.encodePacked(body, r, s, vs[k]));
        }
        _assertNothingPaid();
    }

    function test_Sig_ZeroAndGarbageSignatureRejected() public {
        bytes memory body = _b(POST_1, creator, 1000);
        _expectSend(_bad(), abi.encodePacked(body, new bytes(65)));
        _expectSend(_bad(), abi.encodePacked(body, bytes32(uint256(1)), bytes32(uint256(1)), uint8(27)));
        _expectSend(_bad(), abi.encodePacked(body, bytes32(type(uint256).max), bytes32(type(uint256).max), uint8(27)));
        _expectSend(_bad(), abi.encodePacked(body, new bytes(32), bytes32(uint256(5)), uint8(28)));
        _assertNothingPaid();
    }

    function test_Sig_WrongLengthSignatureRejectedByLength() public {
        bytes memory body = _b(POST_1, creator, 1000);
        bytes memory sig = _sigOf(SIGNER_PK, _digest(body));
        assertEq(sig.length, 65);
        // 64-byte EIP-2098 compact encoding
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
        }
        bytes32 vs = bytes32((uint256(uint8(sig[64]) - 27) << 255) | uint256(s));
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 320), abi.encodePacked(body, r, vs));
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 322), abi.encodePacked(body, sig, bytes1(0)));
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 256), body);
        _expectSend(abi.encodeWithSelector(PC.InvalidReportLength.selector, 288), abi.encodePacked(body, bytes32(0)));
        _assertNothingPaid();
    }

    function test_Sig_EthSignedMessagePrefixedDigestRejected() public {
        bytes memory body = _b(POST_1, creator, 1000);
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _digest(body)));
        _expectSend(_bad(), abi.encodePacked(body, _sigOf(SIGNER_PK, prefixed)));
    }

    function test_Sig_SignatureOverBareBodyHashRejected() public {
        bytes memory body = _b(POST_1, creator, 1000);
        _expectSend(_bad(), abi.encodePacked(body, _sigOf(SIGNER_PK, keccak256(body))));
        _assertNothingPaid();
    }

    // ───────────── ordering / replay ─────────────
    function test_Sig_ReplayAfterPaymentRevertsAlreadyRewarded() public {
        bytes memory rep = _signed(_b(POST_1, creator, 1000));
        _send(rep);
        _expectSend(abi.encodeWithSelector(PC.PostAlreadyRewarded.selector, POST_1), rep);
        assertEq(usdc.balanceOf(creator), 1_000_000);
    }

    function test_Sig_CheckedBeforeCampaignAccess() public {
        bytes memory body = _body(3, 99, POST_1, COMMIT_A, creator, 1000, 0, block.timestamp);
        _expectSend(_bad(), _signWith(OTHER_PK, body));
        _expectSend(abi.encodeWithSelector(PC.CampaignNotFound.selector, 99), _signed(body));
        // closed campaign: forged report gets the signature error, not CampaignNotActive
        vm.prank(brand);
        pc.close(id);
        _expectSend(_bad(), _signWith(OTHER_PK, _b(POST_1, creator, 1000)));
        _expectSend(abi.encodeWithSelector(PC.CampaignNotActive.selector, id), _signed(_b(POST_1, creator, 1000)));
    }

    function test_Sig_SchemaVersionCheckedBeforeSignature() public {
        bytes memory body = _body(2, id, POST_1, COMMIT_A, creator, 1000, 0, block.timestamp);
        _expectSend(abi.encodeWithSelector(PC.UnsupportedSchemaVersion.selector, 2), _signWith(OTHER_PK, body));
    }

    function test_Sig_OnlyForwarderEvenWithValidSignature() public {
        bytes memory rep = _signed(_b(POST_1, creator, 1000));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PC.UnauthorizedForwarder.selector, stranger));
        pc.onReport("", rep);
        _assertNothingPaid();
    }

    function test_Sig_ZeroSignerBlocksEveryReport() public {
        bytes memory good = _signed(_b(POST_1, creator, 1000));
        vm.prank(owner);
        pc.setReportSigner(address(0));
        _expectSend(abi.encodeWithSelector(PC.ReportSignerNotConfigured.selector), good);
        // an unrecoverable signature must never be treated as "signed by address(0)"
        _expectSend(
            abi.encodeWithSelector(PC.ReportSignerNotConfigured.selector),
            abi.encodePacked(_b(POST_1, creator, 1000), new bytes(65))
        );
        _assertNothingPaid();
        _setSigner(pc);
        _send(good);
        assertEq(usdc.balanceOf(creator), 1_000_000);
    }

    function test_Sig_SignerRotationInvalidatesOldSignatures() public {
        bytes memory oldSigned = _signed(_b(POST_1, creator, 1000));
        vm.prank(owner);
        pc.setReportSigner(vm.addr(OTHER_PK));
        _expectSend(_bad(), oldSigned);
        _send(_signWith(OTHER_PK, _b(POST_1, creator, 1000)));
        assertEq(usdc.balanceOf(creator), 1_000_000);
    }

    // ───────────── forged reports through the mock forwarder cannot drain escrow ─────────────
    function test_Forged_MockForwarderCannotDrainEscrow() public {
        uint256 attackerPk = 0xA77AC4E2;
        address attacker = makeAddr("attacker");
        uint256 bal = usdc.balanceOf(address(pc));
        bytes memory greedy = _body(3, id, POST_1, COMMIT_A, attacker, 1_000_000_000, 1_000_000_000, block.timestamp);
        bytes[7] memory forged = [
            greedy, // unsigned body: wrong length
            abi.encodePacked(greedy, new bytes(65)), // zero signature
            abi.encodePacked(greedy, new bytes(65 + 1)), // 322 bytes
            _signWith(attackerPk, greedy), // self-signed
            abi.encodePacked(greedy, _sigOf(SIGNER_PK, keccak256("something else"))), // signer sig of other data
            abi.encodePacked(greedy, _sigOf(SIGNER_PK, _digest(_b(POST_1, attacker, 1)))), // signer sig, smaller body
            abi.encodePacked(greedy, bytes32(type(uint256).max), bytes32(type(uint256).max), uint8(27))
        ];
        for (uint256 k; k < forged.length; ++k) {
            vm.prank(forwarder); // the (mock) forwarder relays anything an attacker supplies
            try pc.onReport("", forged[k]) {
                fail("forged report accepted");
            } catch {}
        }
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(address(pc)), bal);
        assertEq(pc.totalEscrowed(), bal);
        assertEq(pc.remaining(id), DEP);
        assertFalse(pc.postRewarded(POST_1));
        // the brand can still recover everything
        uint256 b0 = usdc.balanceOf(brand);
        vm.prank(brand);
        pc.close(id);
        assertEq(usdc.balanceOf(brand) - b0, DEP);
    }
}
