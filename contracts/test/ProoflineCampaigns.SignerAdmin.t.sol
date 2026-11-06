// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProoflineCampaignsTestBase} from "./ProoflineCampaigns.Base.t.sol";
import {ProoflineCampaigns as PC} from "../ProoflineCampaigns.sol";

abstract contract SignerAdminHelpers is ProoflineCampaignsTestBase {
    bytes32 internal constant WID = keccak256("workflowId");
    address internal constant WOWNER = address(0xBEEF);
    bytes internal metaStore;

    function _meta() internal view override returns (bytes memory) {
        return metaStore;
    }

    function sendExt(bytes memory report) external {
        _send(report);
    }

    function _expectSend(bytes memory revertData, bytes memory report) internal {
        vm.expectRevert(revertData);
        this.sendExt(report);
    }

    function _noSigner() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(PC.ReportSignerNotConfigured.selector);
    }
}

// ═════════════ allowAnyWorkflow == true ═════════════
contract ProoflineCampaignsSignerAdminAnyTest is SignerAdminHelpers {
    function test_SetSigner_OwnerUpdatesAndEmits() public {
        address next = vm.addr(OTHER_PK);
        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.ReportSignerUpdated(signer, next);
        vm.prank(owner);
        pc.setReportSigner(next);
        assertEq(pc.reportSigner(), next);
    }

    function test_SetSigner_CanBeSetRepeatedlyBeforeLock() public {
        vm.startPrank(owner);
        pc.setReportSigner(address(0x1));
        pc.setReportSigner(address(0x2));
        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.ReportSignerUpdated(address(0x2), address(0));
        pc.setReportSigner(address(0));
        vm.stopPrank();
        assertEq(pc.reportSigner(), address(0));
    }

    function test_SetSigner_OnlyOwner() public {
        address[4] memory who = [stranger, brand, forwarder, sponsor];
        for (uint256 k; k < who.length; ++k) {
            vm.prank(who[k]);
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who[k]));
            pc.setReportSigner(who[k]);
        }
        assertEq(pc.reportSigner(), signer);
    }

    function test_SetSigner_TwoStepNewOwnerTakesOverSetter() public {
        vm.prank(owner);
        pc.transferOwnership(stranger);
        // pending owner has no rights yet
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pc.setReportSigner(stranger);
        vm.prank(stranger);
        pc.acceptOwnership();
        vm.prank(stranger);
        pc.setReportSigner(address(0x77));
        assertEq(pc.reportSigner(), address(0x77));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        pc.setReportSigner(signer);
    }

    function test_SetSigner_RevertsAfterLockAndSignerStaysFrozen() public {
        vm.startPrank(owner);
        pc.lockWorkflowIdentity();
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setReportSigner(address(0x99));
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setReportSigner(address(0)); // cannot disable either
        vm.stopPrank();
        assertEq(pc.reportSigner(), signer);
        // old signer still authenticates reports after the lock; others do not
        uint256 id = _createDefault(10e6);
        _expectSend(abi.encodeWithSelector(PC.InvalidReportSignature.selector), _signWith(OTHER_PK, _body(3, id, POST_1, COMMIT_A, creator, 1000, 0, block.timestamp)));
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
    }

    function test_SetSigner_WrongCallerCheckedBeforeLockState() public {
        vm.prank(owner);
        pc.lockWorkflowIdentity();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pc.setReportSigner(stranger);
    }

    function test_Lock_EmitsAndFreezesSignerInSimulationMode() public {
        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.WorkflowIdentityLocked(bytes32(0), address(0));
        vm.prank(owner);
        pc.lockWorkflowIdentity();
        assertTrue(pc.workflowIdentityLocked());
        assertEq(pc.reportSigner(), signer);
    }

    // ───────────── ReportSignerNotConfigured in simulation mode ─────────────
    function test_ZeroSigner_LockReverts() public {
        vm.startPrank(owner);
        pc.setReportSigner(address(0));
        vm.expectRevert(_noSigner());
        pc.lockWorkflowIdentity();
        vm.stopPrank();
        assertFalse(pc.workflowIdentityLocked());
        // configuring one makes lock succeed
        vm.startPrank(owner);
        pc.setReportSigner(signer);
        pc.lockWorkflowIdentity();
        vm.stopPrank();
        assertTrue(pc.workflowIdentityLocked());
    }

    function test_ZeroSigner_LockRevertsEvenWithIdentityConfigured() public {
        vm.startPrank(owner);
        pc.setExpectedWorkflowId(WID);
        pc.setReportSigner(address(0));
        vm.expectRevert(_noSigner());
        pc.lockWorkflowIdentity();
        vm.stopPrank();
    }

    function test_ZeroSigner_CreateAndFundRevert() public {
        uint256 id = _createDefault(1e6);
        vm.prank(owner);
        pc.setReportSigner(address(0));

        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(_noSigner());
        pc.createCampaign(i, 1e6);

        vm.prank(sponsor);
        vm.expectRevert(_noSigner());
        pc.fund(id, 1e6);
        // signer check precedes the campaign lookup
        vm.prank(sponsor);
        vm.expectRevert(_noSigner());
        pc.fund(999, 1e6);

        assertEq(pc.totalEscrowed(), 1e6);
        assertEq(pc.remaining(id), 1e6);
        assertEq(pc.nextCampaignId(), 2);
    }

    function test_ZeroSigner_ExistingEscrowStillRecoverableByBrand() public {
        uint256 id = _createDefault(3e6);
        vm.prank(owner);
        pc.setReportSigner(address(0));
        uint256 b0 = usdc.balanceOf(brand);
        vm.prank(brand);
        pc.close(id);
        assertEq(usdc.balanceOf(brand) - b0, 3e6);
    }

    function test_ZeroSigner_ReportsRevertAndNothingIsPaid() public {
        uint256 id = _createDefault(3e6);
        bytes memory rep = _rep(id, POST_1, COMMIT_A, 1000, 0);
        vm.prank(owner);
        pc.setReportSigner(address(0));
        _expectSend(_noSigner(), rep);
        assertEq(usdc.balanceOf(creator), 0);
        assertEq(pc.remaining(id), 3e6);
    }

    function test_Deposits_WorkAfterSignerConfiguredWithoutLock_SimulationMode() public {
        vm.prank(owner);
        pc.setReportSigner(address(0));
        vm.prank(owner);
        pc.setReportSigner(signer);
        uint256 id = _createDefault(1e6);
        vm.prank(sponsor);
        pc.fund(id, 1e6);
        assertEq(pc.remaining(id), 2e6);
        assertFalse(pc.workflowIdentityLocked());
    }
}

