// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ILendingEscrow {
    event EscrowCreated(bytes32 offerHash);
    event EscrowUpdated(bytes32 offerHash, uint256 amount);
    event EscrowUsed(bytes32 offerHash, uint256 amount);
    event EscrowDestroyed(bytes32 offerHash);

    function useEscrow(bytes32 offerHash, uint256 amount) external;
}
