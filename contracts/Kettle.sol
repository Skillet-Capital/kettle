// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ERC721Holder } from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import { Helpers } from "./Helpers.sol";
import { CollateralVerifier } from "./CollateralVerifier.sol";
import { SafeTransfer } from "./SafeTransfer.sol";

import { Signatures } from "./lib/Signatures.sol";
import { OfferController } from "./OfferController.sol";
import { IKettle } from "./interfaces/IKettle.sol";

import { CollateralType, Fee, Lien, LoanOffer, BorrowOffer, RenegotiationOffer, LoanOfferInput, BorrowOfferInput, LienPointer, LoanFullfillment, BorrowFullfillment, RepayFullfillment, RefinanceFullfillment, OfferAuth } from "./lib/Structs.sol";

import { InvalidLien, Unauthorized, LienIsDefaulted, LienNotDefaulted, CollectionsDoNotMatch, CurrenciesDoNotMatch, NoEscrowImplementation, InvalidCollateralSize, InvalidCollateralType, TotalFeeTooHigh, InvalidLienHash, LienIdMismatch, InvalidDuration, LendersDoNotMatch } from "./lib/Errors.sol";

/**
 *  _        _   _   _      
 * | |      | | | | | |     
 * | | _____| |_| |_| | ___ 
 * | |/ / _ \ __| __| |/ _ \
 * |   <  __/ |_| |_| |  __/
 * |_|\_\___|\__|\__|_|\___|
 *
 * @title Kettle
 * @author diamondjim
 * @custom:version 1.0
 * @notice Kettle is a lending protocol that allows users to borrow against any tokenized asset
 */

