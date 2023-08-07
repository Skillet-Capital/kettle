import { MerkleTree } from 'merkletreejs';

import { ethers } from "hardhat";
import { Addressable } from "ethers";

import { hexlify } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';
import { randomBytes } from '@ethersproject/random';
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";

import { Fee, CollateralType } from "../types";
import { FeeStruct, LoanOfferStruct } from '../typechain-types/contracts/Kettle';

export interface LoanOfferParams {
  collateralType?: CollateralType;
  collateralIdentifier: number | string | bigint;
  lender: Addressable;
  collection: Addressable;
  currency: Addressable;
  totalAmount: number | string | bigint;
  minAmount: number | string | bigint;
  maxAmount: number | string | bigint;
  duration: number | string | bigint;
  rate: number | string | bigint;
  expiration: number | string | bigint;
  fees?: FeeStruct[];
}

export async function getLoanOffer(params: LoanOfferParams): Promise<LoanOfferStruct> {
  return {
    lender: await params.lender.getAddress(),
    collection: await params.collection.getAddress(),
    currency: await params.currency.getAddress(),
    collateralType: params?.collateralType ?? CollateralType.ERC721,
    collateralIdentifier: BigInt(params.collateralIdentifier),
    totalAmount: params.totalAmount,
    minAmount: params.minAmount,
    maxAmount: params.maxAmount,
    duration: params.duration,
    rate: params.rate,
    salt: BigInt(hexlify(randomBytes(32))),
    expiration: params.expiration,
    fees: params?.fees ?? []
  }
}

export function getFee(
  rate: bigint,
  recipient: string
): FeeStruct {
  return {
    rate,
    recipient
  }
}

export function generateMerkleRootForCollection(tokenIds: BigNumberish[]): string {
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

export function generateMerkleProofForToken(tokenIds: BigNumberish[], token: BigNumberish): string[] {
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
