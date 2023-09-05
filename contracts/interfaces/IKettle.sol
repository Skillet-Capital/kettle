// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { IOfferController } from "./IOfferController.sol";

import { LoanOffer, BorrowOffer, LoanInput, LoanFullfillment, BorrowOfferInput, RepayFullfillment, Lien, LienPointer } from "../lib/Structs.sol";

interface IKettle is IOfferController {
    event Repay(uint256 lienId, address collection, uint256 amount);

    event Seize(uint256 lienId, address collection);

    event Refinance(
        uint256 lienId,
        address collection,
        address currency,
        uint256 amount,
        address oldLender,
        address newLender,
        uint256 oldBorrowAmount,
        uint256 newBorrowAmount,
        uint256 oldRate,
        uint256 newRate
    );

    function liens(uint256 lienId) external view returns (bytes32 lienHash);

    function getRepaymentAmount(
        uint256 borrowAmount,
        uint256 rate,
        uint256 duration
    ) external returns (uint256 repayAmount);

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/
    function borrow(
        LoanOffer calldata offer,
        bytes calldata signature,
        uint256 loanAmount,
        uint256 collateralId,
        address borrower,
        bytes32[] calldata proof
    ) external returns (uint256 lienId);

    function borrowBatch(
        LoanInput[] calldata loanInputs,
        LoanFullfillment[] calldata fullfillments,
        address borrower
    ) external returns (uint256[] memory lienIds);

    /*//////////////////////////////////////////////////
                    LOAN FLOWS
    //////////////////////////////////////////////////*/
    function loan(
        BorrowOffer calldata offer,
        bytes calldata signature
    ) external returns (uint256 lienId);

    function loanBatch(
        BorrowOfferInput[] calldata borrowOffers
    ) external returns (uint256[] memory lienIds);

    /*//////////////////////////////////////////////////
                      REPAYMENT FLOWS
    //////////////////////////////////////////////////*/
    function repay(Lien calldata lien, uint256 lienId) external;

    function repayBatch(RepayFullfillment[] calldata repayments) external;

    /*//////////////////////////////////////////////////
                    REFINANCING FLOWS
    //////////////////////////////////////////////////*/
    function seize(LienPointer[] calldata lienPointers) external;
}
