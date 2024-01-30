// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ILendingEscrow {
    function useEscrow(bytes32 offerHash, uint256 amount) external;
}
