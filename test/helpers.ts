import { MerkleTree } from 'merkletreejs';

import { ethers } from "hardhat";
import { Addressable, Signer } from "ethers";

import { hexlify } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';
import { randomBytes } from '@ethersproject/random';
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";

import { Fee, CollateralType } from "../types";
import { BorrowOfferStruct, FeeStruct, LienStruct, LoanOfferStruct } from '../typechain-types/contracts/Kettle';

export interface LoanOfferParams {
  collateralType?: CollateralType;
  collateralIdentifier: number | string | bigint;
  collateralAmount?: number | string | bigint;
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
    collateralAmount: params?.collateralAmount ?? 1,
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

export interface BorrowOfferParams {
  collateralType?: CollateralType;
  collateralIdentifier: number | string | bigint;
  collateralAmount?: number | string | bigint;
  borrower: Addressable;
  collection: Addressable;
  currency: Addressable;
  loanAmount: number | string | bigint;
  duration: number | string | bigint;
  rate: number | string | bigint;
  expiration: number | string | bigint;
  fees?: FeeStruct[];
}

export async function getBorrowOffer(params: BorrowOfferParams): Promise<BorrowOfferStruct> {
  return {
    borrower: await params.borrower.getAddress(),
    collection: await params.collection.getAddress(),
    currency: await params.currency.getAddress(),
    collateralType: params?.collateralType ?? CollateralType.ERC721,
    collateralIdentifier: BigInt(params.collateralIdentifier),
    collateralAmount: params?.collateralAmount ?? 1,
    loanAmount: params.loanAmount,
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

export function formatLien(
  lender: string,
  borrower: string,
  collateralType: string | number | bigint,
  collection: string,
  tokenId: string | number | bigint,
  amount: string | number | bigint,
  currency: string,
  borrowAmount: string | number | bigint,
  duration: string | number | bigint,
  rate: string | number | bigint,
  startTime: string | number | bigint
): LienStruct {
  return {
    lender,
    borrower,
    collateralType,
    collection,
    tokenId: BigInt(tokenId),
    amount,
    currency,
    borrowAmount,
    duration,
    rate,
    startTime
  }
}

export async function signLoanOffer(
  kettle: Addressable,
  lender: Signer,
  loanOffer: LoanOfferStruct 
) {
  const domain = {
    name: 'Kettle',
    version: '1',
    chainId: 1,
    verifyingContract: await kettle.getAddress()
  }

  const types = {
    Fee: [
      { name: 'rate', type: 'uint16' },
      { name: 'recipient', type: 'address' }
    ],
    LoanOffer: [
      { name: 'lender', type: 'address' },
      { name: 'collection', type: 'address' },
      { name: 'collateralType', type: 'uint8' },
      { name: 'collateralIdentifier', type: 'uint256' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'currency', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'minAmount', type: 'uint256' },
      { name: 'maxAmount', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
      { name: 'rate', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
      { name: 'expiration', type: 'uint256' },
      { name: 'fees', type: 'Fee[]' }
    ]
  }

  return await lender.signTypedData(domain, types, loanOffer);
}

export async function signBorrowOffer(
  kettle: Addressable,
  borrower: Signer,
  borrowOffer: BorrowOfferStruct 
) {
  const domain = {
    name: 'Kettle',
    version: '1',
    chainId: 1,
    verifyingContract: await kettle.getAddress()
  }

  const types = {
    Fee: [
      { name: 'rate', type: 'uint16' },
      { name: 'recipient', type: 'address' }
    ],
    BorrowOffer: [
      { name: 'borrower', type: 'address' },
      { name: 'collection', type: 'address' },
      { name: 'collateralType', type: 'uint8' },
      { name: 'collateralIdentifier', type: 'uint256' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'currency', type: 'address' },
      { name: 'loanAmount', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
      { name: 'rate', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
      { name: 'expiration', type: 'uint256' },
      { name: 'fees', type: 'Fee[]' }
    ]
  }

  return await borrower.signTypedData(domain, types, borrowOffer);
}
