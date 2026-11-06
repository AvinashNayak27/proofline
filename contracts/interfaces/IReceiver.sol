// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Minimal interface for receiving Chainlink CRE reports through a trusted forwarder.
interface IReceiver is IERC165 {
    /// @notice Receives workflow metadata and an ABI-encoded report.
    /// @param metadata Forwarder-provided workflow metadata.
    /// @param report Workflow-provided report payload.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
