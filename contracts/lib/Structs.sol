// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "solmate/src/tokens/ERC721.sol";
import "solmate/src/tokens/ERC20.sol";

struct LienPointer {
  Lien lien;
  uint256 lienId;
}

struct Lien {
  address lender;
  address borrower;
  ERC721 collection;
  uint256 tokenId;
  ERC20 currency;
  uint256 borrowAmount;
  uint256 duration;
  uint256 rate;
  uint256 startTime;
}

struct LoanOffer {
  address lender;
  ERC721 collection;
  ERC20 currency;
  uint256 totalAmount;
  uint256 minAmount;
  uint256 maxAmount;
  uint256 duration;
  uint256 rate;
  uint256 salt;
  uint256 expiration;
  Fee[] fees;
}

struct LoanInput {
  LoanOffer offer;
  bytes signature;
}

struct Fee {
  uint16 rate;
  address recipient;
}