contract Kettle is IKettle, Ownable, Signatures, OfferController, SafeTransfer, ERC721Holder, ERC1155Holder {
    uint256 private _nextLienId;

    mapping(uint256 => bytes32) public liens;
    mapping(address => address) public escrows;

    constructor(address authSigner) OfferController(authSigner) { }

    /*//////////////////////////////////////////////////
                       GETTERS
    //////////////////////////////////////////////////*/
    function getRepaymentAmount(
        uint256 borrowAmount,
        uint256 rate,
        uint256 duration
    ) public pure returns (uint256) {
        return Helpers.computeCurrentDebt(borrowAmount, rate, duration);
    }

    function getEscrow(
        address collection
    ) public view returns (address escrow) {
        escrow = escrows[collection];
        if (escrow == address(0)) {
            return address(this);
        }
    }

    /*//////////////////////////////////////////////////
                       SETTERS
    //////////////////////////////////////////////////*/
    function setEscrow(address collection, address escrow) external onlyOwner {
        escrows[collection] = escrow;
    }

    /*//////////////////////////////////////////////////
                    FEE FLOWS
    //////////////////////////////////////////////////*/
    function payFees(
        address currency,
        address lender,
        uint256 amount,
        Fee[] calldata fees
    ) internal returns (uint256 totalFees) {

        totalFees = 0;
        for (uint256 i = 0; i < fees.length; i++) {
            uint256 feeAmount = Helpers.computeFeeAmount(
                amount,
                fees[i].rate
            );

            SafeTransfer.transferERC20(
                currency, 
                lender, 
                fees[i].recipient, 
                feeAmount
            );

            unchecked {
                totalFees += feeAmount;
            }
        }

        // revert if total fees are more than loan amount (over 100% fees)
        if (totalFees >= amount) {
            revert TotalFeeTooHigh();
        }
    }

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Verifies and starts multiple liens against loan offers; then transfers loan and collateral assets
     * @param loanOffers Loan offers
     * @param fullfillments Loan offer fullfillments
     * @param borrower address of borrower (optional)
     * @return lienIds array of lienIds
     */
    function borrowBatch(
        LoanOfferInput[] calldata loanOffers,
        LoanFullfillment[] calldata fullfillments,
        address borrower
    ) external returns (uint256[] memory lienIds) {
        uint256 numFills = fullfillments.length;
        lienIds = new uint256[](numFills);

        for (uint256 i = 0; i < numFills; i++) {
            LoanFullfillment calldata fullfillment = fullfillments[i];
            LoanOfferInput calldata offer = loanOffers[fullfillment.offerIndex];

            lienIds[i] = borrow(
                offer.offer,
                fullfillment.auth,
                offer.offerSignature,
                fullfillment.authSignature,
                fullfillment.amount,
                fullfillment.tokenId,
                borrower,
                fullfillment.proof
            );
        }
    }

    /**
     * @notice Verifies and takes loan offer; then transfers loan and collateral assets
     * @param offer Loan offer
     * @param auth Offer auth
     * @param offerSignature Lender offer signature
     * @param authSignature Auth signer signature
     * @param amount Loan amount in ETH
     * @param tokenId Token id to provide as collateral
     * @param borrower address of borrower
     * @param proof proof for criteria offer
     * @return lienId New lien id
     */
    function borrow(
        LoanOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        uint256 amount,
        uint256 tokenId,
        address borrower,
        bytes32[] calldata proof
    ) public returns (uint256 lienId) {
        if (borrower == address(0)) {
            borrower = msg.sender;
        }

        CollateralVerifier.verifyCollateral(
            offer.collateralType,
            offer.identifier,
            tokenId,
            proof
        );

        lienId = _borrow(
            offer,
            auth,
            offerSignature,
            authSignature,
            amount,
            tokenId,
            borrower
        );

        SafeTransfer.transfer(
            offer.collateralType, 
            offer.collection, 
            msg.sender, 
            getEscrow(offer.collection), 
            tokenId, 
            offer.size
        );

        /* Transfer fees from lender */
        uint256 totalFees = payFees(
            offer.currency,
            offer.lender,
            amount,
            offer.fees
        );

        /* Transfer loan amount to borrower. */
        unchecked {
            SafeTransfer.transferERC20(
                offer.currency, 
                offer.lender,
                borrower, 
                amount - totalFees
            );
        }
    }

    /**
     * @notice Verifies and takes loan offer; creates new lien
     * @param offer Loan offer
     * @param auth Offer auth
     * @param offerSignature Lender offer signature
     * @param authSignature Auth signer signature
     * @param amount Loan amount in ETH
     * @param tokenId Token id to provide as collateral
     * @param borrower address of borrower (optional)
     * @return lienId New lien id
     */
    function _borrow(
        LoanOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        uint256 amount,
        uint256 tokenId,
        address borrower
    ) internal returns (uint256 lienId) {
        bytes32 offerHash = _hashLoanOffer(offer);

        Lien memory lien = Lien({
            offerHash: offerHash,
            lender: offer.lender,
            borrower: borrower,
            collateralType: CollateralVerifier.mapCollateralType(offer.collateralType),
            collection: offer.collection,
            tokenId: tokenId,
            size: offer.size,
            currency: offer.currency,
            amount: amount,
            startTime: block.timestamp,
            duration: offer.duration,
            rate: offer.rate
        });

        /* Create lien. */
        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        /* Take the loan offer. */
        _takeLoanOffer(offer, auth, offerSignature, authSignature, lien, lienId);
    }

    /*//////////////////////////////////////////////////
                    LOAN FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Verifies and starts multiple liens against loan offers; then transfers loan and collateral assets
     * @param borrowOffers Borrow offers
     * @param fullfillments Borrow fullfillments
     * @return lienIds array of lienIds
     */
    function loanBatch(
        BorrowOfferInput[] calldata borrowOffers,
        BorrowFullfillment[] calldata fullfillments
    ) external returns (uint256[] memory lienIds) {
        lienIds = new uint256[](fullfillments.length);

        for (uint256 i = 0; i < fullfillments.length; i++) {
            BorrowFullfillment calldata fullfillment = fullfillments[i];
            BorrowOfferInput calldata offer = borrowOffers[fullfillment.offerIndex];

            lienIds[i] = loan(
                offer.offer,
                fullfillment.auth,
                offer.offerSignature,
                fullfillment.authSignature
            );
        }
    }

    /**
     * @notice Verifies and takes loan offer; then transfers loan and collateral assets
     * @param offer Loan offer
     * @param auth Offer auth
     * @param offerSignature Lender offer signature
     * @param authSignature Auth signer signature
     * @return lienId New lien id
     */
    function loan(
        BorrowOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) public returns (uint256 lienId) {

        lienId = _loanToBorrower(
            offer,
            auth,
            offerSignature,
            authSignature
        );

        SafeTransfer.transfer(
            offer.collateralType,
            offer.collection,
            offer.borrower,
            getEscrow(offer.collection),
            offer.tokenId,
            offer.size
        );

        /* Transfer fees from lender */
        uint256 totalFees = payFees(
            offer.currency,
            msg.sender,
            offer.amount,
            offer.fees
        );

        /* Transfer loan amount to borrower. */
        unchecked {
            SafeTransfer.transferERC20(
                offer.currency,
                msg.sender,
                offer.borrower,
                offer.amount - totalFees
            );
        }
    }

    /**
     * @notice Verifies and takes loan offer; creates new lien
     * @param offer Loan offer
     * @param auth Offer auth
     * @param offerSignature Borrower offer signature
     * @param authSignature Auth signer signature
     * @return lienId New lien id
     */
    function _loanToBorrower(
        BorrowOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) internal returns (uint256 lienId) {
        bytes32 offerHash = _hashBorrowOffer(offer);

        Lien memory lien = Lien({
            offerHash: offerHash,
            lender: msg.sender,
            borrower: offer.borrower,
            collateralType: CollateralVerifier.mapCollateralType(offer.collateralType),
            collection: offer.collection,
            tokenId: offer.tokenId,
            size: offer.size,
            currency: offer.currency,
            amount: offer.amount,
            startTime: block.timestamp,
            duration: offer.duration,
            rate: offer.rate
        });

        /* Create lien. */
        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        /* Take the loan offer. */
        _takeBorrowOffer(offer, auth, offerSignature, authSignature, lien, lienId);
    }

    /*//////////////////////////////////////////////////
                    REPAY FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Repays loans in batch
     * @param repayments Loan repayments
     */
    function repayBatch(
        RepayFullfillment[] calldata repayments
    ) external validateLiens(repayments) liensAreActive(repayments) {
        for (uint256 i = 0; i < repayments.length; i++) {
            RepayFullfillment calldata repayment = repayments[i];
            repay(repayment.lien, repayment.lienId);
        }
    }

    /**
     * @notice Repays loan and retrieves collateral
     * @param lien Lien preimage
     * @param lienId Lien id
     */
    function repay(
        Lien calldata lien,
        uint256 lienId
    ) public validateLien(lien, lienId) lienIsActive(lien) {
        uint256 _repayAmount = _repay(lien, lienId);

        SafeTransfer.transfer(
            lien.collateralType,
            lien.collection,
            getEscrow(lien.collection),
            lien.borrower,
            lien.tokenId,
            lien.size
        );

        SafeTransfer.transferERC20(
            lien.currency,
            msg.sender, 
            lien.lender, 
            _repayAmount
        );
    }

    /**
     * @notice Computes the current debt repayment and burns the lien
     * @dev Does not transfer assets
     * @param lien Lien preimage
     * @param lienId Lien id
     * @return repayAmount Current amount of debt owed on the lien
     */
    function _repay(
        Lien calldata lien,
        uint256 lienId
    ) internal returns (uint256 repayAmount) {
        repayAmount = getRepaymentAmount(
            lien.amount,
            lien.rate,
            lien.duration
        );

        delete liens[lienId];

        emit Repay(
            lienId, 
            lien.collection,
            lien.startTime,
            block.timestamp,
            lien.amount,
            lien.rate,
            lien.duration,
            repayAmount
        );
    }

    /*//////////////////////////////////////////////////
                    REFINANCE FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Refinances multiple liens with new loan offers;
     * @param loanOffers Loan offers
     * @param fullfillments Loan offer fullfillments
     */
    function refinanceBatch(
        LoanOfferInput[] calldata loanOffers,
        RefinanceFullfillment[] calldata fullfillments
    ) external {
        for (uint256 i = 0; i < fullfillments.length; i++) {
            RefinanceFullfillment calldata fullfillment = fullfillments[i];
            LoanOfferInput calldata offer = loanOffers[fullfillment.offerIndex];

            refinance(
                fullfillment.lien,
                fullfillment.lienId,
                fullfillment.amount,
                offer.offer,
                fullfillment.auth,
                offer.offerSignature,
                fullfillment.authSignature,
                fullfillment.proof
            );
        }
    }

    /**
     * @notice Refinance and existing lien with new loan offer
     * @param lien Existing lien
     * @param lienId Identifier of existing lien
     * @param amount Loan amount in ETH
     * @param offer Loan offer
     * @param auth Offer auth
     * @param offerSignature Lender offer signature
     * @param authSignature Auth signer signature
     * @param proof proof for criteria offer
     */
    function refinance(
        Lien calldata lien,
        uint256 lienId,
        uint256 amount,
        LoanOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        bytes32[] calldata proof
    ) public validateLien(lien, lienId) lienIsActive(lien) {

        // caller must be borrower
        if (msg.sender != lien.borrower) {
            revert Unauthorized();
        }

        /** 
         * Verify collateral is takeable by loan offer 
         * use token id from lien against collateral identifier of offer
         * make sure the offer is specifying collateral that matches
         * the current lien
         */
        CollateralVerifier.verifyCollateral(
            offer.collateralType,
            offer.identifier,
            lien.tokenId,
            proof
        );

        /* Refinance initial loan to new loan (loanAmount must be within lender range) */
        _refinance(lien, lienId, amount, offer, auth, offerSignature, authSignature);

        uint256 repayAmount = getRepaymentAmount(
            lien.amount,
            lien.rate,
            lien.duration
        );

        /* Transfer fees 
         * Caller of method must pay fees in order to refinance offer
         * Fees are calculated based on the new loan amount
         */
        payFees(
            offer.currency,
            msg.sender,
            amount,
            offer.fees
        );

        if (amount >= repayAmount) {
            /* If new loan is more than the previous, repay the initial loan and send the remaining to the borrower. */
            if (offer.lender != lien.lender) {
                SafeTransfer.transferERC20(offer.currency, offer.lender, lien.lender, repayAmount);
            }
            unchecked {
                SafeTransfer.transferERC20(offer.currency, offer.lender, lien.borrower, amount - repayAmount);
            }
        } else {
            /* If new loan is less than the previous, borrower must supply the difference to repay the initial loan. */
            if (offer.lender != lien.lender) {
                SafeTransfer.transferERC20(offer.currency, offer.lender, lien.lender, amount);
            }
            unchecked {
                SafeTransfer.transferERC20(offer.currency, lien.borrower, lien.lender, repayAmount - amount);
            }
        }
    }

    function _refinance(
        Lien calldata lien,
        uint256 lienId,
        uint256 amount,
        LoanOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) internal {
        if (lien.collection != offer.collection) {
            revert CollectionsDoNotMatch();
        }

        if (lien.currency != offer.currency) {
            revert CurrenciesDoNotMatch();
        }

        if (lien.size != offer.size) {
            revert InvalidCollateralSize();
        }

        if (lien.collateralType != CollateralVerifier.mapCollateralType(offer.collateralType)) {
            revert InvalidCollateralType();
        }

        // initialize offer hash
        bytes32 offerHash = _hashLoanOffer(offer);

        // If the offer hashes are the same, we need to update the start time for refinances
        uint256 diff = 0;
        if (offerHash == lien.offerHash) {
            diff = lien.startTime + lien.duration - block.timestamp;
        }

        /* Update lien with new loan details. */
        Lien memory newLien = Lien({
            offerHash: offerHash,
            lender: offer.lender,
            borrower: lien.borrower,
            collateralType: lien.collateralType,
            collection: lien.collection,
            tokenId: lien.tokenId,
            size: lien.size,
            currency: lien.currency,
            amount: amount,
            startTime: block.timestamp + diff,
            duration: offer.duration,
            rate: offer.rate
        });

        unchecked {
            liens[lienId] = keccak256(abi.encode(newLien));
        }

        /* Take the loan offer. */
        _takeLoanOffer(offer, auth, offerSignature, authSignature, newLien, lienId);

        emit Refinance(
            lienId,
            lien.lender,
            newLien.lender,
            lien.amount,
            newLien.amount,
            lien.duration,
            newLien.duration,
            lien.rate,
            newLien.rate
        );
    }

    /*//////////////////////////////////////////////////
                    RENEGOTIATE FLOWS
    //////////////////////////////////////////////////*/

    function renegotiate(
        Lien calldata lien,
        uint256 lienId,
        RenegotiationOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) public validateLien(lien, lienId) lienIsActive(lien) {

        // caller must be borrower
        if (msg.sender != lien.borrower) {
            revert Unauthorized();
        }

        // borrower pays fees on original borrow amount and offer specified rate
        payFees(
            lien.currency, 
            msg.sender, 
            lien.amount, 
            offer.fees
        );

        // renegotiate initial loan to new loan
        _renegotiate(lien, lienId, offer, auth, offerSignature, authSignature);
    }

    function _renegotiate(
        Lien calldata lien,
        uint256 lienId,
        RenegotiationOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) internal {

        // current lender must be the renegotiation lender
        if (lien.lender != offer.lender) {
            revert LendersDoNotMatch();
        }

        // signed lien id must match provided lien id
        if (lienId != offer.lienId) {
            revert LienIdMismatch();
        }
        
        // signed lien hash must match stored lien hash
        // protects against renegotation after subsequent update to lien
        // if provided lien hash is 0, pass through
        if (offer.lienHash != bytes32(0)) {
            bytes32 _lienHash = liens[lienId];
            if (_lienHash != offer.lienHash) {
                revert InvalidLienHash();
            }
        }

        // updated duration must end after current block timestamp
        if (lien.startTime + offer.newDuration < block.timestamp) {
            revert InvalidDuration();
        }

        // initialize offer hash
        bytes32 offerHash = _hashRenegotiationOffer(offer);

        /* Update lien with new loan details. */
        Lien memory newLien = Lien({
            offerHash: offerHash,
            lender: lien.lender,
            borrower: lien.borrower,
            collateralType: lien.collateralType,
            collection: lien.collection,
            tokenId: lien.tokenId,
            size: lien.size,
            currency: lien.currency,
            amount: lien.amount,
            startTime: lien.startTime,
            duration: offer.newDuration,
            rate: offer.newRate
        });

        unchecked {
            liens[lienId] = keccak256(abi.encode(newLien));
        }

        /* Take the renegotiation offer. */
        _takeRenegotiationOffer(offer, auth, offerSignature, authSignature, newLien, lienId);

        emit Renegotiate(
            lienId,
            lien.rate,
            newLien.rate,
            lien.duration,
            newLien.duration
        );
    }

    /*//////////////////////////////////////////////////
                    DEFAULT FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Seizes collateral from defaulted lien, skipping liens that are not defaulted
     * @param lienPointers List of lien, lienId pairs
     */
    function seize(LienPointer[] calldata lienPointers) external {
        uint256 length = lienPointers.length;

        for (uint256 i; i < length; ) {
            Lien calldata lien = lienPointers[i].lien;
            uint256 lienId = lienPointers[i].lienId;

            if (msg.sender != lien.lender) {
                revert Unauthorized();
            }

            if (!_validateLien(lien, lienId)) {
                revert InvalidLien();
            }

            if (!_lienIsDefaulted(lien)) {
                revert LienNotDefaulted();
            }

            /* Check that the auction has ended and lien is defaulted. */
            delete liens[lienId];

            /* Seize collateral to lender. */
            SafeTransfer.transfer(
                lien.collateralType, 
                lien.collection, 
                getEscrow(lien.collection), 
                lien.lender, 
                lien.tokenId,
                lien.size
            );

            emit Seize(lienId, lien.collection);

            unchecked {
                ++i;
            }
        }
    }

    /*/////////////////////////////////////////////////////////////
                        VALIDATION MODIFIERS
    /////////////////////////////////////////////////////////////*/

    modifier validateLien(Lien calldata lien, uint256 lienId) {
        if (!_validateLien(lien, lienId)) {
            revert InvalidLien();
        }

        _;
    }

    modifier validateLiens(RepayFullfillment[] calldata repayments) {
        uint256 length = repayments.length;
        for (uint256 i; i < length; ) {
            Lien calldata lien = repayments[i].lien;
            uint256 lienId = repayments[i].lienId;

            if (!_validateLien(lien, lienId)) {
                revert InvalidLien();
            }

            unchecked {
                ++i;
            }
        }

        _;
    }

    modifier lienIsActive(Lien calldata lien) {
        if (_lienIsDefaulted(lien)) {
            revert LienIsDefaulted();
        }

        _;
    }

    modifier liensAreActive(RepayFullfillment[] calldata repayments) {
        uint256 length = repayments.length;
        for (uint256 i; i < length; ) {
            Lien calldata lien = repayments[i].lien;

            if (_lienIsDefaulted(lien)) {
                revert LienIsDefaulted();
            }

            unchecked {
                ++i;
            }
        }

        _;
    }

    function _validateLien(
        Lien calldata lien,
        uint256 lienId
    ) internal view returns (bool) {
        return liens[lienId] == keccak256(abi.encode(lien));
    }

    function _lienIsDefaulted(Lien calldata lien) internal view returns (bool) {
        return lien.startTime + lien.duration < block.timestamp;
    }
}
