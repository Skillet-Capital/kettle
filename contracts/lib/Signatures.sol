// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { Fee, LoanOffer, BorrowOffer } from "./Structs.sol";
import { InvalidVParameter, InvalidSignature } from "./Errors.sol";
import { ISignatures } from "../interfaces/ISignatures.sol";

abstract contract Signatures is ISignatures {
    bytes32 private immutable _LOAN_OFFER_TYPEHASH;
    bytes32 private immutable _BORROW_OFFER_TYPEHASH;
    bytes32 private immutable _FEE_TYPEHASH;
    bytes32 private immutable _EIP_712_DOMAIN_TYPEHASH;

    string private constant _NAME = "Kettle";
    string private constant _VERSION = "1";

    mapping(address => uint256) public nonces;
    mapping(address => uint256) public oracles;
    uint256 public blockRange;

    uint256[50] private _gap;

    constructor() {
        (
            _LOAN_OFFER_TYPEHASH,
            _BORROW_OFFER_TYPEHASH,
            _FEE_TYPEHASH,
            _EIP_712_DOMAIN_TYPEHASH
        ) = _createTypehashes();
    }

    function information()
        external
        view
        returns (string memory version, bytes32 domainSeparator)
    {
        version = _VERSION;
        domainSeparator = _hashDomain(
            _EIP_712_DOMAIN_TYPEHASH,
            keccak256(bytes(_NAME)),
            keccak256(bytes(_VERSION))
        );
    }

    function getLoanOfferHash(
        LoanOffer calldata offer
    ) external view returns (bytes32) {
        return _hashLoanOffer(offer);
    }

    function getBorrowOfferHash(
        BorrowOffer calldata offer
    ) external view returns (bytes32) {
        return _hashBorrowOffer(offer);
    }

    /**
     * @notice Generate all EIP712 Typehashes
     */
    function _createTypehashes()
        internal
        pure
        returns (
            bytes32 loanOfferTypehash,
            bytes32 borrowOfferTypehash,
            bytes32 feeTypehash,
            bytes32 eip712DomainTypehash
        )
    {
        eip712DomainTypehash = keccak256(
            bytes.concat(
                "EIP712Domain(",
                "string name,",
                "string version,",
                "uint256 chainId,",
                "address verifyingContract",
                ")"
            )
        );

        bytes memory feeTypestring = bytes.concat(
            "Fee(",
            "uint16 rate,",
            "address recipient"
            ")"
        );

        feeTypehash = keccak256(feeTypestring);

        loanOfferTypehash = keccak256(
            bytes.concat(
                "LoanOffer(",
                "address lender,",
                "address collection,",
                "uint8 collateralType,",
                "uint256 collateralIdentifier,",
                "uint256 collateralAmount,",
                "address currency,",
                "uint256 totalAmount,",
                "uint256 minAmount,",
                "uint256 maxAmount,",
                "uint256 duration,",
                "uint256 rate,",
                "uint256 salt,",
                "uint256 expiration,",
                "Fee[] fees",
                ")",
                feeTypestring
            )
        );

        borrowOfferTypehash = keccak256(
            bytes.concat(
                "BorrowOffer(",
                "address borrower,",
                "address collection,",
                "uint8 collateralType,",
                "uint256 collateralIdentifier,",
                "uint256 collateralAmount,",
                "address currency,",
                "uint256 loanAmount,",
                "uint256 duration,",
                "uint256 rate,",
                "uint256 salt,",
                "uint256 expiration,",
                "Fee[] fees",
                ")",
                feeTypestring
            )
        );
    }

    function _hashDomain(
        bytes32 eip712DomainTypehash,
        bytes32 nameHash,
        bytes32 versionHash
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    eip712DomainTypehash,
                    nameHash,
                    versionHash,
                    block.chainid,
                    address(this)
                )
            );
    }

    function _hashFee(Fee calldata fee) internal view returns (bytes32) {
        return keccak256(abi.encode(_FEE_TYPEHASH, fee.rate, fee.recipient));
    }

    function _packFees(Fee[] calldata fees) internal view returns (bytes32) {
        bytes32[] memory feeHashes = new bytes32[](fees.length);
        uint256 feesLength = fees.length;
        for (uint256 i; i < feesLength; ) {
            feeHashes[i] = _hashFee(fees[i]);
            unchecked {
                ++i;
            }
        }
        return keccak256(abi.encodePacked(feeHashes));
    }

    function _hashLoanOffer(
        LoanOffer calldata offer
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _LOAN_OFFER_TYPEHASH,
                    offer.lender,
                    offer.collection,
                    offer.collateralType,
                    offer.collateralIdentifier,
                    offer.collateralAmount,
                    offer.currency,
                    offer.totalAmount,
                    offer.minAmount,
                    offer.maxAmount,
                    offer.duration,
                    offer.rate,
                    offer.salt,
                    offer.expiration,
                    _packFees(offer.fees)
                )
            );
    }

    function _hashBorrowOffer(
        BorrowOffer calldata offer
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _BORROW_OFFER_TYPEHASH,
                    offer.borrower,
                    offer.collection,
                    offer.collateralType,
                    offer.collateralIdentifier,
                    offer.collateralAmount,
                    offer.currency,
                    offer.loanAmount,
                    offer.duration,
                    offer.rate,
                    offer.salt,
                    offer.expiration,
                    _packFees(offer.fees)
                )
            );
    }

    function _hashToSign(bytes32 hash) internal view returns (bytes32) {
        bytes32 domain = _hashDomain(
            _EIP_712_DOMAIN_TYPEHASH,
            keccak256(bytes(_NAME)),
            keccak256(bytes(_VERSION))
        );

        return keccak256(abi.encodePacked(bytes2(0x1901), domain, hash));
    }

    /**
     * @notice Verify authorization of offer
     * @param offerHash Hash of offer struct
     * @param signer signer address
     * @param signature Packed offer signature (with oracle signature if necessary)
     */
    function _verifyOfferAuthorization(
        bytes32 offerHash,
        address signer,
        bytes calldata signature
    ) internal view {
        bytes32 hashToSign = _hashToSign(offerHash);
        bytes32 r;
        bytes32 s;
        uint8 v;

        // solhint-disable-next-line
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := shr(248, calldataload(add(signature.offset, 0x40)))
        }
        _verify(signer, hashToSign, v, r, s);
    }
    

    /**
     * @notice Verify signature of digest
     * @param signer Address of expected signer
     * @param digest Signature digest
     * @param v v parameter
     * @param r r parameter
     * @param s s parameter
     */
    function _verify(
        address signer,
        bytes32 digest,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure {
        if (v != 27 && v != 28) {
            revert InvalidVParameter();
        }

        address recoveredSigner = ecrecover(digest, v, r, s);
        if (recoveredSigner == address(0) || signer != recoveredSigner) {
            revert InvalidSignature();
        }
    }
}