// ═════════════ allowAnyWorkflow == false ═════════════
contract ProoflineCampaignsSignerAdminStrictTest is SignerAdminHelpers {
    function setUp() public override {
        super.setUp();
        pc = new PC(forwarder, address(usdc), owner, false); // signer intentionally NOT configured
        _fundActors(pc);
    }

    function test_Strict_SignerDefaultsToZero() public view {
        assertEq(pc.reportSigner(), address(0));
    }

    function test_Strict_CreateAndFundRevertSignerNotConfigured() public {
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(_noSigner()); // signer check precedes the not-locked check
        pc.createCampaign(i, 1e6);
        vm.prank(sponsor);
        vm.expectRevert(_noSigner());
        pc.fund(1, 1e6);
        // identity configured and even locked is impossible without signer, see lock test
        vm.prank(owner);
        pc.setExpectedWorkflowId(WID);
        vm.prank(brand);
        vm.expectRevert(_noSigner());
        pc.createCampaign(i, 1e6);
    }

    function test_Strict_SignerConfiguredButUnlockedStillRevertsNotLocked() public {
        _setSigner(pc);
        PC.CampaignInput memory i = _input();
        vm.prank(brand);
        vm.expectRevert(PC.WorkflowIdentityNotLocked.selector);
        pc.createCampaign(i, 1e6);
        vm.prank(sponsor);
        vm.expectRevert(PC.WorkflowIdentityNotLocked.selector);
        pc.fund(1, 1e6);
    }

    function test_Strict_LockRevertsWithoutSigner() public {
        vm.startPrank(owner);
        // nothing configured at all: signer check comes first
        vm.expectRevert(_noSigner());
        pc.lockWorkflowIdentity();
        // identity configured, signer still zero
        pc.setExpectedWorkflowId(WID);
        pc.setExpectedWorkflowOwner(WOWNER);
        vm.expectRevert(_noSigner());
        pc.lockWorkflowIdentity();
        vm.stopPrank();
        assertFalse(pc.workflowIdentityLocked());
    }

    function test_Strict_LockWithSignerButNoIdentityStillRevertsNotConfigured() public {
        _setSigner(pc);
        vm.prank(owner);
        vm.expectRevert(PC.WorkflowIdentityNotConfigured.selector);
        pc.lockWorkflowIdentity();
    }

    function test_Strict_SignerEmitsAndLockEmitsFullFlow() public {
        address s = signer;
        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.ReportSignerUpdated(address(0), s);
        vm.prank(owner);
        pc.setReportSigner(s);

        vm.startPrank(owner);
        pc.setExpectedWorkflowId(WID);
        pc.setExpectedWorkflowOwner(WOWNER);
        vm.expectEmit(false, false, false, true, address(pc));
        emit PC.WorkflowIdentityLocked(WID, WOWNER);
        pc.lockWorkflowIdentity();
        vm.expectRevert(PC.WorkflowIdentityIsLocked.selector);
        pc.setReportSigner(address(0xCAFE));
        vm.stopPrank();
        assertEq(pc.reportSigner(), s);

        uint256 id = _createDefault(10e6);
        metaStore = abi.encodePacked(WID, bytes10("workflow01"), WOWNER);
        assertEq(_payAmount(id, POST_1, COMMIT_A, 1000, 0), 1_000_000);
        // right workflow metadata but a wrong signer still fails
        _expectSend(
            abi.encodeWithSelector(PC.InvalidReportSignature.selector),
            _signWith(OTHER_PK, _body(3, id, POST_2, COMMIT_A, creator, 1000, 0, block.timestamp))
        );
        // right signer but wrong workflow metadata still fails (workflow check first)
        metaStore = abi.encodePacked(keccak256("other"), bytes10("workflow01"), WOWNER);
        _expectSend(abi.encodeWithSelector(PC.InvalidWorkflowId.selector), _rep(id, POST_2, COMMIT_A, 1000, 0));
    }

    function test_Strict_ReportWithZeroSignerReverts() public {
        vm.prank(owner);
        pc.setExpectedWorkflowId(WID);
        metaStore = abi.encodePacked(WID, bytes10("workflow01"), WOWNER);
        bytes memory body = _body(3, 1, POST_1, COMMIT_A, creator, 1000, 0, block.timestamp);
        _expectSend(_noSigner(), abi.encodePacked(body, new bytes(65)));
    }

    function test_Strict_SetSignerOnlyOwnerAndZeroAllowedBeforeLock() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pc.setReportSigner(stranger);
        _setSigner(pc);
        vm.prank(owner);
        pc.setReportSigner(address(0));
        assertEq(pc.reportSigner(), address(0));
    }
}
