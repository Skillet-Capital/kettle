// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../lib/Structs.sol";

interface ISignatures {
    function information()
        external
        view
        returns (
            string memory version,
            bytes32 domainSeparator
        );
    function getOfferHash(LoanOffer calldata offer) external view returns (bytes32);
    function cancelledOrFulfilled(address user, uint256 salt) external view returns (uint256);
    function nonces(address user) external view returns (uint256);
}
