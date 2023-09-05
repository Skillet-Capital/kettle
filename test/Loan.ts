import { expect } from "chai";
import { 
  time, 
  loadFixture 
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { 
  getBorrowOffer,
  signBorrowOffer
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { BorrowOfferStruct } from "../typechain-types/contracts/Kettle";
import { 
  Kettle, 
  TestERC20, 
  TestERC721, 
  TestERC1155,
  ERC721EscrowBase,
  ERC1155EscrowBase
} from "../typechain-types";

const DAY_SECONDS = 24 * 60 * 60;

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;
  let erc721Escrow: ERC721EscrowBase;
  let erc1155Escrow: ERC1155EscrowBase;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      kettle,
      testErc721,
      testErc1155,
      testErc20,
      erc721Escrow,
      erc1155Escrow
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Loan", () => {

    const tokenId1 = 1;
    const tokenId2 = 2;

    const token1Amount = 2;
    const token2Amount = 2;

    const loanAmount = ethers.parseEther("10");

    beforeEach(async () => {
      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc1155.mint(borrower, tokenId1, token1Amount);
      await testErc1155.mint(borrower, tokenId2, token2Amount);

      await testErc20.mint(lender, loanAmount);
    });

    describe("collateralType === ERC721", () => {
      let borrowOffer: BorrowOfferStruct;
      let signature: string;

      beforeEach(async () => {

        borrowOffer = await getBorrowOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          borrower: borrower,
          collection: testErc721,
          currency: testErc20,
          loanAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        signature = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer
        );
      });

      it('should start loan', async () => {
        await kettle.connect(lender).loan(
          borrowOffer, 
          signature
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk', async () => {
        await testErc20.mint(lender, loanAmount);

        const borrowOffer2 = await getBorrowOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId2,
          borrower: borrower,
          collection: testErc721,
          currency: testErc20,
          loanAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const signature2 = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer2
        );

        await kettle.connect(lender).loanBatch(
          [
            { 
              offer: borrowOffer, 
              signature: signature 
            },
            {
              offer: borrowOffer2,
              signature: signature2
            }
          ]
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount * BigInt(2));
      });

      it('should reject if borrow offer taken', async () => {
        await kettle.connect(lender).loan(
          borrowOffer, 
          signature
        );

        await expect(kettle.connect(lender).loan(
          borrowOffer, 
          signature
        )).to.be.revertedWithCustomError(kettle, "OfferUnavailable")
      });

      it('should reject if borrow offer cancelled', async () => {
        await kettle.connect(borrower).cancelOffers([borrowOffer.salt]);

        await expect(kettle.connect(lender).loan(
          borrowOffer, 
          signature
        )).to.be.revertedWithCustomError(kettle, "OfferUnavailable")
      });

      it('should reject if borrow offer expired', async () => {
        await time.setNextBlockTimestamp(BigInt(borrowOffer.expiration) + BigInt(1));

        await expect(kettle.connect(lender).loan(
          borrowOffer, 
          signature
        )).to.be.revertedWithCustomError(kettle, "OfferExpired")
      });

      it('should reject with no escrow implementation', async () => {
        const testErc721_2 = await ethers.deployContract("TestERC721");
        await testErc721_2.waitForDeployment();

        const borrowOffer2 = await getBorrowOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          borrower: borrower,
          collection: testErc721_2,
          currency: testErc20,
          loanAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const signature2 = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer2
        );

        await expect(kettle.connect(lender).loan(
          borrowOffer2, 
          signature2
        )).to.be.revertedWithCustomError(kettle, "NoEscrowImplementation");
      });
    });

    describe("collateralType === ERC1155", () => {
      let borrowOffer: BorrowOfferStruct;
      let signature: string;

      beforeEach(async () => {

        borrowOffer = await getBorrowOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: tokenId1,
          collateralAmount: token1Amount,
          borrower: borrower,
          collection: testErc1155,
          currency: testErc20,
          loanAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        signature = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer
        );
      });

      it('should start loan', async () => {
        await kettle.connect(lender).loan(
          borrowOffer, 
          signature
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(token1Amount);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk', async () => {
        await testErc20.mint(lender, loanAmount);

        const borrowOffer2 = await getBorrowOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: tokenId2,
          collateralAmount: token2Amount,
          borrower: borrower,
          collection: testErc1155,
          currency: testErc20,
          loanAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const signature2 = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer2
        );

        await kettle.connect(lender).loanBatch(
          [
            { 
              offer: borrowOffer, 
              signature
            },
            {
              offer: borrowOffer2,
              signature: signature2
            }
          ]
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(token1Amount);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        
        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId2)).to.equal(token2Amount);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount * BigInt(2));
      });
    });
  });
});
