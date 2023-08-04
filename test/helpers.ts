import { BaseWallet, Addressable, BigNumberish } from "ethers";
import { Fee, LoanOffer, Lien } from "../types";

import { ethers } from "hardhat";
import { hexlify, randomBytes, Result } from "ethers";
import { LienStructOutput, LoanOfferTakenEvent } from "../typechain-types/contracts/Kettle";

export async function getLatestTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block?.timestamp ?? 0;
}

export function getFee(
  rate: number,
  recipient: string
): Fee {
  return {
    rate,
    recipient
  }
}

export function getLoanOffer(
  lender: string,
  collection: string,
  currency: string,
  totalAmount: BigNumberish,
  minAmount: BigNumberish,
  maxAmount: BigNumberish,
  duration: BigNumberish,
  rate: BigNumberish,
  expiration: BigNumberish,
  fees: Fee[]
): LoanOffer {
  return {
    lender,
    collection,
    currency,
    totalAmount: totalAmount.toString(),
    minAmount: minAmount.toString(),
    maxAmount: maxAmount.toString(),
    duration,
    rate,
    salt: hexlify(randomBytes(32)),
    expiration,
    fees
  }
}

export function formatLien(
  lien: Result
): Lien {
  return {
    lienId: lien.lienId,
    lender: lien.lender,
    borrower: lien.borrower,
    collection: lien.collection,
    currency: lien.currency,
    tokenId: lien.tokenId,
    borrowAmount: lien.borrowAmount,
    startTime: lien.startTime,
    duration: lien.duration,
    rate: lien.rate
  }
}
