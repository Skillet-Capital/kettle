import { BigNumberish } from "ethers";

export interface Fee {
  rate: BigNumberish;
  recipient: string;
}

export interface LoanOffer {
  lender: string;
  collection: string;
  currency: string;
  collateralType: number;
  collateralIdentifier: BigNumberish;
  totalAmount: BigNumberish;
  minAmount: BigNumberish;
  maxAmount: BigNumberish;
  duration: BigNumberish;
  rate: BigNumberish;
  expiration: BigNumberish;
  salt: BigNumberish;
  fees: Fee[];
}