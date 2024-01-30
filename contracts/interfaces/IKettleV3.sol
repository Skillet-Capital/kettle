// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Fee } from "../lib/Structs.sol";
import { IKettle } from "./IKettle.sol";

interface IKettleV3 is IKettle {
    
    event LoanV3(
        uint256 lienId,
        address lender,
        address borrower,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 installments,
        uint256 period,
        uint256 rate,
        uint256 amount,
        uint256 defaultPeriod,
        uint256 defaultRate,
        uint256 startTime,
        Fee[] fees
    );

    event InstallmentV3(
        uint256 lienId,
        uint256 installment,
        bool inDefault
    );

    event RepayV3(
        uint256 lienId,
        address payer,
        uint256 installment,
        bool inDefault
    );

    event ClaimV3(
        uint256 lienId,
        address lender,
        uint256 installment
    );
}
