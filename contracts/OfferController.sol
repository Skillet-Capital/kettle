// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IOfferController } from "./interfaces/IOfferController.sol";
import { Lien, LoanOffer } from "./lib/Structs.sol";
import { Signatures } from "./lib/Signatures.sol";

import { InvalidLoanAmount, InsufficientOffer, RateTooHigh, OfferExpired, OfferUnavailable } from "./lib/Errors.sol";

abstract contract OfferController is IOfferController, Signatures {
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;

    mapping(address => mapping(uint256 => uint256)) public cancelledOrFulfilled;
    mapping(bytes32 => uint256) private _amountTaken;
    uint256[50] private _gap;

    function amountTaken(bytes32 offerHash) external view returns (uint256) {
        return _amountTaken[offerHash];
    }

    /**
     * @notice Verifies and takes loan offer
     * @dev Does not transfer loan and collateral assets; does not update lien hash
     * @param offer Loan offer
     * @param signature Lender offer signature
     * @param lien Lien preimage
     * @param lienId Lien id
     */
    function _takeLoanOffer(
        LoanOffer calldata offer,
        bytes calldata signature,
        Lien memory lien,
        uint256 lienId
    ) internal {
        bytes32 hash = _hashOffer(offer);

        _validateOffer(
            hash,
            offer.lender,
            signature,
            offer.expiration,
            offer.salt
        );

        if (offer.rate > _LIQUIDATION_THRESHOLD) {
            revert RateTooHigh();
        }
        if (
            lien.borrowAmount > offer.maxAmount ||
            lien.borrowAmount < offer.minAmount
        ) {
            revert InvalidLoanAmount();
        }
        uint256 __amountTaken = _amountTaken[hash];
        if (offer.totalAmount - __amountTaken < lien.borrowAmount) {
            revert InsufficientOffer();
        }

        unchecked {
            _amountTaken[hash] = __amountTaken + lien.borrowAmount;
        }

        emit LoanOfferTaken(
            hash,
            lienId,
            lien.lender,
            lien.borrower,
            address(lien.currency),
            lien.collateralType,
            address(lien.collection),
            lien.tokenId,
            lien.amount,
            lien.borrowAmount,
            lien.rate,
            lien.duration,
            block.timestamp
        );
    }

    /**
     * @notice Assert offer validity
     * @param offerHash Offer hash
     * @param signer Address of offer signer
     * @param signature Packed signature array
     * @param expiration Offer expiration time
     * @param salt Offer salt
     */
    function _validateOffer(
        bytes32 offerHash,
        address signer,
        bytes calldata signature,
        uint256 expiration,
        uint256 salt
    ) internal view {
        _verifyOfferAuthorization(offerHash, signer, signature);

        if (expiration < block.timestamp) {
            revert OfferExpired();
        }
        if (cancelledOrFulfilled[signer][salt] == 1) {
            revert OfferUnavailable();
        }
    }

    /*/////////////////////////////////////////
                  CANCEL FUNCTIONS
    /////////////////////////////////////////*/
    /**
     * @notice Cancels offer salt for caller
     * @param salt Unique offer salt
     */
    function cancelOffer(uint256 salt) external {
        _cancelOffer(msg.sender, salt);
    }

    /**
     * @notice Cancels offers in bulk for caller
     * @param salts List of offer salts
     */
    function cancelOffers(uint256[] calldata salts) external {
        uint256 saltsLength = salts.length;
        for (uint256 i; i < saltsLength; ) {
            _cancelOffer(msg.sender, salts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Cancels all offers by incrementing caller nonce
     */
    function incrementNonce() external {
        _incrementNonce(msg.sender);
    }

    /**
     * @notice Cancel offer by user and salt
     * @param user Address of user
     * @param salt Unique offer salt
     */
    function _cancelOffer(address user, uint256 salt) private {
        cancelledOrFulfilled[user][salt] = 1;
        emit OfferCancelled(user, salt);
    }

    /**
     * @notice Cancel all orders by incrementing the user nonce
     * @param user Address of user
     */
    function _incrementNonce(address user) internal {
        emit NonceIncremented(user, ++nonces[user]);
    }
}
