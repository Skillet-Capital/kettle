import { expect } from "chai";
import {
  time,
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { parseEther } from "ethers";

import { getFixture } from './setup';
import {
  extractLien,
  prepareLoanOffer,
  prepareLoanOfferAuth
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC1155,
  TestERC20,
  TestERC721,
  ERC721EscrowBase,
  ERC1155EscrowBase,
  CollateralVerifier
} from "../typechain-types";
import { LienPointer } from "../types";

const DAY_SECONDS = 24 * 60 * 60;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;
  let feeRecipient: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      authSigner,
      feeRecipient,
      kettle,
      testErc721,
      testErc1155,
      testErc20
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Calculations", () => {
    const tokenId1 = 1;
    const tokenId2 = 2;

    const token1Amount = 2;
    const token2Amount = 2;

    let lien: LienStruct;
    let lienId: bigint;

    let offer: LoanOfferStruct;
    let offerSignature: string;
    let offerHash: string;

    let auth: OfferAuthStruct;
    let authSignature: string;

    let loanAmount: bigint;
    let repaymentAmount: bigint;

    beforeEach(async () => {
      loanAmount = ethers.parseEther("10");

      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc1155.mint(borrower, tokenId1, token1Amount);
      await testErc1155.mint(borrower, tokenId2, token2Amount);

      await testErc20.mint(lender, loanAmount);
    });


    it('should calculate repayment and fee precisely', async () => {
      expect(await testErc20.balanceOf(lender)).to.equal(loanAmount);
      expect(await testErc20.balanceOf(borrower)).to.equal(0);

      // construct offer and signature
      ({ offer, offerSignature, offerHash } = await prepareLoanOffer(
        kettle,
        lender,
        {
          collateralType: CollateralType.ERC721,
          identifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: loanAmount,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 365,
          rate: 100_000,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: [{
            rate: 25_000,
            recipient: await feeRecipient.getAddress()
          }]
      }));

      // construct auth and signature
      ({ auth, authSignature } = await prepareLoanOfferAuth(
        kettle,
        authSigner,
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        offer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      ));

      // start loan
      let txn = await kettle.connect(borrower).borrow(
        offer,
        auth,
        offerSignature,
        authSignature,
        loanAmount,
        tokenId1,
        ADDRESS_ZERO,
        []
      );

      // extract lien and lien id
      ({ lien, lienId } = await txn.wait().then(
        (receipt) => extractLien(receipt!, kettle)
      ));

      // expect lien to have correct rate and duration
      expect(lien.rate).to.equal(100_000);
      expect(lien.duration).to.equal(DAY_SECONDS * 365);
      expect(lien.amount).to.equal(loanAmount);

      // calculate repayment amount
      const repaymentAmount = await kettle.getRepaymentAmount(
        loanAmount,
        lien.rate,
        lien.duration
      );

      // expect interest amount to be 1 eth
      expect(repaymentAmount - loanAmount).to.equal(parseEther("1"))

      // expect net borrow amount to be precise
      const netBorrowAmount = loanAmount - (loanAmount * 25_000n) / 1_000_000n;
      expect(await testErc20.balanceOf(borrower)).to.equal(netBorrowAmount)
    })
  });
});
