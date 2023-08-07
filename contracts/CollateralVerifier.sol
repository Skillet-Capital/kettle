// SPDX-License-Identifier: Skillet
pragma solidity 0.8.19;

import "./lib/Structs.sol";
import "./lib/Errors.sol";

library CollateralVerifier {

  function verifyCollateral(
    CollateralType collateralType,
    uint256 collateralRoot,
    uint256 tokenId,
    bytes32[] calldata proof
  ) public pure {
    if (collateralType == CollateralType.ERC721 || collateralType == CollateralType.ERC1155) {
      if (tokenId != collateralRoot) {
        revert InvalidCollateral();
      }
      return;
    }

    bytes32 computedRoot = processProofCalldata(proof, bytes32(tokenId));
    if (computedRoot != bytes32(collateralRoot)) {
      revert InvalidCollateralCriteria();
    }
  }

  function processProofCalldata(
    bytes32[] calldata proof,
    bytes32 leaf
  ) internal pure returns (bytes32) {
      bytes32 computedHash = keccak256(abi.encode(leaf));
      for (uint256 i = 0; i < proof.length; i++) {
          computedHash = _hashPair(computedHash, proof[i]);
      }
      return computedHash;
  }

  function _hashPair(bytes32 a, bytes32 b)
    private
    pure
    returns(bytes32)
  {
    return a < b ? _efficientHash(a, b) : _efficientHash(b, a);
  }

  function _efficientHash(bytes32 a, bytes32 b)
    private
    pure
    returns (bytes32 value)
  {
    assembly {
      mstore(0x00, a)
      mstore(0x20, b)
      value := keccak256(0x00, 0x40)
    }
  }
}