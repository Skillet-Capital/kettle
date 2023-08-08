import { LienStruct } from "../typechain-types/contracts/Kettle";

export interface Lien {
  lienId: bigint;
  lender: string;
  borrower: string;
  collection: string;
  currency: string;
  tokenId: bigint;
  borrowAmount: bigint;
  startTime: bigint;
  duration: bigint;
  rate: bigint;
}

export interface LienPointer {
  lien: LienStruct;
  lienId: bigint;
}
