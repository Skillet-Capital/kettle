import { expect } from "chai";
import { 
  time, 
  loadFixture 
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import {
  prepareBorrowOffer,
  prepareBorrowOfferAuth,
  extractLien,
  extractLiens
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

        ({ offer: borrowOffer, offerSignature, offerHash } = await prepareBorrowOffer(
          kettle,
          borrower,
          {
            borrower: borrower,
            collateralType: CollateralType.ERC721,
            tokenId: tokenId1,
            collection: testErc721,
            currency: testErc20,
            amount: loanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        ));

        ({ auth: offerAuth, authSignature } = await prepareBorrowOfferAuth(
          kettle,
          authSigner,
          lender,
          await time.latest() + 100,
          borrowOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));
      });

      it('should start loan', async () => {
        const txn = await kettle.connect(lender).loan(
          borrowOffer, 
          offerAuth,
          offerSignature,
          authSignature
        );

        // extract lien and lien id
        const { lien, lienId } = await txn.wait()
          .then((receipt) => extractLien(receipt!, kettle)
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

        // expect correct lienId
        expect(lienId).to.equal(0);

        // expect lien to have correct info
        expect(lien.offerHash).to.equal(offerHash);
        expect(lien.lender).to.equal(await lender.getAddress());
        expect(lien.borrower).to.equal(await borrower.getAddress());

        // expect lien to have correct collateral
        expect(lien.collateralType).to.equal(CollateralType.ERC721);
        expect(lien.collection).to.equal(await testErc721.getAddress());
        expect(lien.tokenId).to.equal(tokenId1);
        expect(lien.size).to.equal(1);

        // expect lien to be properly formatted payment info
        expect(lien.currency).to.equal(await testErc20.getAddress());
        expect(lien.amount).to.equal(loanAmount);

        expect(lien.duration).to.equal(DAY_SECONDS * 7);
        expect(lien.rate).to.equal(100_000);
      });

      it('should start loans in bulk', async () => {
        await testErc20.mint(lender, loanAmount);

        const { offer: borrowOffer2, offerSignature: offerSignature2, offerHash: offerHash2 } = await prepareBorrowOffer(
          kettle,
          borrower,
          {
            collateralType: CollateralType.ERC721,
            tokenId: tokenId2,
            borrower: borrower,
            collection: testErc721,
            currency: testErc20,
            amount: loanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareBorrowOfferAuth(
          kettle,
          authSigner,
          lender,
          await time.latest() + 100,
          borrowOffer2,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId2,
            size: 1
          }
        );

        const txn = await kettle.connect(lender).loanBatch(
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

        const lienPointers = await txn.wait()
          .then(receipt => extractLiens(receipt!, kettle))

        // expect correct number of lien pointers
        expect(lienPointers).to.have.length(2);

        // expect lien pointers are correct
        const borrowerAddress = await borrower.getAddress();
        const lenderAddress = await lender.getAddress();
        const collectionAddress = await testErc721.getAddress();
        const currencyAddress = await testErc20.getAddress();

        const offerHashes = [offerHash, offerHash2];
        [1, 2].forEach(
          (tokenId, index) => {
            const pointer = lienPointers[index];
            const { lien } = pointer;
            const offerHash = offerHashes[index];

            expect(lien.offerHash).to.equal(offerHash);
            expect(lien.lender).to.equal(lenderAddress);
            expect(lien.borrower).to.equal(borrowerAddress);

            // expect lien to have correct collateral
            expect(lien.collateralType).to.equal(CollateralType.ERC721);
            expect(lien.collection).to.equal(collectionAddress);
            expect(lien.tokenId).to.equal(tokenId);
            expect(lien.size).to.equal(1);

            // expect lien to be properly formatted payment info
            expect(lien.currency).to.equal(currencyAddress);
            expect(lien.amount).to.equal(loanAmount);

            expect(lien.duration).to.equal(DAY_SECONDS * 7);
            expect(lien.rate).to.equal(100_000);
          }
        );
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

      it('should send to kettle with no escrow implementation', async () => {
        const testErc721_2 = await ethers.deployContract("TestERC721");
        await testErc721_2.waitForDeployment();

        await testErc721_2.mint(borrower, tokenId1);
        await testErc721_2.connect(borrower).setApprovalForAll(kettle, true);

        const { offer: borrowOffer2, offerSignature } = await prepareBorrowOffer(
          kettle,
          borrower,
          {
          borrower: borrower,
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721_2,
          currency: testErc20,
          amount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 100_000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        ({ auth: offerAuth, authSignature } = await prepareBorrowOfferAuth(
          kettle,
          authSigner,
          lender,
          await time.latest() + 100,
          borrowOffer2,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721_2,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await kettle.connect(lender).loan(
          borrowOffer2,
          offerAuth,
          offerSignature,
          authSignature
        );

        expect(await testErc721_2.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
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

        ({ offer: borrowOffer, offerSignature, offerHash } = await prepareBorrowOffer(
          kettle,
          borrower,
          {
            borrower: borrower,
            collateralType: CollateralType.ERC1155,
            tokenId: tokenId1,
            size: token1Amount,
            collection: testErc1155,
            currency: testErc20,
            amount: loanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        ));

        ({ auth: offerAuth, authSignature } = await prepareBorrowOfferAuth(
          kettle,
          authSigner,
          lender,
          await time.latest() + 100,
          borrowOffer,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId1,
            size: token1Amount
          }
        ));
      });

      it('should start loan', async () => {
        const txn = await kettle.connect(lender).loan(
          borrowOffer,
          offerAuth,
          offerSignature,
          authSignature
        );

        // expect ownership transfer
        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(token1Amount);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

        // extract lien and lien id
        const { lien, lienId } = await txn.wait()
          .then((receipt) => extractLien(receipt!, kettle)
        );

        // expect correct lienId
        expect(lienId).to.equal(0);

        // expect lien to have correct info
        expect(lien.offerHash).to.equal(offerHash);
        expect(lien.lender).to.equal(await lender.getAddress());
        expect(lien.borrower).to.equal(await borrower.getAddress());

        // expect lien to have correct collateral
        expect(lien.collateralType).to.equal(CollateralType.ERC1155);
        expect(lien.collection).to.equal(await testErc1155.getAddress());
        expect(lien.tokenId).to.equal(tokenId1);
        expect(lien.size).to.equal(token1Amount);

        // expect lien to be properly formatted payment info
        expect(lien.currency).to.equal(await testErc20.getAddress());
        expect(lien.amount).to.equal(loanAmount);

        expect(lien.duration).to.equal(DAY_SECONDS * 7);
        expect(lien.rate).to.equal(100_000);
      });

      it('should start loans in bulk', async () => {
        await testErc20.mint(lender, loanAmount);

        const { offer: borrowOffer2, offerSignature: offerSignature2, offerHash: offerHash2 } = await prepareBorrowOffer(
          kettle,
          borrower,
          {
            borrower: borrower,
            collateralType: CollateralType.ERC1155,
            tokenId: tokenId2,
            size: token2Amount,
            collection: testErc1155,
            currency: testErc20,
            amount: loanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareBorrowOfferAuth(
          kettle,
          authSigner,
          lender,
          await time.latest() + 100,
          borrowOffer2,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId2,
            size: token2Amount
          }
        );

        const txn = await kettle.connect(lender).loanBatch(
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

        const lienPointers = await txn.wait()
        .then(receipt => extractLiens(receipt!, kettle))

      // expect correct number of lien pointers
      expect(lienPointers).to.have.length(2);

      // expect lien pointers are correct
      const borrowerAddress = await borrower.getAddress();
      const lenderAddress = await lender.getAddress();
      const collectionAddress = await testErc1155.getAddress();
      const currencyAddress = await testErc20.getAddress();

      const tokenAmounts = [token1Amount, token2Amount];
      const offerHashes = [offerHash, offerHash2];

      [1, 2].forEach(
        (tokenId, index) => {
          const pointer = lienPointers[index];
          const { lien } = pointer;
          const size = tokenAmounts[index];
          const offerHash = offerHashes[index];

          expect(lien.offerHash).to.equal(offerHash);
          expect(lien.lender).to.equal(lenderAddress);
          expect(lien.borrower).to.equal(borrowerAddress);

          // expect lien to have correct collateral
          expect(lien.collateralType).to.equal(CollateralType.ERC1155);
          expect(lien.collection).to.equal(collectionAddress);
          expect(lien.tokenId).to.equal(tokenId);
          expect(lien.size).to.equal(size);

          // expect lien to be properly formatted payment info
          expect(lien.currency).to.equal(currencyAddress);
          expect(lien.amount).to.equal(loanAmount);

          expect(lien.duration).to.equal(DAY_SECONDS * 7);
          expect(lien.rate).to.equal(100_000);
        }
      );
      });
    });
  });
});
