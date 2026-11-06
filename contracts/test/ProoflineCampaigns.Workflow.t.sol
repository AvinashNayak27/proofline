// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

abstract contract WorkflowHelpers is ProoflineCampaignsTestBase {
    bytes32 internal constant WID = keccak256("workflowId");
    address internal constant WOWNER = address(0xBEEF);
    bytes internal metaStore;

    function _meta() internal view override returns (bytes memory) {
        return metaStore;
    }

    function _md(bytes32 wid, address wowner) internal pure returns (bytes memory) {
        return abi.encodePacked(wid, bytes10("workflow01"), wowner);
    }

    function sendExt(bytes memory report) external {
        _send(report);
    }

    function _expectSend(bytes memory revertData, bytes memory report) internal {
        vm.expectRevert(revertData);
        this.sendExt(report);
    }
}

// ═════════════ allowAnyWorkflow == false ═════════════
contract ProoflineCampaignsWorkflowStrictTest is WorkflowHelpers {
    function setUp() public override {
        super.setUp();
        pc = new PC(forwarder, address(usdc), owner, false);
        _setSigner(pc); // signer must be set before any deposit (and before lock)
        _fundActors(pc);
    }

    function _configureAndLock(bytes32 wid, address wowner) internal {
        vm.startPrank(owner);
        pc.setExpectedWorkflowId(wid);
        pc.setExpectedWorkflowOwner(wowner);
        pc.lockWorkflowIdentity();
        vm.stopPrank();
    }

    function test_Strict_ModeFlag() public view {
        assertFalse(pc.allowAnyWorkflow());
        assertFalse(pc.workflowIdentityLocked());
    }

    function test_Strict_CreateAndFundRevertUntilLocked() public {
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(PC.WorkflowIdentityNotLocked.selector);
        pc.createCampaign(i, 1e6);
        vm.prank(sponsor);
        vm.expectRevert(PC.WorkflowIdentityNotLocked.selector);
        pc.fund(1, 1e6);

        // configured but not yet locked: still reverts
        vm.prank(owner);
        pc.setExpectedWorkflowId(WID);
        vm.prank(brand);
        vm.expectRevert(PC.WorkflowIdentityNotLocked.selector);
        pc.createCampaign(i, 1e6);

        vm.prank(owner);
        pc.lockWorkflowIdentity();
        uint256 id = _create(i, 1e6);
        vm.prank(sponsor);
        pc.fund(id, 1e6);
        assertEq(pc.remaining(id), 2e6);
    }

    function test_Strict_LockRevertsWhenUnconfigured() public {
        vm.prank(owner);
        vm.expectRevert(PC.WorkflowIdentityNotConfigured.selector);
        pc.lockWorkflowIdentity();
        assertFalse(pc.workflowIdentityLocked());
    }

    function test_Strict_LockRevertsWhenConfiguredThenClearedToZero() public {
        vm.startPrank(owner);
        pc.setExpectedWorkflowId(WID);
        pc.setExpectedWorkflowId(bytes32(0));
        vm.expectRevert(PC.WorkflowIdentityNotConfigured.selector);
        pc.lockWorkflowIdentity();
        vm.stopPrank();
    }

    function test_Strict_ReportRevertsUnconfiguredBeforeLock() public {
        vm.expectRevert(PC.WorkflowIdentityNotConfigured.selector);
        this.sendExt(_rep(1, POST_1, COMMIT_A, 1000, 0));
    }

    function test_Strict_SettersEmitAndLockEmits() public {
        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.ExpectedWorkflowIdUpdated(bytes32(0), WID);
        vm.prank(owner);
        pc.setExpectedWorkflowId(WID);
        assertEq(pc.expectedWorkflowId(), WID);

        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.ExpectedWorkflowOwnerUpdated(address(0), WOWNER);
        vm.prank(owner);
        pc.setExpectedWorkflowOwner(WOWNER);
        assertEq(pc.expectedWorkflowOwner(), WOWNER);

        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.WorkflowIdentityLocked(WID, WOWNER);
        vm.prank(owner);
        pc.lockWorkflowIdentity();
        assertTrue(pc.workflowIdentityLocked());
    }

    function test_Strict_SettersAndLockRevertAfterLock() public {
        _configureAndLock(WID, WOWNER);
        vm.startPrank(owner);
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setExpectedWorkflowId(bytes32(uint256(1)));
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setExpectedWorkflowOwner(address(1));
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.lockWorkflowIdentity();
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setReportSigner(address(0xCAFE));
        vm.stopPrank();
        assertEq(pc.expectedWorkflowId(), WID);
        assertEq(pc.expectedWorkflowOwner(), WOWNER);
        assertEq(pc.reportSigner(), signer);
    }

    function test_Strict_SettersAndLockOnlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(err);
        pc.setReportSigner(stranger);
        vm.expectRevert(err);
        pc.setExpectedWorkflowId(WID);
        vm.expectRevert(err);
        pc.setExpectedWorkflowOwner(WOWNER);
        vm.expectRevert(err);
        pc.lockWorkflowIdentity();
        vm.stopPrank();
    }

    function test_Strict_ReportWithMatchingMetadataPays() public {
        _configureAndLock(WID, WOWNER);
        uint256 id = _createDefault(10e6);
        metaStore = _md(WID, WOWNER);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_Strict_TrailingMetadataIgnored() public {
        _configureAndLock(WID, WOWNER);
        uint256 id = _createDefault(10e6);
        metaStore = abi.encodePacked(_md(WID, WOWNER), hex"deadbeefcafe");
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_Strict_WrongWorkflowId() public {
        _configureAndLock(WID, WOWNER);
        uint256 id = _createDefault(10e6);
        metaStore = _md(keccak256("other"), WOWNER);
        _expectSend(_err(PC.InvalidWorkflowId.selector), _rep(id, POST_1, COMMIT_A, 1000, 0));
        assertFalse(pc.postRewarded(POST_1));
    }

    function test_Strict_WrongWorkflowOwner() public {
        _configureAndLock(WID, WOWNER);
        uint256 id = _createDefault(10e6);
        metaStore = _md(WID, address(0xBAD));
        _expectSend(_err(PC.InvalidWorkflowOwner.selector), _rep(id, POST_1, COMMIT_A, 1000, 0));
    }

    function test_Strict_ShortMetadata() public {
        _configureAndLock(WID, WOWNER);
        uint256 id = _createDefault(10e6);
        bytes memory full = _md(WID, WOWNER);
        assertEq(full.length, 62);
        metaStore = new bytes(61);
        for (uint256 k; k < 61; ++k) metaStore[k] = full[k];
        _expectSend(abi.encodeWithSelector(PC.InvalidMetadataLength.selector, 61), _rep(id, POST_1, COMMIT_A, 1000, 0));
        metaStore = "";
        _expectSend(abi.encodeWithSelector(PC.InvalidMetadataLength.selector, 0), _rep(id, POST_1, COMMIT_A, 1000, 0));
    }

    function test_Strict_OnlyIdConfigured_OwnerIgnored() public {
        vm.startPrank(owner);
        pc.setExpectedWorkflowId(WID);
        pc.lockWorkflowIdentity();
        vm.stopPrank();
        uint256 id = _createDefault(10e6);
        metaStore = _md(WID, address(0x1234)); // any owner
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
        metaStore = _md(bytes32(uint256(5)), address(0x1234));
        _expectSend(_err(PC.InvalidWorkflowId.selector), _rep(id, POST_2, COMMIT_A, 1000, 0));
        metaStore = new bytes(40); // too short still reverts
        _expectSend(abi.encodeWithSelector(PC.InvalidMetadataLength.selector, 40), _rep(id, POST_2, COMMIT_A, 1000, 0));
    }

    function test_Strict_OnlyOwnerConfigured_IdIgnored() public {
        vm.startPrank(owner);
        pc.setExpectedWorkflowOwner(WOWNER);
        pc.lockWorkflowIdentity();
        vm.stopPrank();
        uint256 id = _createDefault(10e6);
        metaStore = _md(keccak256("anything"), WOWNER);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
        metaStore = _md(keccak256("anything"), address(0xBAD));
        _expectSend(_err(PC.InvalidWorkflowOwner.selector), _rep(id, POST_2, COMMIT_A, 1000, 0));
    }

    function test_Strict_ForwarderStillRequired() public {
        _configureAndLock(WID, WOWNER);
        uint256 id = _createDefault(10e6);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PC.UnauthorizedForwarder.selector, stranger));
        pc.onReport(_md(WID, WOWNER), _rep(id, POST_1, COMMIT_A, 1000, 0));
    }

    function test_Strict_WorkflowCheckPrecedesReportChecks() public {
        _configureAndLock(WID, WOWNER);
        uint256 id = _createDefault(10e6);
        metaStore = _md(keccak256("other"), WOWNER);
        // malformed report AND wrong workflow -> workflow error first
        _expectSend(_err(PC.InvalidWorkflowId.selector), abi.encodePacked(_rep(id, POST_1, COMMIT_A, 1000, 0), bytes1(0)));
    }
}

