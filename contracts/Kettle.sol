// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { Helpers } from "./Helpers.sol";
import { CollateralVerifier } from "./CollateralVerifier.sol";

import { OfferController } from "./OfferController.sol";
import { IKettle } from "./interfaces/IKettle.sol";

import { IConduit, ConduitTransfer, ConduitItemType } from "./interfaces/IConduit.sol";

import { Fee, Lien, LoanOffer, LoanInput, LienPointer, LoanFullfillment, RepayFullfillment, RefinanceFullfillment } from "./lib/Structs.sol";

import { InvalidLien, Unauthorized, LienIsDefaulted, LienNotDefaulted, CollectionsDoNotMatch, CurrenciesDoNotMatch, NoEscrowImplementation } from "./lib/Errors.sol";

contract Kettle is IKettle, OfferController {
    uint256 private constant _BASIS_POINTS = 10_000;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private _nextLienId;
    address public conduit;

    mapping(uint256 => bytes32) public liens;
    mapping(address => address) public escrows;

    constructor(address _conduit) {
        conduit = _conduit;
    }

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
            revert NoEscrowImplementation();
        }
    }

    /*//////////////////////////////////////////////////
                       SETTERS
    //////////////////////////////////////////////////*/
    function setEscrow(address collection, address escrow) external {
        escrows[collection] = escrow;
    }

    /*//////////////////////////////////////////////////
                    FEE FLOWS
    //////////////////////////////////////////////////*/
    function payFees(
        address currency,
        address lender,
        uint256 loanAmount,
        Fee[] calldata fees
    ) internal returns (uint256 totalFees) {
        ConduitTransfer[] memory conduitTransfers = new ConduitTransfer[](
            fees.length
        );

        totalFees = 0;
        for (uint256 i = 0; i < fees.length; i++) {
            uint256 feeAmount = Helpers.computeFeeAmount(
                loanAmount,
                fees[i].rate
            );
            conduitTransfers[i] = ConduitTransfer({
                itemType: ConduitItemType.ERC20,
                token: currency,
                from: lender,
                to: fees[i].recipient,
                identifier: 0,
                amount: feeAmount
            });
            unchecked {
                totalFees += feeAmount;
            }
        }

        IConduit(conduit).execute(conduitTransfers);
    }

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @notice Verifies and starts multiple liens against loan offers; then transfers loan and collateral assets
     * @param loanOffers Loan offers
     * @param fullfillments Loan offer fullfillments
     * @return lienIds array of lienIds
     */
    function borrowBatch(
        LoanInput[] calldata loanOffers,
        LoanFullfillment[] calldata fullfillments,
        address borrower
    ) external returns (uint256[] memory lienIds) {
        if (borrower == address(0)) {
            borrower = msg.sender;
        }

        uint256 numFills = fullfillments.length;

        lienIds = new uint256[](numFills);

        ConduitTransfer[] memory transfers = new ConduitTransfer[](
            numFills * 2
        );

        for (uint256 i = 0; i < numFills; i++) {
            LoanFullfillment calldata fullfillment = fullfillments[i];
            LoanInput calldata loan = loanOffers[fullfillment.loanIndex];

            CollateralVerifier.verifyCollateral(
                uint8(loan.offer.collateralType),
                loan.offer.collateralIdentifier,
                fullfillment.collateralIdentifier,
                fullfillment.proof
            );

            lienIds[i] = _borrow(
                loan.offer,
                loan.signature,
                fullfillment.loanAmount,
                fullfillment.collateralIdentifier,
                borrower
            );

            transfers[i] = ConduitTransfer({
                itemType: ConduitItemType(
                    Helpers.getCollateralType(uint8(loan.offer.collateralType))
                ),
                token: loan.offer.collection,
                from: msg.sender,
                to: getEscrow(loan.offer.collection),
                identifier: fullfillment.collateralIdentifier,
                amount: loan.offer.collateralAmount
            });

            /* Transfer fees from lender */
            uint256 totalFees = payFees(
                loan.offer.currency,
                loan.offer.lender,
                fullfillment.loanAmount,
                loan.offer.fees
            );

            /* Transfer loan to borrower. */
            unchecked {
                transfers[i + numFills] = ConduitTransfer({
                    itemType: ConduitItemType.ERC20,
                    token: loan.offer.currency,
                    from: loan.offer.lender,
                    to: borrower,
                    identifier: 0,
                    amount: fullfillment.loanAmount - totalFees
                });
            }
        }

        IConduit(conduit).execute(transfers);
    }

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
        uint256 collateralTokenId,
        address borrower,
        bytes32[] calldata proof
    ) external returns (uint256 lienId) {
        if (borrower == address(0)) {
            borrower = msg.sender;
        }

        ConduitTransfer[] memory transfers = new ConduitTransfer[](2);

        CollateralVerifier.verifyCollateral(
            uint8(offer.collateralType),
            offer.collateralIdentifier,
            collateralTokenId,
            proof
        );

        lienId = _borrow(
            offer,
            signature,
            loanAmount,
            collateralTokenId,
            borrower
        );

        /* Lock collateral token. */
        transfers[0] = ConduitTransfer({
            itemType: ConduitItemType(
                Helpers.getCollateralType(uint8(offer.collateralType))
            ),
            token: offer.collection,
            from: msg.sender,
            to: getEscrow(offer.collection),
            identifier: collateralTokenId,
            amount: offer.collateralAmount
        });

        /* Transfer fees from lender */
        uint256 totalFees = payFees(
            offer.currency,
            offer.lender,
            loanAmount,
            offer.fees
        );

        /* Transfer loan to borrower. */
        unchecked {
            transfers[1] = ConduitTransfer({
                itemType: ConduitItemType.ERC20,
                token: offer.currency,
                from: offer.lender,
                to: borrower,
                identifier: 0,
                amount: loanAmount - totalFees
            });
        }

        IConduit(conduit).execute(transfers);
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
        uint256 collateralTokenId,
        address borrower
    ) internal returns (uint256 lienId) {
        Lien memory lien = Lien({
            lender: offer.lender,
            borrower: borrower,
            collateralType: uint8(offer.collateralType),
            collection: offer.collection,
            amount: offer.collateralAmount,
            tokenId: collateralTokenId,
            currency: offer.currency,
            borrowAmount: loanAmount,
            startTime: block.timestamp,
            duration: offer.duration,
            rate: offer.rate
        });

        /* Create lien. */
        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        /* Take the loan offer. */
        _takeLoanOffer(offer, signature, lien, lienId);
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
        uint256 numRepays = repayments.length;
        ConduitTransfer[] memory transfers = new ConduitTransfer[](
            numRepays * 2
        );

        for (uint256 i = 0; i < numRepays; i++) {
            RepayFullfillment calldata repayment = repayments[i];
            uint256 _repayAmount = _repay(repayment.lien, repayment.lienId);

            /* Return collateral to borrower. */
            transfers[i] = ConduitTransfer({
                itemType: ConduitItemType(
                    Helpers.getCollateralType(
                        uint8(repayment.lien.collateralType)
                    )
                ),
                token: repayment.lien.collection,
                from: getEscrow(repayment.lien.collection),
                to: repayment.lien.borrower,
                identifier: repayment.lien.tokenId,
                amount: repayment.lien.amount
            });

            /* Repay loan to lender. */
            transfers[i + numRepays] = ConduitTransfer({
                itemType: ConduitItemType.ERC20,
                token: repayment.lien.currency,
                from: msg.sender,
                to: repayment.lien.lender,
                identifier: 0,
                amount: _repayAmount
            });
        }

        IConduit(conduit).execute(transfers);
    }

    /**
     * @notice Repays loan and retrieves collateral
     * @param lien Lien preimage
     * @param lienId Lien id
     */
    function repay(
        Lien calldata lien,
        uint256 lienId
    ) external validateLien(lien, lienId) lienIsActive(lien) {
        ConduitTransfer[] memory transfers = new ConduitTransfer[](2);

        uint256 _repayAmount = _repay(lien, lienId);

        /* Return collateral to borrower. */
        transfers[0] = ConduitTransfer({
            itemType: ConduitItemType(
                Helpers.getCollateralType(uint8(lien.collateralType))
            ),
            token: lien.collection,
            from: getEscrow(lien.collection),
            to: lien.borrower,
            identifier: lien.tokenId,
            amount: lien.amount
        });

        /* Repay loan to lender. */
        transfers[1] = ConduitTransfer({
            itemType: ConduitItemType.ERC20,
            token: lien.currency,
            from: msg.sender,
            to: lien.lender,
            identifier: 0,
            amount: _repayAmount
        });

        IConduit(conduit).execute(transfers);
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
            lien.borrowAmount,
            lien.rate,
            lien.duration
        );

        delete liens[lienId];

        emit Repay(lienId, lien.collection, repayAmount);
    }

    /*//////////////////////////////////////////////////
                    REFINANCE FLOWS
    //////////////////////////////////////////////////*/

    function borrowerRefinanceBatch(
        LoanInput[] calldata loans,
        RefinanceFullfillment[] calldata refinances
    ) external {
        uint256 numRefinances = refinances.length;
        ConduitTransfer[] memory transfers = new ConduitTransfer[](
            numRefinances * 2
        );

        for (uint256 i = 0; i < numRefinances; i++) {
            RefinanceFullfillment calldata refinance = refinances[i];

            /* Verify that sender is borrower */
            if (msg.sender != refinance.lien.borrower) {
                revert Unauthorized();
            }

            /* Verify lien is valid */
            if (!_validateLien(refinance.lien, refinance.lienId)) {
                revert InvalidLien();
            }

            /* Verify lien is  */
            if (_lienIsDefaulted(refinance.lien)) {
                revert LienIsDefaulted();
            }

            /* Verify collateral is takeable by loan offer */
            CollateralVerifier.verifyCollateral(
                uint8(loans[refinance.loanIndex].offer.collateralType),
                loans[refinance.loanIndex].offer.collateralIdentifier,
                refinance.lien.tokenId,
                refinance.proof
            );

            LoanInput calldata loanOfferPointer = loans[refinance.loanIndex];
            uint256 loanAmount = refinance.loanAmount;

            /* Refinance initial loan to new loan (loanAmount must be within lender range) */
            _refinance(
                refinance.lien,
                refinance.lienId,
                loanAmount,
                loanOfferPointer.offer,
                loanOfferPointer.signature
            );

            uint256 repayAmount = getRepaymentAmount(
                refinance.lien.borrowAmount,
                refinance.lien.rate,
                refinance.lien.duration
            );

            /* Transfer fees */
            uint256 totalFees = payFees(
                loanOfferPointer.offer.currency,
                loanOfferPointer.offer.lender,
                refinance.loanAmount,
                loanOfferPointer.offer.fees
            );

            unchecked {
                loanAmount -= totalFees;
            }

            if (loanAmount >= repayAmount) {
                /* If new loan is more than the previous, repay the initial loan and send the remaining to the borrower. */
                transfers[i] = ConduitTransfer({
                    itemType: ConduitItemType.ERC20,
                    token: loanOfferPointer.offer.currency,
                    from: loanOfferPointer.offer.lender,
                    to: refinance.lien.lender,
                    identifier: 0,
                    amount: repayAmount
                });

                unchecked {
                    transfers[i + numRefinances] = ConduitTransfer({
                        itemType: ConduitItemType.ERC20,
                        token: loanOfferPointer.offer.currency,
                        from: loanOfferPointer.offer.lender,
                        to: refinance.lien.borrower,
                        identifier: 0,
                        amount: loanAmount - repayAmount
                    });
                }
            } else {
                /* If new loan is less than the previous, borrower must supply the difference to repay the initial loan. */
                transfers[i] = ConduitTransfer({
                    itemType: ConduitItemType.ERC20,
                    token: loanOfferPointer.offer.currency,
                    from: loanOfferPointer.offer.lender,
                    to: refinance.lien.lender,
                    identifier: 0,
                    amount: loanAmount
                });

                unchecked {
                    transfers[i + numRefinances] = ConduitTransfer({
                        itemType: ConduitItemType.ERC20,
                        token: loanOfferPointer.offer.currency,
                        from: refinance.lien.borrower,
                        to: refinance.lien.lender,
                        identifier: 0,
                        amount: repayAmount - loanAmount
                    });
                }
            }
        }

        IConduit(conduit).execute(transfers);
    }

    function borrowerRefinance(
        Lien calldata lien,
        uint256 lienId,
        uint256 loanAmount,
        LoanOffer calldata offer,
        bytes calldata signature,
        bytes32[] calldata proof
    ) external validateLien(lien, lienId) lienIsActive(lien) {
        if (msg.sender != lien.borrower) {
            revert Unauthorized();
        }

        ConduitTransfer[] memory transfers = new ConduitTransfer[](2);

        /* Verify collateral is takeable by loan offer */
        CollateralVerifier.verifyCollateral(
            uint8(offer.collateralType),
            offer.collateralIdentifier,
            lien.tokenId,
            proof
        );

        /* Refinance initial loan to new loan (loanAmount must be within lender range) */
        _refinance(lien, lienId, loanAmount, offer, signature);

        uint256 repayAmount = getRepaymentAmount(
            lien.borrowAmount,
            lien.rate,
            lien.duration
        );

        /* Transfer fees */
        uint256 totalFees = payFees(
            offer.currency,
            offer.lender,
            loanAmount,
            offer.fees
        );
        unchecked {
            loanAmount -= totalFees;
        }

        if (loanAmount >= repayAmount) {
            /* If new loan is more than the previous, repay the initial loan and send the remaining to the borrower. */
            transfers[0] = ConduitTransfer({
                itemType: ConduitItemType.ERC20,
                token: offer.currency,
                from: offer.lender,
                to: lien.lender,
                identifier: 0,
                amount: repayAmount
            });

            unchecked {
                transfers[1] = ConduitTransfer({
                    itemType: ConduitItemType.ERC20,
                    token: offer.currency,
                    from: offer.lender,
                    to: lien.borrower,
                    identifier: 0,
                    amount: loanAmount - repayAmount
                });
            }
        } else {
            /* If new loan is less than the previous, borrower must supply the difference to repay the initial loan. */
            transfers[0] = ConduitTransfer({
                itemType: ConduitItemType.ERC20,
                token: offer.currency,
                from: offer.lender,
                to: lien.lender,
                identifier: 0,
                amount: loanAmount
            });

            unchecked {
                transfers[1] = ConduitTransfer({
                    itemType: ConduitItemType.ERC20,
                    token: offer.currency,
                    from: lien.borrower,
                    to: lien.lender,
                    identifier: 0,
                    amount: repayAmount - loanAmount
                });
            }
        }

        IConduit(conduit).execute(transfers);
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
            collateralType: uint8(offer.collateralType),
            collection: lien.collection,
            amount: lien.amount,
            tokenId: lien.tokenId,
            currency: lien.currency,
            borrowAmount: loanAmount,
            startTime: block.timestamp,
            duration: offer.duration,
            rate: offer.rate
        });

        unchecked {
            liens[lienId] = keccak256(abi.encode(newLien));
        }

        /* Take the loan offer. */
        _takeLoanOffer(offer, signature, newLien, lienId);

        emit Refinance(
            lienId,
            offer.collection,
            offer.currency,
            lien.amount,
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
        ConduitTransfer[] memory transfers = new ConduitTransfer[](length);

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
            transfers[i] = ConduitTransfer({
                itemType: ConduitItemType(
                    Helpers.getCollateralType(uint8(lien.collateralType))
                ),
                token: lien.collection,
                from: getEscrow(lien.collection),
                to: lien.lender,
                identifier: lien.tokenId,
                amount: lien.amount
            });

            emit Seize(lienId, lien.collection);

            unchecked {
                ++i;
            }
        }

        IConduit(conduit).execute(transfers);
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
