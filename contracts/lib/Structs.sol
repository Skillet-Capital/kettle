// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

enum CollateralType {
    ERC721,
    ERC1155,
    ERC721_WITH_CRITERIA,
    ERC1155_WITH_CRITERIA
}

struct LienPointer {
    Lien lien;
    uint256 lienId;
}

struct Lien {
    address lender;
    address borrower;
    uint8 collateralType;
    address collection;
    uint256 tokenId;
    uint256 amount;
    address currency;
    uint256 borrowAmount;
    uint256 duration;
    uint256 rate;
    uint256 startTime;
}

struct LoanOffer {
    address lender;
    address collection;
    address currency;
    CollateralType collateralType;
    uint256 collateralIdentifier;
    uint256 collateralAmount;
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

struct LoanFullfillment {
    uint256 loanIndex;
    uint256 loanAmount;
    uint256 collateralIdentifier;
    bytes32[] proof;
}

struct RepayFullfillment {
    Lien lien;
    uint256 lienId;
}

struct RefinanceFullfillment {
    Lien lien;
    uint256 lienId;
    uint256 loanIndex;
    uint256 loanAmount;
    bytes32[] proof;
}

struct Fee {
    uint16 rate;
    address recipient;
}
