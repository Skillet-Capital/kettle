// SPDX-License-Identifier: BSL 1.1 - Blend (c) Non Fungible Trading Ltd.
pragma solidity 0.8.19;

import "solmate/src/utils/SignedWadMath.sol";

import "./lib/Errors.sol";
import "./lib/Structs.sol";
import "./interfaces/IConduit.sol";

library Helpers {
    int256 private constant _YEAR_WAD = 365 days * 1e18;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private constant _BASIS_POINTS = 10_000;

    function getCollateralType(
      uint8 _collateralType
    ) external pure returns (uint8) {
      CollateralType collateralType = CollateralType(_collateralType);

      if (collateralType == CollateralType.ERC721 || collateralType == CollateralType.ERC721_WITH_CRITERIA) {
        return uint8(ConduitItemType.ERC721);
      } else if (collateralType == CollateralType.ERC1155 || collateralType == CollateralType.ERC1155_WITH_CRITERIA) {
        return uint8(ConduitItemType.ERC1155);
      }
      revert InvalidCollateralType();
    }

    function bipsToSignedWads(uint256 bips) public pure returns (int256) {
      return int256((bips * 1e18) / _BASIS_POINTS);
    }

    function computeCurrentDebt(
      uint256 amount,
      uint256 rate,
      uint256 duration
    ) public pure returns (uint256) {
      int256 yearsWad = wadDiv(int256(duration) * 1e18, _YEAR_WAD);
      return amount + uint256(wadMul(int256(amount), wadMul(yearsWad, bipsToSignedWads(rate))));
    }

    function computeAmountAfterFees(
      uint256 amount,
      Fee[] memory fees
    ) public pure returns (uint256) {
      for (uint256 i = 0; i < fees.length; i++) {
        amount = amount - computeFeeAmount(amount, fees[i].rate);
      }
      return amount;
    }

    function computeFeeAmount(
      uint256 amount,
      uint16 rate
    ) public pure returns (uint256) {
      return (amount * rate) / _BASIS_POINTS;
    }
}
