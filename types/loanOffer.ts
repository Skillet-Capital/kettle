import { BigNumberish } from "ethers";

export enum CollateralType {
  ERC721 = 0,
  ERC1155 = 1,
  ERC721_WITH_CRITERIA = 2,
  ERC1155_WITH_CRITERIA = 3
}

export interface Fee {
  rate: BigInt;
  recipient: string;
}

export interface LoanOffer {
  lender: string;
  collection: string;
  currency: string;
  collateralType: CollateralType;
  collateralIdentifier: BigInt;
  totalAmount: BigInt;
  minAmount: BigInt;
  maxAmount: BigInt;
  duration: BigInt;
  rate: BigInt;
  expiration: BigInt;
  salt: BigInt;
  fees: Fee[];
}
