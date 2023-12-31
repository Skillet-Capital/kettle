// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

// Kettle
error Unauthorized();
error InvalidLoan();
error InvalidLien();
error InvalidLoanAmount();
error InsufficientOffer();
error InvalidRepayment();
error LienIsDefaulted();
error LienNotDefaulted();
error AuctionIsActive();
error AuctionIsNotActive();
error InvalidRefinanceRate();
error InvalidRefinanceDuration();
error RateTooHigh();
error FeesTooHigh();
error CollectionsDoNotMatch();
error CurrenciesDoNotMatch();
error InsufficientRefinance();
error InvalidAuctionDuration();
error NoEscrowImplementation();
error InvalidLienHash();
error InvalidDuration();
error LendersDoNotMatch();
error LienIdMismatch();
error TotalFeeTooHigh();

// CollateralVerifier
error InvalidCollateral();
error InvalidCollateralCriteria();
error InvalidCollateralType();
error InvalidCollateralSize();

// OfferController
error OfferExpired();
error OfferUnavailable();

// Signatures
error UnauthorizedOracle();
error SignatureExpired();
error InvalidSignature();
error InvalidVParameter();

// Auth
error AuthorizationExpired();
error UnauthorizedTaker();
error UnauthorizedOffer();
error UnauthorizedCollateral();
