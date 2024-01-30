// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { Kettle } from "./Kettle.sol";
import { IKettle } from "./interfaces/IKettle.sol";

import { Helpers } from "./Helpers.sol";
import { SafeTransfer } from "./SafeTransfer.sol";
import { CollateralVerifier } from "./CollateralVerifier.sol";

import { LienV3, LoanOfferV3, BorrowOfferV3, OfferAuth, TransferOffer } from "./lib/Structs.sol";
import { Unauthorized } from "./lib/Errors.sol";


contract KettleV3 is Kettle {

    address constant public originalKettle;
    uint256 constant public _MILLI_BASIS_POINTS = 1e6;

    mapping(uint256 => uint256) private _installment;

    constructor(
        address authSigner,
        address _originalKettle
    ) Kettle(authSigner) {
        originalKettle = _originalKettle;
    }

    function getInstallment(uint256 lienId) public view returns (uint256) {
        return _installment[lienId];
    }

    function calculateInstallment(
        uint256 amount,
        uint256 rate,
        uint256 period
    ) public pure returns (uint256) {
        uint256 frequency = (365 days * 10_000) / period;
        return amount * rate / _MILLI_BASIS_POINTS / frequency * 10_000;
    }

    /// @notice Verifies and takes loan offer
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    /// @param tokenId Token id to provide as collateral
    /// @param borrower address of borrower
    /// @param proof proof for criteria offer
    /// @return lienId New lien id
    function borrow(
        LoanOfferV3 calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        uint256 tokenId,
        address borrower,
        bytes32[] calldata proof
    ) public override returns (uint256 lienId) {

        /// set custom borrower
        if (borrower == address(0)) {
            borrower = msg.sender;
        }

        /// verify collateral
        CollateralVerifier.verifyCollateral(
            offer.collateralType,
            offer.identifier,
            tokenId,
            proof
        );

        /// initiate borrow
        lienId = _borrow(
            offer,
            auth,
            offerSignature,
            authSignature,
            tokenId,
            borrower
        );

        /// transfer collateral from borrower to escrow
        SafeTransfer.transfer(
            offer.collateralType, 
            offer.collection, 
            msg.sender, 
            address(this),
            tokenId,
            offer.size
        );

        /// transfer net loan amount to borrower
        SafeTransfer.transferERC20(
            offer.currency, 
            offer.lender,
            borrower, 
            amount
        );
    }

    /// @notice Verifies and takes loan offer
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    /// @return lienId New lien id
    function loan(
        BorrowOfferV3 calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) public override returns (uint256 lienId) {

        /// initiate loan
        lienId = _loan(
            offer,
            auth,
            offerSignature,
            authSignature
        );

        /// transfer collateral from borrower to escrow
        SafeTransfer.transfer(
            offer.collateralType,
            offer.collection,
            offer.borrower,
            address(this),
            offer.tokenId,
            offer.size
        );

        /// transfer net loan amount to borrower
        SafeTransfer.transferERC20(
            offer.currency,
            msg.sender,
            offer.borrower,
            offer.amount
        );
    }

    /// @notice Refinance and existing lien with new loan offer
    /// @param lien Existing lien
    /// @param lienId Identifier of existing lien
    /// @param amount Loan amount in ETH
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    /// @param proof proof for criteria offer
    function refinance(
        LienV3 calldata lien,
        uint256 lienId,
        LoanOfferV3 calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        bytes32[] calldata proof
    ) public override validateLien(lien, lienId) lienIsActive(lien) {

        // caller must be borrower
        if (msg.sender != lien.borrower) {
            revert Unauthorized();
        }

        /// verify collateral is takeable by loan offer 
        /// use token id from lien against collateral identifier of offer
        /// make sure the offer is specifying collateral that matches
        /// the current lien
        CollateralVerifier.verifyCollateral(
            offer.collateralType,
            offer.identifier,
            lien.tokenId,
            proof
        );

        //// refinance initial loan to new loan
        _refinance(lien, lienId, amount, offer, auth, offerSignature, authSignature);

        /// calculate repayment amount on original loan
        uint256 repayAmount = getRepaymentAmount(
            lien.amount,
            lien.rate,
            lien.duration
        );

        /// calculate total fees
        uint256 totalFees = 0;
        for (uint256 i = 0; i < offer.fees.length; i++) {
            // skip if fee rate is 0
            if (offer.fees[i].rate == 0) {
                continue;
            }

            uint256 feeAmount = Helpers.computeFeeAmount(
                amount,
                offer.fees[i].rate
            );

            unchecked {
                totalFees += feeAmount;
            }
        }


        /// if amount is greater than repayment amount
        /// transfer repayment amount from new lender to old lender (if different)
        /// transfer leftover from new lender to borrower
        if (amount >= repayAmount) {
            if (offer.lender != lien.lender) {
                SafeTransfer.transferERC20(offer.currency, offer.lender, lien.lender, repayAmount);
            }
            unchecked {
                SafeTransfer.transferERC20(offer.currency, offer.lender, lien.borrower, amount - repayAmount);
            }

        /// if amount is less than repayment amount
        /// transfer amount from new lender to old lender (if different)
        /// transfer difference of repayment amount from borrower to old lender
        } else {
            if (offer.lender != lien.lender) {
                SafeTransfer.transferERC20(offer.currency, offer.lender, lien.lender, amount);
            }
            unchecked {
                SafeTransfer.transferERC20(offer.currency, lien.borrower, lien.lender, repayAmount - amount);
            }
        }
    }

    /// @notice Transfers lien to new lender
    /// @param lien Existing lien
    /// @param lienId Identifier of existing lien
    /// @param offer Transfer offer
    /// @param offerSignature Signature for transfer offer
    function transferLienV3(
        Lien calldata lien,
        uint256 lienId,
        TransferOffer calldata offer,
        bytes calldata offerSignature
    ) public validateLien(lien, lienId) lienIsActive(lien) 
    {

        // caller must be borrower
        if (msg.sender != lien.lender) {
            revert Unauthorized();
        }

        Lien memory newLien = Lien({
            offerHash: lien.offerHash,
            lender: offer.lender,
            borrower: lien.borrower,
            collateralType: lien.collateralType,
            collection: lien.collection,
            tokenId: lien.tokenId,
            size: lien.size,
            currency: lien.currency,
            amount: lien.amount,
            startTime: lien.startTime,
            duration: lien.duration,
            rate: lien.rate
        });

        /// store the lien in struct
        unchecked {
            liens[lienId] = keccak256(abi.encode(newLien));
        }

        // transfer amount to old lender
        SafeTransfer.transferERC20(
            lien.currency,
            offer.lender,
            lien.lender,
            lien.amount
        );

        emit TransferLien(
            lienId,
            lien.lender,
            offer.lender,
            offer.amount
        );
    }
}
