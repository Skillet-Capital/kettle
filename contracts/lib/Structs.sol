// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/*//////////////////////////////////////////////////
                COLLATERAL TYPES
//////////////////////////////////////////////////*/

enum CollateralType {
    ERC721,
    ERC1155,
    ERC721_WITH_CRITERIA,
    ERC1155_WITH_CRITERIA
}

struct Collateral {
    uint8 collateralType;
    address collection;
    uint256 tokenId;
    uint256 size;
}

/*//////////////////////////////////////////////////
                LIEN STRUCTS
//////////////////////////////////////////////////*/

struct LienPointer {
    Lien lien;
    uint256 lienId;
}

struct Lien {
    bytes32 offerHash;
    address lender;
    address borrower;
    uint8 collateralType;
    address collection;
    uint256 tokenId;
    uint256 size;
    address currency;
    uint256 amount;
    uint256 duration;
    uint256 rate;
    uint256 startTime;
}

/*//////////////////////////////////////////////////
                LOAN OFFER STRUCTS
//////////////////////////////////////////////////*/

struct LoanOffer {
    address lender;
    uint8 collateralType;
    address collection;
    uint256 identifier;
    uint256 size;
    address currency;
    uint256 totalAmount;
    uint256 minAmount;
    uint256 maxAmount;
    uint256 duration;
    uint256 rate;
    uint256 salt;
    uint256 expiration;
    Fee[] fees;
}

struct LoanOfferInput {
    LoanOffer offer;
    bytes offerSignature;
}

struct LoanFullfillment {
    uint256 offerIndex;
    uint256 amount;
    uint256 tokenId;
    bool useEscrow;
    OfferAuth auth;
    bytes authSignature;
    bytes32[] proof;
}

/*//////////////////////////////////////////////////
                BORROW OFFER STRUCTS
//////////////////////////////////////////////////*/

struct BorrowOffer {
    address borrower;
    uint8 collateralType;
    address collection;
    uint256 tokenId;
    uint256 size;
    address currency;
    uint256 amount;
    uint256 duration;
    uint256 rate;
    uint256 salt;
    uint256 expiration;
    Fee[] fees;
}

struct BorrowOfferInput {
    BorrowOffer offer;
    bytes offerSignature;
}

struct BorrowFullfillment {
    uint256 offerIndex;
    OfferAuth auth;
    bytes authSignature;
}

/*//////////////////////////////////////////////////
                RENEGOTIATE STRUCTS
//////////////////////////////////////////////////*/

struct RenegotiationOffer {
    address lender;
    uint256 lienId;
    bytes32 lienHash;
    uint256 newDuration;
    uint256 newRate;
    uint256 expiration;
    uint256 salt;
    Fee[] fees;
}

/*//////////////////////////////////////////////////
                REPAY STRUCTS
//////////////////////////////////////////////////*/

struct RepayFullfillment {
    Lien lien;
    uint256 lienId;
}

/*//////////////////////////////////////////////////
                REFINANCE STRUCTS
//////////////////////////////////////////////////*/

struct RefinanceFullfillment {
    Lien lien;
    uint256 lienId;
    uint256 offerIndex;
    uint256 amount;
    bytes32[] proof;
    OfferAuth auth;
    bytes authSignature;
}

/*//////////////////////////////////////////////////
                FEE STRUCTS
//////////////////////////////////////////////////*/

struct Fee {
    uint256 rate;
    address recipient;
}

/*//////////////////////////////////////////////////
                AUTH STRUCTS
//////////////////////////////////////////////////*/
struct OfferAuth {
    bytes32 offerHash;
    address taker;
    uint256 expiration;
    bytes32 collateralHash;
}

/*//////////////////////////////////////////////////
                ESCROW STRUCTS
//////////////////////////////////////////////////*/
struct EscrowFunds {
    address lender;
    address currency;
    uint256 amount;
    uint256 authorizedAmount;
    uint256 expiration;
}

struct UpdateEscrowAuth {
    address lender;
    bytes32 offerHash;
    uint256 amount;
    uint256 expiration;
}
