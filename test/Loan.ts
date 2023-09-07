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
  signBorrowOffer,
  hashCollateral,
  signOfferAuth
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { BorrowOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
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
  let authSigner: Signer;

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
      authSigner,
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
      let offerSignature: string;

      let offerHash: string;
      let collateralHash: string;
      let offerAuth: OfferAuthStruct;
      let authSignature: string;

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
        
        offerSignature = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer
        );

        offerHash = await kettle.getBorrowOfferHash(borrowOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC721,
          testErc721,
          tokenId1,
          1
        );

        offerAuth = {
          offerHash,
          taker: await lender.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );
      });

      it('should start loan', async () => {
        await kettle.connect(lender).loan(
          borrowOffer, 
          offerAuth,
          offerSignature,
          authSignature
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

        const offerSignature2 = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer2
        );

        const offerHash2 = await kettle.getBorrowOfferHash(borrowOffer2);

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC721,
          testErc721,
          tokenId2,
          1
        );

        const offerAuth2 = {
          offerHash: offerHash2,
          taker: await lender.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        await kettle.connect(lender).loanBatch(
          [
            { 
              offer: borrowOffer, 
              offerSignature,
            },
            {
              offer: borrowOffer2,
              offerSignature: offerSignature2,
            }
          ],
          [
            {
              offerIndex: 0,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 1,
              auth: offerAuth2,
              authSignature: authSignature2
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
          offerAuth,
          offerSignature,
          authSignature
        );

        await expect(kettle.connect(lender).loan(
          borrowOffer,
          offerAuth,
          offerSignature,
          authSignature
        )).to.be.revertedWithCustomError(kettle, "OfferUnavailable")
      });

      it('should reject if borrow offer cancelled', async () => {
        await kettle.connect(borrower).cancelOffers([borrowOffer.salt]);

        await expect(kettle.connect(lender).loan(
          borrowOffer,
          offerAuth,
          offerSignature,
          authSignature
        )).to.be.revertedWithCustomError(kettle, "OfferUnavailable")
      });

      it('should reject if borrow offer expired', async () => {
        await time.setNextBlockTimestamp(BigInt(borrowOffer.expiration) + BigInt(1));

        await expect(kettle.connect(lender).loan(
          borrowOffer,
          offerAuth,
          offerSignature,
          authSignature
        )).to.be.revertedWithCustomError(kettle, "OfferExpired")
      });

      it('should reject if offer auth expired', async () => {
        await time.setNextBlockTimestamp(BigInt(offerAuth.expiration) + BigInt(1));

        await expect(kettle.connect(lender).loan(
          borrowOffer,
          offerAuth,
          offerSignature,
          authSignature
        )).to.be.revertedWithCustomError(kettle, "AuthorizationExpired")
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

        const offerSignature2 = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer2
        );

        const offerHash2 = await kettle.getBorrowOfferHash(borrowOffer2);

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC721,
          testErc721_2,
          tokenId1,
          1
        );

        const offerAuth2 = {
          offerHash: offerHash2,
          taker: await lender.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        await expect(kettle.connect(lender).loan(
          borrowOffer2,
          offerAuth2,
          offerSignature2,
          authSignature2
        )).to.be.revertedWithCustomError(kettle, "NoEscrowImplementation");
      });
    });

    describe("collateralType === ERC1155", () => {
      let borrowOffer: BorrowOfferStruct;
      let offerSignature: string;

      let offerHash: string;
      let collateralHash: string;
      let offerAuth: OfferAuthStruct;
      let authSignature: string;

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

        offerSignature = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer
        );

        offerHash = await kettle.getBorrowOfferHash(borrowOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC1155,
          testErc1155,
          tokenId1,
          token1Amount
        );

        offerAuth = {
          offerHash,
          taker: await lender.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );
      });

      it('should start loan', async () => {
        await kettle.connect(lender).loan(
          borrowOffer,
          offerAuth,
          offerSignature,
          authSignature
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

        const offerSignature2 = await signBorrowOffer(
          kettle,
          borrower,
          borrowOffer2
        );

        const offerHash2 = await kettle.getBorrowOfferHash(borrowOffer2);

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC1155,
          testErc1155,
          tokenId2,
          token2Amount
        );

        const offerAuth2 = {
          offerHash: offerHash2,
          taker: await lender.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        await kettle.connect(lender).loanBatch(
          [
            { 
              offer: borrowOffer,
              offerSignature,
            },
            {
              offer: borrowOffer2,
              offerSignature: offerSignature2,
            }
          ],
          [
            {
              offerIndex: 0,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 1,
              auth: offerAuth2,
              authSignature: authSignature2
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
