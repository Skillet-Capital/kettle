import { BigNumberish } from "ethers";

export interface Lien {
  lender: string;
  borrower: string;
  collection: string;
  currency: string;
  tokenId: BigNumberish;
  borrowAmount: BigNumberish;
  repayAmount: BigNumberish;
  startTime: BigNumberish;
  duration: BigNumberish;
  rate: BigNumberish;
}
