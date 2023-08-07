import { MerkleTree } from 'merkletreejs';

import { Fee, LoanOffer, Lien } from "../types";

import { ethers } from "hardhat";

import { hexlify } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';
import { randomBytes } from '@ethersproject/random';
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";

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
  collateralIdentifier: BigNumberish,
  lender: string,
  collection: string,
  currency: string,
  totalAmount: BigNumberish,
  minAmount: BigNumberish,
  maxAmount: BigNumberish,
  duration: BigNumberish,
  rate: BigNumberish,
  expiration: BigNumberish,
  fees: Fee[],
  collateralType?: number
): LoanOffer {
  return {
    lender,
    collection,
    currency,
    collateralType: collateralType ?? 0,
    collateralIdentifier,
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
  lien
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

function generateMerkleRootForCollection(tokenIds: BigNumberish[]): BigNumberish {
  const hashIdentifier = (identifier: BigNumberish) => keccak256(
    Buffer.from(
      BigNumber.from(identifier).toHexString().slice(2).padStart(64, "0"),
      "hex"
    )
  );

  const tree = new MerkleTree(
    tokenIds.map(hashIdentifier), keccak256, {
      sort: true
    }
  );

  return tree.getHexRoot();
}

function generateMerkleProofForToken(tokenIds: BigNumberish[], token: BigNumberish): BigNumberish[] {
  const hashIdentifier = (identifier: BigNumberish) => keccak256(
    Buffer.from(
      BigNumber.from(identifier).toHexString().slice(2).padStart(64, "0"),
      "hex"
    )
  );

  const tree = new MerkleTree(
    tokenIds.map(hashIdentifier), keccak256, {
      sort: true
    }
  );

  const identifier = hashIdentifier(token);
  return tree.getHexProof(identifier);
} 