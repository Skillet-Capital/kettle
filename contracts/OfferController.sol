// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { Helpers } from "./Helpers.sol";

import { IOfferController } from "./interfaces/IOfferController.sol";
import { Lien, LoanOffer, BorrowOffer, RenegotiationOffer, OfferAuth, Collateral } from "./lib/Structs.sol";
import { Signatures } from "./lib/Signatures.sol";

import { InvalidLoanAmount, InsufficientOffer, RateTooHigh, OfferExpired, OfferUnavailable, UnauthorizedOffer, UnauthorizedCollateral, UnauthorizedTaker, AuthorizationExpired } from "./lib/Errors.sol";

/// @title OfferController
/// @author diamondjim.eth
/// @notice offer controller for Kettle
contract OfferController is IOfferController, Ownable, Signatures {
    uint256 private constant _LIQUIDATION_THRESHOLD = 10_000_000;
    address public _AUTH_SIGNER;

    mapping(address => mapping(uint256 => uint256)) public cancelledOrFulfilled;
    mapping(bytes32 => uint256) private _amountTaken;

    uint256[50] private _gap;

    constructor (address authSigner) {
        setAuthSigner(authSigner);
    }

    /// @notice set the auth signer address (only owner can call this method)
    function setAuthSigner(address authSigner) public onlyOwner {
        _AUTH_SIGNER = authSigner;
    }

    /// @notice get the amount taken from a specific offer hash
    function amountTaken(bytes32 offerHash) external view returns (uint256) {
        return _amountTaken[offerHash];
    }

    /// @notice Verifies and takes loan offer
    /// @dev Does not transfer loan and collateral assets; does not update lien hash
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth Signer signature
    /// @param lien Lien preimage
    /// @param lienId Lien id
    function _takeLoanOffer(
        LoanOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        Lien memory lien,
        uint256 lienId
    ) internal {

        /// validate offer signature and parameters
        _validateOffer(
            lien.offerHash,
            offer.lender,
            offerSignature,
            offer.expiration,
            offer.salt
        );

        /// validate loan offer was authenticated
        _validateAuth(
            lien.offerHash, 
            msg.sender, 
            auth, 
            lien, 
            authSignature
        );

        /// revert if rate is above 100% (10_000_000 bp)
        if (offer.rate > _LIQUIDATION_THRESHOLD) {
            revert RateTooHigh();
        }

        /// revert if amount is outside specified range
        if (
            lien.amount > offer.maxAmount ||
            lien.amount < offer.minAmount
        ) {
            revert InvalidLoanAmount();
        }

        /// check if there is sufficient amount left in the offer
        uint256 __amountTaken = _amountTaken[lien.offerHash];
        if (offer.totalAmount - __amountTaken < lien.amount) {
            revert InsufficientOffer();
        }

        /// update amount taken by specific loan offer
        unchecked {
            _amountTaken[lien.offerHash] = __amountTaken + lien.amount;
        }

        /// emit loan event
        emit Loan(
            lien.offerHash,
            lienId,
            lien.lender,
            lien.borrower,
            lien.collateralType,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.currency,
            lien.amount,
            lien.rate,
            lien.duration,
            lien.startTime,
            offer.fees
        );
    }

    /// @notice Verifies and takes borrow offer
    /// @dev Does not transfer loan and collateral assets; does not update lien hash
    /// @param offer Loan offer
    /// @param auth Offer auth
    /// @param offerSignature Lender offer signature
    /// @param authSignature Auth signer signature
    /// @param lien Lien preimage
    /// @param lienId Lien id
    function _takeBorrowOffer(
        BorrowOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        Lien memory lien,
        uint256 lienId
    ) internal {

        /// validate offer signature and parameters
        _validateOffer(
            lien.offerHash,
            offer.borrower,
            offerSignature,
            offer.expiration,
            offer.salt
        );

        /// validate loan offer was authenticated
        _validateAuth(
            lien.offerHash, 
            msg.sender, 
            auth,
            lien, 
            authSignature
        );

        /// revert if rate is above 100% (10_000_000 bp)
        if (offer.rate > _LIQUIDATION_THRESHOLD) {
            revert RateTooHigh();
        }

        /// mark borrow offer as taken
        cancelledOrFulfilled[offer.borrower][offer.salt] = 1;

        /// emit loan event
        emit Loan(
            lien.offerHash,
            lienId,
            lien.lender,
            lien.borrower,
            lien.collateralType,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.currency,
            lien.amount,
            lien.rate,
            lien.duration,
            lien.startTime,
            offer.fees
        );
    }

    /// @notice Verifies and takes renegotiation offer
    /// @dev Does not transfer loan and collateral assets; does not update lien hash
    /// @param offer Renegotiation offer
    /// @param auth Offer auth
    /// @param offerSignature Renegotiation offer signature
    /// @param authSignature Auth signer signature
    /// @param lien Lien preimage
    /// @param lienId Lien id
    function _takeRenegotiationOffer(
        RenegotiationOffer calldata offer,
        OfferAuth calldata auth,
        bytes calldata offerSignature,
        bytes calldata authSignature,
        Lien memory lien,
        uint256 lienId
    ) internal {

        /// validate offer signature and parameters
        _validateOffer(
            lien.offerHash,
            offer.lender,
            offerSignature,
            offer.expiration,
            offer.salt
        );

        /// validate loan offer was authenticated
        _validateAuth(
            lien.offerHash, 
            msg.sender, 
            auth,
            lien, 
            authSignature
        );

        /// revert if rate is above 100% (10_000_000 bp)
        if (offer.newRate > _LIQUIDATION_THRESHOLD) {
            revert RateTooHigh();
        }

        /// mark renegotiation offer as taken
        cancelledOrFulfilled[offer.lender][offer.salt] = 1;

        /// emit loan event
        emit Loan(
            lien.offerHash,
            lienId,
            lien.lender,
            lien.borrower,
            lien.collateralType,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.currency,
            lien.amount,
            lien.rate,
            lien.duration,
            lien.startTime,
            offer.fees
        );
    }

    /// @notice verify offer authorization
    /// @param offerHash Offer hash
    /// @param taker Address of taker
    /// @param auth Offer auth
    /// @param lien Lien preimage
    /// @param signature Packed signature array
    function _validateAuth(
        bytes32 offerHash,
        address taker,
        OfferAuth calldata auth,
        Lien memory lien,
        bytes calldata signature
    ) internal view {

        bytes32 collateralHash = _hashCollateral(
            lien.collateralType,
            lien.collection,
            lien.tokenId,
            lien.size
        );

        bytes32 authHash = _hashOfferAuth(auth);
        _verifyOfferAuthorization(authHash, _AUTH_SIGNER, signature);

        if (auth.expiration < block.timestamp) {
            revert AuthorizationExpired();
        }

        if (auth.taker != taker) {
            revert UnauthorizedTaker();
        }

        if (auth.offerHash != offerHash) {
            revert UnauthorizedOffer();
        }

        if (auth.collateralHash != collateralHash) {
            revert UnauthorizedCollateral();
        }
    }

    /// @notice Assert offer validity
    /// @param offerHash Offer hash
    /// @param signer Address of offer signer
    /// @param signature Packed signature array
    /// @param expiration Offer expiration time
    /// @param salt Offer salt
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

    /// @notice Cancels offer salt for caller
    /// @param salt Unique offer salt
    function cancelOffer(uint256 salt) external {
        _cancelOffer(msg.sender, salt);
    }

    /// @notice Cancels offers in bulk for caller
    /// @param salts List of offer salts
    function cancelOffers(uint256[] calldata salts) external {
        uint256 saltsLength = salts.length;
        for (uint256 i; i < saltsLength; ) {
            _cancelOffer(msg.sender, salts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Cancels all offers by incrementing caller nonce
    function incrementNonce() external {
        _incrementNonce(msg.sender);
    }

    /// @notice Cancel offer by user and salt
    /// @param user Address of user
    /// @param salt Unique offer salt
    function _cancelOffer(address user, uint256 salt) private {
        cancelledOrFulfilled[user][salt] = 1;
        emit OfferCancelled(user, salt);
    }

    /// @notice Cancel all orders by incrementing the user nonce
    /// @param user Address of user
    function _incrementNonce(address user) internal {
        emit NonceIncremented(user, ++nonces[user]);
    }
}
