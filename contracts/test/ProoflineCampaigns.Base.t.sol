// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ProoflineCampaigns} from "../ProoflineCampaigns.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared fixtures/helpers. No test functions here.
abstract contract ProoflineCampaignsTestBase is Test {
    ProoflineCampaigns internal pc;
    MockERC20 internal usdc;

    address internal forwarder = makeAddr("forwarder");
    address internal owner = makeAddr("owner");
    address internal brand = makeAddr("brand");
    address internal brand2 = makeAddr("brand2");
    address internal sponsor = makeAddr("sponsor");
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant COMMIT_A = keccak256("creatorA");
    bytes32 internal constant COMMIT_B = keccak256("creatorB");
    bytes32 internal constant POST_1 = keccak256("post1");
    bytes32 internal constant POST_2 = keccak256("post2");
    bytes32 internal constant POST_3 = keccak256("post3");

    uint256 internal constant T0 = 1_000_000;
    uint256 internal constant BIG = 1_000_000_000_000e6;

    /// @dev Dedicated report-signing key; its address is configured as `reportSigner` in setUp.
    uint256 internal constant SIGNER_PK = 0xA11CE0FF1CE5167;
    uint256 internal constant OTHER_PK = 0xBADBADBAD0001;
    /// @dev secp256k1 group order.
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    bytes32 internal constant REPORT_TYPEHASH = keccak256("ProoflineCampaigns.Report.v3");
    address internal signer;

    function setUp() public virtual {
        vm.warp(T0);
        signer = vm.addr(SIGNER_PK);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        pc = new ProoflineCampaigns(forwarder, address(usdc), owner, true);
        _setSigner(pc); // must precede any deposit
        _fundActors(pc);
    }

    function _setSigner(ProoflineCampaigns target) internal {
        vm.prank(owner);
        target.setReportSigner(signer);
    }

    /// @dev Local re-implementation of the contract's digest (no external call, prank-safe).
    function _digestFor(address target, uint256 chainId, bytes memory body) internal pure returns (bytes32) {
        return keccak256(abi.encode(REPORT_TYPEHASH, chainId, target, keccak256(body)));
    }

    function _digest(bytes memory body) internal view returns (bytes32) {
        return _digestFor(address(pc), block.chainid, body);
    }

    /// @dev 65-byte (r,s,v) signature over `digest` by `pk`.
    function _sigOf(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev body ++ signature by `pk` over the current contract/chain digest.
    function _signWith(uint256 pk, bytes memory body) internal view returns (bytes memory) {
        return abi.encodePacked(body, _sigOf(pk, _digest(body)));
    }

    function _signed(bytes memory body) internal view returns (bytes memory) {
        return _signWith(SIGNER_PK, body);
    }

    function _fundActors(ProoflineCampaigns target) internal {
        address[3] memory who = [brand, brand2, sponsor];
        for (uint256 i; i < who.length; ++i) {
            usdc.mint(who[i], BIG);
            vm.prank(who[i]);
            usdc.approve(address(target), type(uint256).max);
        }
    }

    function _input() internal view returns (ProoflineCampaigns.CampaignInput memory i) {
        i.brandName = "Brand";
        i.title = "Title";
        i.brief = "Brief";
        i.requiredTag = "#tag";
        i.link = "https://example.com";
        i.startsAt = 0;
        i.endsAt = uint64(block.timestamp + 30 days);
        i.minViews = 0;
        i.bonusBps = 5000;
        i.cpmUsdc6 = 1_000_000;
        i.maxPerPost = 1_000_000_000_000;
        i.maxPerCreator = 1_000_000_000_000;
    }

    function _create(ProoflineCampaigns.CampaignInput memory i, uint256 dep) internal returns (uint256 id) {
        vm.prank(brand);
        id = pc.createCampaign(i, dep);
    }

    function _createDefault(uint256 dep) internal returns (uint256) {
        return _create(_input(), dep);
    }

    /// @dev Raw 256-byte ABI-encoded RewardReport body (unsigned).
    function _body(
        uint8 version,
        uint256 id,
        bytes32 postKey,
        bytes32 commitment,
        address recipient,
        uint256 views,
        uint256 comps,
        uint256 expiry
    ) internal pure returns (bytes memory) {
        return abi.encode(version, id, postKey, commitment, recipient, views, comps, expiry);
    }

    /// @dev 321-byte report: body signed by the configured report signer.
    function _reportBytes(
        uint8 version,
        uint256 id,
        bytes32 postKey,
        bytes32 commitment,
        address recipient,
        uint256 views,
        uint256 comps,
        uint256 expiry
    ) internal view returns (bytes memory) {
        return _signed(_body(version, id, postKey, commitment, recipient, views, comps, expiry));
    }

    function _rep(uint256 id, bytes32 postKey, bytes32 commitment, uint256 views, uint256 comps)
        internal
        view
        returns (bytes memory)
    {
        return _reportBytes(3, id, postKey, commitment, creator, views, comps, block.timestamp + 1 days);
    }

    function _meta() internal virtual returns (bytes memory) {
        return "";
    }

    function _send(bytes memory report) internal {
        bytes memory m = _meta();
        vm.prank(forwarder);
        pc.onReport(m, report);
    }

    function _pay(uint256 id, bytes32 postKey, bytes32 commitment, uint256 views, uint256 comps) internal {
        _send(_rep(id, postKey, commitment, views, comps));
    }

    /// @dev Pays and returns the amount received by `creator`.
    function _payAmount(uint256 id, bytes32 postKey, bytes32 commitment, uint256 views, uint256 comps)
        internal
        returns (uint256)
    {
        uint256 before = usdc.balanceOf(creator);
        _pay(id, postKey, commitment, views, comps);
        return usdc.balanceOf(creator) - before;
    }

    function _err(bytes4 sel) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(sel);
    }
}
