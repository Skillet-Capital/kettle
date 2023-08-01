// SPDX-License-Identifier: BSL 1.1 - Blend (c) Non Fungible Trading Ltd.
pragma solidity 0.8.19;

import "solmate/src/tokens/ERC20.sol";

import "./Helpers.sol";
import "./lib/Structs.sol";
import "./OfferController.sol";
import "./interfaces/IKettle.sol";

contract Kettle is IKettle, OfferController {
    uint256 private constant _BASIS_POINTS = 10_000;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private _nextLienId;

    mapping(uint256 => Lien) private _liens;
    mapping(uint256 => bytes32) private _lienHashes;

    /*//////////////////////////////////////////////////
                       GETTERS
    //////////////////////////////////////////////////*/
    function liens(uint256 lienId) external view returns(Lien memory) {
        return _liens[lienId];
    }

    function repayAmount(uint256 lienId) external view returns (uint256) {
        Lien memory lien = _liens[lienId];
        return lien.repayAmount;
    }

    /*//////////////////////////////////////////////////
                    FEE FLOWS
    //////////////////////////////////////////////////*/
    function payFees(
        ERC20 currency,
        address lender,
        uint256 loanAmount, 
        Fee[] calldata fees
    ) internal returns (uint256 totalFees) {
        totalFees = 0;
        for (uint256 i=0; i<fees.length; i++) {
            uint256 feeAmount = Helpers.computeFeeAmount(loanAmount, fees[i].rate);
            currency.transferFrom(lender, fees[i].recipient, feeAmount);
            totalFees += feeAmount;
        }
    }

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Verifies and takes loan offer; then transfers loan and collateral assets
     * @param offer Loan offer
     * @param signature Lender offer signature
     * @param loanAmount Loan amount in ETH
     * @param collateralTokenId Token id to provide as collateral
     * @return lienId New lien id
     */
    function borrow(
        LoanOffer calldata offer,
        bytes calldata signature,
        uint256 loanAmount,
        uint256 collateralTokenId
    ) external returns (uint256 lienId) {
        lienId = _borrow(offer, signature, loanAmount, collateralTokenId);

        /* Lock collateral token. */
        offer.collection.safeTransferFrom(msg.sender, address(this), collateralTokenId);

        /* Transfer fees from lender */
        uint256 totalFees = payFees(offer.currency, offer.lender, loanAmount, offer.fees);

        /* Transfer loan to borrower. */
        offer.currency.transferFrom(offer.lender, msg.sender, loanAmount - totalFees);
    }

    /**
     * @notice Verifies and takes loan offer; creates new lien
     * @param offer Loan offer
     * @param signature Lender offer signature
     * @param loanAmount Loan amount in ETH
     * @param collateralTokenId Token id to provide as collateral
     * @return lienId New lien id
     */
    function _borrow(
        LoanOffer calldata offer,
        bytes calldata signature,
        uint256 loanAmount,
        uint256 collateralTokenId
    ) internal returns (uint256 lienId) {

        Lien memory lien = Lien({
            lender: offer.lender,
            borrower: msg.sender,
            collection: offer.collection,
            tokenId: collateralTokenId,
            currency: offer.currency,
            borrowAmount: loanAmount,
            repayAmount: Helpers.computeCurrentDebt(loanAmount, offer.rate, offer.duration),
            startTime: block.timestamp,
            duration: offer.duration,
            rate: offer.rate
        });

        /* Create lien. */
        unchecked {
            lienId = _nextLienId++;
            _liens[lienId] = lien;
            _lienHashes[lienId] = keccak256(abi.encode(lien));
        }

        /* Take the loan offer. */
        _takeLoanOffer(offer, signature, lien, lienId);
    }

    /*//////////////////////////////////////////////////
                    REPAY FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Repays loan and retrieves collateral
     * @param lien Lien preimage
     * @param lienId Lien id
     */
    function repay(
        Lien calldata lien,
        uint256 lienId
    ) external validateLien(lien, lienId) lienIsActive(lien) {
        uint256 _repayAmount = _repay(lien, lienId);

        /* Return collateral to borrower. */
        lien.collection.safeTransferFrom(address(this), lien.borrower, lien.tokenId);

        /* Repay loan to lender. */
        lien.currency.transferFrom(msg.sender, lien.lender, _repayAmount);
    }

    /**
     * @notice Computes the current debt repayment and burns the lien
     * @dev Does not transfer assets
     * @param lien Lien preimage
     * @param lienId Lien id
     * @return debt Current amount of debt owed on the lien
     */
    function _repay(Lien calldata lien, uint256 lienId) internal returns (uint256) {
        delete _liens[lienId];
        delete _lienHashes[lienId];

        emit Repay(lienId, address(lien.collection), lien.repayAmount);
        return lien.repayAmount;
    }

    /*//////////////////////////////////////////////////
                    REFINANCE FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Refinances to different loan amount and repays previous loan
     * @dev Can be called by anyone, but loan amount net fees must exceed repay amount
     * @param lien Lien struct
     * @param lienId Lien id
     * @param offer Loan offer
     * @param signature Offer signatures
     */
    function refinance(
        Lien calldata lien,
        uint256 lienId,
        uint256 loanAmount,
        LoanOffer calldata offer,
        bytes calldata signature
    ) external validateLien(lien, lienId) lienIsActive(lien) {
        
        /* Interest rate must be at least as good as current. */
        if (offer.rate > lien.rate) {
            revert InvalidRefinanceRate();
        }

        /* Duration must be as long as remaining time in current loan */
        uint256 remainingTime = lien.startTime + lien.duration - block.timestamp;
        if (offer.duration < remainingTime) {
            revert InvalidRefinanceDuration();
        }

        /* Refinance initial loan to new loan */
        _refinance(lien, lienId, loanAmount, offer, signature);

        /* Transfer fees */
        uint256 totalFees = payFees(offer.currency, offer.lender, loanAmount, offer.fees);

        /* Net loan amount must be greater than repay amount */
        if (loanAmount - totalFees < lien.repayAmount) {
            revert InsufficientRefinance();
        }

        /* Repay initial loan */
        offer.currency.transferFrom(offer.lender, lien.lender, lien.repayAmount);

        /* Transfer difference to borrower */
        if (loanAmount - totalFees - lien.repayAmount > 0) {
            offer.currency.transferFrom(offer.lender, lien.borrower, loanAmount - totalFees - lien.repayAmount);
        }
    }

    function borrowerRefinance(
        Lien calldata lien,
        uint256 lienId,
        uint256 loanAmount,
        LoanOffer calldata offer,
        bytes calldata signature
    ) external validateLien(lien, lienId) lienIsActive(lien) {
        if (msg.sender != lien.borrower) {
            revert Unauthorized();
        }

        _refinance(lien, lienId, loanAmount, offer, signature);

        uint256 _repayAmount = lien.repayAmount;

        /* Transfer fees */
        uint256 totalFees = payFees(offer.currency, offer.lender, loanAmount, offer.fees);

        if (loanAmount - totalFees >= _repayAmount) {
            /* If new loan is more than the previous, repay the initial loan and send the remaining to the borrower. */
            offer.currency.transferFrom(offer.lender, lien.lender, _repayAmount);
            offer.currency.transferFrom(offer.lender, lien.borrower, loanAmount - totalFees - _repayAmount);
        } else {
            /* If new loan is less than the previous, borrower must supply the difference to repay the initial loan. */
            offer.currency.transferFrom(offer.lender, lien.lender, loanAmount);
            offer.currency.transferFrom(lien.borrower, lien.lender, _repayAmount - loanAmount - totalFees);
        }
    }

    function _refinance(
        Lien calldata lien,
        uint256 lienId,
        uint256 loanAmount,
        LoanOffer calldata offer,
        bytes calldata signature
    ) internal {
        if (lien.collection != offer.collection) {
            revert CollectionsDoNotMatch();
        }

        if (lien.currency != offer.currency) {
            revert CurrenciesDoNotMatch();
        }

        /* Update lien with new loan details. */
        Lien memory newLien = Lien({
            lender: offer.lender,
            borrower: lien.borrower,
            collection: lien.collection,
            tokenId: lien.tokenId,
            currency: lien.currency,
            borrowAmount: loanAmount,
            repayAmount: Helpers.computeCurrentDebt(loanAmount, offer.rate, offer.duration),
            startTime: block.timestamp,
            duration: offer.duration,
            rate: offer.rate
        });

        unchecked {
            _lienHashes[lienId] = keccak256(abi.encode(newLien));
            _liens[lienId] = newLien;
        }

        /* Take the loan offer. */
        _takeLoanOffer(offer, signature, newLien, lienId);

        emit Refinance(
            lienId,
            address(offer.collection),
            address(offer.currency),
            lien.lender,
            newLien.lender,
            lien.borrowAmount,
            newLien.borrowAmount,
            lien.rate,
            newLien.rate
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

            /* Check that the auction has ended and lien is defaulted. */
            if (_lienIsDefaulted(lien)) {
                delete _liens[lienId];
                delete _lienHashes[lienId];

                /* Seize collateral to lender. */
                lien.collection.safeTransferFrom(address(this), lien.lender, lien.tokenId);

                emit Seize(lienId, address(lien.collection));
            }

            unchecked {
                ++i;
            }
        }
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
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

    modifier lienIsActive(Lien calldata lien) {
        if (_lienIsDefaulted(lien)) {
            revert LienIsDefaulted();
        }

        _;
    }

    function _validateLien(Lien calldata lien, uint256 lienId) internal view returns (bool) {
        return _lienHashes[lienId] == keccak256(abi.encode(lien));
    }

    function _lienIsDefaulted(Lien calldata lien) internal view returns (bool) {
        return lien.startTime + lien.duration < block.timestamp;
    }
}