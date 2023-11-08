import { expect } from "chai";
import {
  time,
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import {
  prepareLoanOffer,
  prepareLoanOfferAuth,
  extractLien,
  extractLiens,
  generateMerkleRootForCollection,
  generateMerkleProofForToken
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC1155,
  TestERC20,
  TestERC721,
  ERC1155EscrowBase,
  ERC721EscrowBase
} from "../typechain-types";
import { LienPointer } from "../types";

const DAY_SECONDS = 24 * 60 * 60;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;

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
      kettle,
      testErc721,
      testErc1155,
      testErc20,
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Grace Period", () => {
    const tokenId1 = 1;
    const tokenId2 = 2;

    const token1Amount = 2;
    const token2Amount = 2;

    const tokenIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const collectionRoot = generateMerkleRootForCollection(tokenIds);

    let tokenOffer: LoanOfferStruct;
    let collectionOffer: LoanOfferStruct;

    let tokenSignature: string;
    let collectionSignature: string;

    let loanAmount: bigint;
    let repaymentAmount: bigint;

    let offerHash: string;
    let collateralHash: string;
    let offerAuth: OfferAuthStruct;
    let authSignature: string;

    beforeEach(async () => {
      loanAmount = ethers.parseEther("10");

      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc1155.mint(borrower, tokenId1, token1Amount);
      await testErc1155.mint(borrower, tokenId2, token2Amount);

      await testErc20.mint(lender, loanAmount);
    });

    describe("Single ERC721 (With Custom Escrow)", () => {
      let lien: LienStruct;
      let lienId: bigint;

      beforeEach(async () => {
        ({ offer: tokenOffer, offerSignature: tokenSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: loanAmount,
            minAmount: 0,
            maxAmount: loanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        ));

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          tokenOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        /* Start Loan */
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          tokenSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          []
        );

        ({ lien, lienId } = await txn.wait().then(
          (receipt) => extractLien(receipt!, kettle)
        ));

        repaymentAmount = await kettle.getRepaymentAmount(
          lien.amount,
          lien.rate,
          lien.duration
        );
  
        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("lien should be expired until grace period is set", async () => {
        expect(await kettle.getGracePeriodForLien(lienId)).to.equal(0);

        // update block timestamp
        await time.setNextBlockTimestamp(BigInt(lien.startTime) + BigInt(lien.duration) + BigInt(1));

        // attempt repay in failure
        await expect(kettle.connect(borrower).repay(
          lien,
          lienId
        )).to.be.revertedWithCustomError(kettle, "LienIsDefaulted");

        // set grace period for lien
        await kettle.setGracePeriodForLien(lienId, DAY_SECONDS * 1);
        expect(await kettle.getGracePeriodForLien(lienId)).to.equal(DAY_SECONDS * 1);

        // attempt repay successfully
        await kettle.connect(borrower).repay(
          lien,
          lienId
        );

        // grace period should be reset
        expect(await kettle.getGracePeriodForLien(lienId)).to.equal(0);
      });
    });
  });
});
