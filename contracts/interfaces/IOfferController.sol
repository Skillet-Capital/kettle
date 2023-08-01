// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ISignatures.sol";

interface IOfferController is ISignatures {
    event LoanOfferTaken(
      bytes32 offerHash,
      uint256 lienId,
      address collection,
      address lender,
      address borrower,
      address currency,
      uint256 borrowAmount,
      uint256 repayAmount,
      uint256 rate,
      uint256 tokenId,
      uint256 duration
    );

    event OfferCancelled(address indexed user, uint256 salt);
    event NonceIncremented(address indexed user, uint256 newNonce);

    function amountTaken(bytes32 offerHash) external view returns (uint256);

    function cancelOffer(uint256 salt) external;

    function cancelOffers(uint256[] calldata salts) external;

    function incrementNonce() external;
}
