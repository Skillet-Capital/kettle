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

import { CollateralType, Fee, Lien, LoanOffer, BorrowOffer, RenegotiationOffer, TransferOffer, LoanOfferInput, BorrowOfferInput, LienPointer, LoanFullfillment, BorrowFullfillment, RepayFullfillment, RefinanceFullfillment, OfferAuth } from "./lib/Structs.sol";

import { InvalidLien, Unauthorized, LienIsDefaulted, LienNotDefaulted, CollectionsDoNotMatch, CurrenciesDoNotMatch, NoEscrowImplementation, InvalidCollateralSize, InvalidCollateralType, TotalFeeTooHigh, InvalidLienHash, LienIdMismatch, InvalidDuration, LendersDoNotMatch } from "./lib/Errors.sol";

///      ██████  ███           ████                                                █████                
///    ████████████████        ████                            ████       ████     █████                
///  ██████   ██████████       ████                            ████       ████     █████                
/// █████████████████████      ████     ████     ███████    ██████████ ██████████  █████      ███████   
/// █████   ██████████████     ████   █████    ███████████  █████████████████████  █████    ███████████ 
/// █████   ██████████████     ████ █████     ████     ████    ████      █████     █████   ████    █████
/// ██████████████████████     █████████     ███████████████   ████      █████     █████  ██████████████
/// █████████████████████      ██████████    ███████████████   ████      █████     █████  ██████████████
///  ██████   ██████████       █████ █████   █████             ████      █████     █████  █████         
///    ███████████████         ████   █████   █████   █████    ████████  ████████  █████   █████   █████
///       █████  ███           ████    █████    █████████       ███████   ███████  █████     ██████████ 
///
/// @title Kettle
/// @author diamondjim.eth
/// @custom:version 2.0
/// @notice Kettle is a decentralized lending protocol

