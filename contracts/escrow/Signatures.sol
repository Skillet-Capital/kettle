// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { UpdateEscrowAuth } from "../lib/Structs.sol";
import { InvalidVParameter, InvalidSignature } from "../lib/Errors.sol";

contract Signatures {
    bytes32 private immutable _EIP_712_DOMAIN_TYPEHASH;
    bytes32 private immutable _UPDATE_ESCROW_AUTH_TYPEHASH;
    string private constant _NAME = "LendingEscrow";
    string private constant _VERSION = "1";

    error UnauthorizedUpdate();
    error AuthorizationExpired();

    constructor() {
        (   
            _EIP_712_DOMAIN_TYPEHASH,
            _UPDATE_ESCROW_AUTH_TYPEHASH 
        ) = _createTypehashes();
    }

    function _createTypehashes()
        internal
        pure
        returns (
            bytes32 eip712DomainTypehash,
            bytes32 updateEscrowAuthTypehash
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

        updateEscrowAuthTypehash = keccak256(
            "UpdateEscrowAuth(address lender,bytes32 offerHash,uint256 amount,uint256 expiration)"
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

    function _hashUpdateEscrowAuth(
        UpdateEscrowAuth calldata auth
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _UPDATE_ESCROW_AUTH_TYPEHASH,
                    auth.lender,
                    auth.offerHash,
                    auth.amount,
                    auth.expiration
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
     * @param authHash Hash of offer struct
     * @param signer Address of expected signer
     * @param signature Packed offer signature
     */
    function _verifyAuthorization(
        bytes32 authHash,
        address signer,
        bytes calldata signature
    ) internal view {
        bytes32 hashToSign = _hashToSign(authHash);
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