// ═════════════ allowAnyWorkflow == true (simulation mode) ═════════════
contract ProoflineCampaignsWorkflowAnyTest is WorkflowHelpers {
    function test_Any_DepositsAllowedUnlocked() public {
        assertTrue(pc.allowAnyWorkflow());
        assertFalse(pc.workflowIdentityLocked());
        uint256 id = _createDefault(1e6);
        vm.prank(sponsor);
        pc.fund(id, 1e6);
        assertEq(pc.remaining(id), 2e6);
    }

    function test_Any_EmptyMetadataAcceptedWhenUnconfigured() public {
        uint256 id = _createDefault(10e6);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_Any_LockEmptyIdentityAllowed() public {
        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.WorkflowIdentityLocked(bytes32(0), address(0));
        vm.prank(owner);
        pc.lockWorkflowIdentity();
        assertTrue(pc.workflowIdentityLocked());
        vm.startPrank(owner);
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.lockWorkflowIdentity();
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setExpectedWorkflowId(WID);
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setExpectedWorkflowOwner(WOWNER);
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setReportSigner(address(0xCAFE));
        vm.stopPrank();
        assertEq(pc.reportSigner(), signer);
        // deposits still fine after locking
        _createDefault(1e6);
    }

    function test_Any_ConfiguredIdentityStillEnforced() public {
        uint256 id = _createDefault(10e6);
        vm.prank(owner);
        pc.setExpectedWorkflowId(WID);
        vm.prank(owner);
        pc.setExpectedWorkflowOwner(WOWNER);

        // deposits still allowed (unlocked)
        vm.prank(sponsor);
        pc.fund(id, 1);

        metaStore = "";
        _expectSend(abi.encodeWithSelector(PC.InvalidMetadataLength.selector, 0), _rep(id, POST_1, COMMIT_A, 1000, 0));
        metaStore = _md(keccak256("x"), WOWNER);
        _expectSend(_err(PC.InvalidWorkflowId.selector), _rep(id, POST_1, COMMIT_A, 1000, 0));
        metaStore = _md(WID, address(0xBAD));
        _expectSend(_err(PC.InvalidWorkflowOwner.selector), _rep(id, POST_1, COMMIT_A, 1000, 0));
        metaStore = _md(WID, WOWNER);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_Any_SettersOnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pc.setExpectedWorkflowId(WID);
    }

    function test_Any_LockedConfiguredIdentityCannotBeChanged() public {
        vm.startPrank(owner);
        pc.setExpectedWorkflowId(WID);
        pc.lockWorkflowIdentity();
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setExpectedWorkflowId(bytes32(0));
        vm.stopPrank();
        assertEq(pc.expectedWorkflowId(), WID);
    }
}