contract Kettle is IKettle, Ownable, Signatures, OfferController, SafeTransfer, ERC721Holder, ERC1155Holder {
    uint256 private _nextLienId;

    mapping(uint256 => bytes32) public liens;
    mapping(address => address) public escrows;
    mapping(bytes32 => uint256) private _gracePeriod;

    uint256[50] private _gap;

    constructor(address authSigner) OfferController(authSigner) { }

    /// @notice calculate repayment amount given amount, rate, and duration
    /// @param amount loan amount
    /// @param rate loan rate
    /// @param duration loan duration
    /// @return repayment amount
    function getRepaymentAmount(
        uint256 amount,
        uint256 rate,
        uint256 duration
    ) public pure returns (uint256) {
        return Helpers.computeCurrentDebt(amount, rate, duration);
    }

    /// @notice get custom escrow address for collection
    /// @dev if no escrow is set, return this contract address
    /// @param collection collection address
    /// @return escrow address
    function getEscrow(
        address collection
    ) public view returns (address escrow) {
        escrow = escrows[collection];
        if (escrow == address(0)) {
            return address(this);
        }
    }

    /// @notice return grace period given a lien id
    /// @dev grace periods are set per lien hash
    /// @dev if lien hash changes, grace period will default to 0
    /// @param lienId lien id
    /// @return duration grace period duration
    function getGracePeriodForLien(uint256 lienId) public view returns (uint256 duration) {
        duration = _gracePeriod[liens[lienId]];
    }

    /// @notice set custom escrow address for collection (only owner can call this method)
    /// @dev if no escrow is set, return this contract address
    /// @param collection collection address
    /// @param escrow escrow address
    function setEscrow(address collection, address escrow) external onlyOwner {
        escrows[collection] = escrow;
    }

    /// @notice set grace period for a lien id (only owner can call this method)
    /// @dev grace periods are set per lien hash
    /// @dev if lien hash changes, grace period will default to 0
    /// @param lienId lien id
    /// @param duration grace period duration
    function setGracePeriodForLien(uint256 lienId, uint256 duration) external onlyOwner {
        _gracePeriod[liens[lienId]] = duration;
    }

    /// @notice pay fees to recipients based on rates
    /// @dev gas efficiency to check if rate is 0 and pass over
    /// @dev reverts if fees are over 100%
    /// @param currency currency address
    /// @param payer address from which fees are paid
    /// @param amount loan amount
    /// @param fees array of fees
    /// @return totalFees total fees paid
    function payFees(
        address currency,
        address payer,
        uint256 amount,
        Fee[] calldata fees
    ) internal returns (uint256 totalFees) {

        totalFees = 0;
        for (uint256 i = 0; i < fees.length; i++) {
            // skip if fee rate is 0
            if (fees[i].rate == 0) {
                continue;
            }

            uint256 feeAmount = Helpers.computeFeeAmount(
                amount,
                fees[i].rate
            );

            SafeTransfer.transferERC20(
                currency, 
                payer, 
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

    
    /// @notice Verifies and starts multiple liens against loan offers
    /// @param loanOffers Loan offers
    /// @param fullfillments Loan offer fullfillments
    /// @param borrower address of borrower (optional)
    /// @return lienIds array of lienIds
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

    /// @notice Verifies and takes loan offer
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    /// @param amount Loan amount
    /// @param tokenId Token id to provide as collateral
    /// @param borrower address of borrower
    /// @param proof proof for criteria offer
    /// @return lienId New lien id
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
            amount,
            tokenId,
            borrower
        );

        /// transfer collateral from borrower to escrow
        SafeTransfer.transfer(
            offer.collateralType, 
            offer.collection, 
            msg.sender, 
            getEscrow(offer.collection), 
            tokenId, 
            offer.size
        );

        /// transfer fees from lender
        uint256 totalFees = payFees(
            offer.currency,
            offer.lender,
            amount,
            offer.fees
        );

        /// transfer net loan amount to borrower
        unchecked {
            SafeTransfer.transferERC20(
                offer.currency, 
                offer.lender,
                borrower, 
                amount - totalFees
            );
        }
    }

    /// @notice verifies and takes loan offer; creates new lien
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    /// @param amount Loan amount
    /// @param tokenId Token id to provide as collateral
    /// @param borrower address of borrower (optional)
    /// @return lienId New lien id
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

        /// store lien in memory
        /// map collateral type from WITH_CRITERIA to respective type
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

        /// store the lien in struct
        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        /// execute the loan offer
        _takeLoanOffer(offer, auth, offerSignature, authSignature, lien, lienId);
    }

    /// @notice Verifies and starts multiple liens against loan offers
    /// @param borrowOffers Borrow offers
    /// @param fullfillments Borrow fullfillments
    /// @return lienIds array of lienIds
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

    /// @notice Verifies and takes loan offer
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    /// @return lienId New lien id
    function loan(
        BorrowOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) public returns (uint256 lienId) {

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
            getEscrow(offer.collection),
            offer.tokenId,
            offer.size
        );

        //// transfer fees from lender
        uint256 totalFees = payFees(
            offer.currency,
            msg.sender,
            offer.amount,
            offer.fees
        );

        //// transfer net loan amount to borrower
        unchecked {
            SafeTransfer.transferERC20(
                offer.currency,
                msg.sender,
                offer.borrower,
                offer.amount - totalFees
            );
        }
    }

    /// @notice Verifies and takes loan offer; creates new lien
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Borrower offer signature
    /// @param authSignature Auth signer signature
    /// @return lienId New lien id
    function _loan(
        BorrowOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) internal returns (uint256 lienId) {
        bytes32 offerHash = _hashBorrowOffer(offer);

        /// store lien in memory
        /// map collateral type from WITH_CRITERIA to respective type
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

        /// store the lien in struct
        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        /// take the borrow offer
        _takeBorrowOffer(offer, auth, offerSignature, authSignature, lien, lienId);
    }

    /// @notice repays loans in batch
    /// @param repayments Loan repayments
    function repayBatch(
        RepayFullfillment[] calldata repayments
    ) external validateLiens(repayments) liensAreActive(repayments) {
        for (uint256 i = 0; i < repayments.length; i++) {
            RepayFullfillment calldata repayment = repayments[i];
            repay(repayment.lien, repayment.lienId);
        }
    }

    /// @notice repays loan and retrieves collateral
    /// @param lien Lien preimage
    /// @param lienId Lien id
    function repay(
        Lien calldata lien,
        uint256 lienId
    ) public validateLien(lien, lienId) lienIsActive(lien) {

        /// calculate the repayment amount
        uint256 _repayAmount = _repay(lien, lienId);

        /// transfer collateral from escrow to borrower
        SafeTransfer.transfer(
            lien.collateralType,
            lien.collection,
            getEscrow(lien.collection),
            lien.borrower,
            lien.tokenId,
            lien.size
        );

        /// transfer repayment amount from borrower to lender
        SafeTransfer.transferERC20(
            lien.currency,
            msg.sender, 
            lien.lender, 
            _repayAmount
        );
    }

    /// @notice Computes the current debt repayment and burns the lien
    /// @param lien Lien preimage
    /// @param lienId Lien id
    /// @return repayAmount Current amount of debt owed on the lien
    function _repay(
        Lien calldata lien,
        uint256 lienId
    ) internal returns (uint256 repayAmount) {

        /// calculate repayment amount
        repayAmount = getRepaymentAmount(
            lien.amount,
            lien.rate,
            lien.duration
        );

        /// remove lien and grace period
        delete _gracePeriod[liens[lienId]];
        delete liens[lienId];

        /// emit repayment event
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

    /// @notice Refinances multiple liens with new loan offers;
    /// @param loanOffers Loan offers
    /// @param fullfillments Loan offer fullfillments
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

        /// transfer fees 
        /// caller of method must pay fees in order to refinance offer
        /// fees are calculated based on the new loan amount

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
        if (amount >= repayAmount + totalFees) {
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

        payFees(
            offer.currency,
            msg.sender,
            amount,
            offer.fees
        );
    }

    /// @notice Refinance and existing lien with new loan offer
    /// @param lien Existing lien
    /// @param lienId Identifier of existing lien
    /// @param amount Loan amount
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    function _refinance(
        Lien calldata lien,
        uint256 lienId,
        uint256 amount,
        LoanOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature
    ) internal {

        /// check lien collection matches offer collection
        if (lien.collection != offer.collection) {
            revert CollectionsDoNotMatch();
        }

        /// check lien currency matches offer currency
        if (lien.currency != offer.currency) {
            revert CurrenciesDoNotMatch();
        }

        /// check lien size matches offer size
        if (lien.size != offer.size) {
            revert InvalidCollateralSize();
        }

        /// check lien collateral type matches offer collateral type
        if (lien.collateralType != CollateralVerifier.mapCollateralType(offer.collateralType)) {
            revert InvalidCollateralType();
        }

        // initialize offer hash
        bytes32 offerHash = _hashLoanOffer(offer);

        //// update lien with new loan details
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
            startTime: block.timestamp,
            duration: offer.duration,
            rate: offer.rate
        });

        /// update stored lien hash
        unchecked {
            liens[lienId] = keccak256(abi.encode(newLien));
        }

        /// take the new loan offer
        _takeLoanOffer(offer, auth, offerSignature, authSignature, newLien, lienId);

        /// emit refinance event
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

    function transferLien(
        Lien calldata lien,
        uint256 lienId,
        TransferOffer calldata offer,
        bytes calldata offerSignature
    ) public 
      validateLien(lien, lienId) 
      lienIsActive(lien) 
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
    
    /// @notice Renegotiates lien with new parameters
    /// @param lien Lien preimage
    /// @param lienId Lien id
    /// @param offer Renegotiation offer
    /// @param auth Offer auth
    /// @param offerSignature Renegotiation offer signature
    /// @param authSignature Auth signer signature
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

    /// @notice Renegotiates lien with new parameters
    /// @param lien Lien preimage
    /// @param lienId Lien id
    /// @param offer Renegotiation offer
    /// @param auth Offer auth
    /// @param offerSignature Renegotiation offer signature
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
        // if provided lien hash is 0, pass through (allows for renegoitation once per lien)
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

        /// update lien with new loan details
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

        /// store the lien in struct
        unchecked {
            liens[lienId] = keccak256(abi.encode(newLien));
        }

        //// take the renegotiation offer
        _takeRenegotiationOffer(offer, auth, offerSignature, authSignature, newLien, lienId);
        
        /// emit renegotiation event
        emit Renegotiate(
            lienId,
            lien.rate,
            newLien.rate,
            lien.duration,
            newLien.duration
        );
    }

    /// @notice Seizes collateral from defaulted lien, skipping liens that are not defaulted
    /// @param lienPointers List of lien, lienId pairs
    function seize(LienPointer[] calldata lienPointers) external {
        uint256 length = lienPointers.length;

        /// iterate over lien pointers
        for (uint256 i; i < length; ) {
            Lien calldata lien = lienPointers[i].lien;
            uint256 lienId = lienPointers[i].lienId;
            
            /// check that caller is lender
            if (msg.sender != lien.lender) {
                revert Unauthorized();
            }

            /// check that lien is valid
            if (!_validateLien(lien, lienId)) {
                revert InvalidLien();
            }

            /// check that lien is defaulted
            if (!_lienIsDefaulted(lien)) {
                revert LienNotDefaulted();
            }

            /// remove lien and grace period
            delete _gracePeriod[liens[lienId]];
            delete liens[lienId];

            /// transfer collateral to lender
            SafeTransfer.transfer(
                lien.collateralType, 
                lien.collection, 
                getEscrow(lien.collection), 
                lien.lender, 
                lien.tokenId,
                lien.size
            );

            /// emit seize event
            emit Seize(lienId, lien.collection);

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Verifies lien matches stored lien hash
    modifier validateLien(Lien calldata lien, uint256 lienId) {
        if (!_validateLien(lien, lienId)) {
            revert InvalidLien();
        }

        _;
    }

    /// @notice batch verifies liens match stored lien hashes
    /// @dev only used in batch repayments
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

    /// @notice verifies lien is not defaulted
    modifier lienIsActive(Lien calldata lien) {
        if (_lienIsDefaulted(lien)) {
            revert LienIsDefaulted();
        }

        _;
    }

    /// @notice batch verifies liens are not defaulted
    /// @dev only used in batch repayments
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

    /// @notice hash given lien and compare against stored hash
    function _validateLien(
        Lien calldata lien,
        uint256 lienId
    ) internal view returns (bool) {
        return liens[lienId] == keccak256(abi.encode(lien));
    }

    /// @notice compute endtime of lien and compare against block timestamp
    /// @dev uses grace period for a lien
    function _lienIsDefaulted(Lien calldata lien) internal view returns (bool) {
        bytes32 lienHash = keccak256(abi.encode(lien));
        return lien.startTime + lien.duration + _gracePeriod[lienHash] < block.timestamp;
    }
}
