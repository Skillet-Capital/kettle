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
  generateMerkleProofForToken,
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC1155,
  TestERC20,
  TestERC721,
  CollateralVerifier
} from "../typechain-types";
import { LienPointer } from "../types";

const DAY_SECONDS = 24 * 60 * 60;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;
  let signers: Signer[];

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;

  let verifier: CollateralVerifier;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      authSigner,
      signers,
      kettle,
      testErc721,
      testErc1155,
      testErc20,
      verifier
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Refinance", () => {
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

    describe("Single ERC721", () => {
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

        // expect ownership transfer
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());

        ({ lien, lienId } = await txn.wait().then(
          async (receipt) => extractLien(receipt!, kettle)
        ));

        repaymentAmount = await kettle.getRepaymentAmount(
          lien.amount,
          lien.rate,
          lien.duration
        );

        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("should refinance single loan (lower principal)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount / 2n;

        const { offer: refinanceOffer, offerSignature: refinanceSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should refinance single loan (higher principal)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount * 2n;

        const { offer: refinanceOffer, offerSignature: refinanceSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should refinance single loan (from token to criteria offer)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = repaymentAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: collectionRoot,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        const tokenProof = generateMerkleProofForToken(tokenIds, tokenId1)
        await kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          tokenProof
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it('should reject if collateral is invalid', async () => {
        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId2,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it('should reject if loanAmount is higher than maxAmount', async () => {
        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount * 2n,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "InvalidLoanAmount");
      });

      it('should reject if sender is not borrower', async () => {
        const [signer] = signers;
        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId2,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(signer).refinance(
          lien,
          lienId,
          newLoanAmount * 2n,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "Unauthorized");
      });

      it('should reject if lien is invalid (InvalidLien)', async () => {
        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinance(
          lien,
          1,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "InvalidLien");
      });

      it('should reject if lien is defaulted (LienIsDefaulted)', async () => {
        time.setNextBlockTimestamp(BigInt(lien.startTime) + BigInt(lien.duration) + 1n);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "LienIsDefaulted");
      });

      it('should reject if lien is collections do not match (CollectionsDoNotMatch)', async () => {
        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: ethers.Wallet.createRandom(),
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "CollectionsDoNotMatch");
      });

      it('should reject if lien is currencies do not match (CurrenciesDoNotMatch)', async () => {
        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: ethers.Wallet.createRandom(),
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "CurrenciesDoNotMatch");
      });

      it('should reject if lien is collateral amounts do not match (InvalidCollateralSize)', async () => {
        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 2,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "InvalidCollateralSize");
      });
    });

    describe("Batch ERC721", () => {
      let lienPointers: LienPointer[];

      beforeEach(async () => {
        ({ offer: collectionOffer, offerSignature: collectionSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: collectionRoot,
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

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          collectionOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        const{ auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          collectionOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId2,
            size: 1
          }
        );

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        const txn = await kettle.connect(borrower).borrowBatch(
          [{ offer: collectionOffer, offerSignature: collectionSignature }],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: 1,
              proof: proof1,
              auth: offerAuth,
              authSignature
            },
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: 2,
              proof: proof2,
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        lienPointers = await txn.wait().then(
          async (receipt) => extractLiens(receipt!, kettle)
        );

        const repayments = await Promise.all(
          lienPointers.map(
            async (lienPointer) => kettle.getRepaymentAmount(
              lienPointer.lien.amount,
              lienPointer.lien.rate,
              lienPointer.lien.duration
            )
          )
        );

        repaymentAmount = repayments.reduce(
          (totalRepayment, repayment) => totalRepayment + repayment,
          BigInt(0)
        );

        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("should refinance batch criteria loans with single criteria refinance offer (lower amounts)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: collectionRoot,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId2,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).refinanceBatch(
          [{ offer: refinanceOffer, offerSignature: refinanceSignature }],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1),
              auth: offerAuth,
              authSignature
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2),
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ]
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should refinance batch criteria loans with single criteria refinance offer (higher amounts)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount * 4n;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: collectionRoot,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId2,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).refinanceBatch(
          [{ offer: refinanceOffer, offerSignature: refinanceSignature }],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1),
              auth: offerAuth,
              authSignature
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2),
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ]
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should refinance batch criteria loans with individual token refinance offers", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount * 2n;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { offer: refinanceOffer2, offerSignature: refinanceSignature2 } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId2,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer2,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId2,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).refinanceBatch(
          [
            { offer: refinanceOffer, offerSignature: refinanceSignature },
            { offer: refinanceOffer2, offerSignature: refinanceSignature2 }
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: [],
              auth: offerAuth,
              authSignature
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              offerIndex: 1,
              amount: newLoanAmount / 2n,
              proof: [],
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ]
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should reject if sender is not borrower", async () => {
        const [signer] = signers;

        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(signer).refinanceBatch(
          [
            { offer: refinanceOffer, offerSignature: refinanceSignature },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1),
              auth: offerAuth,
              authSignature: authSignature
            }
          ]
        )).to.be.revertedWithCustomError(kettle, "Unauthorized");
      });

      it("should reject if collateral is invalid (InvalidCollateral)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId2,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinanceBatch(
          [
            { offer: refinanceOffer, offerSignature: refinanceSignature },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1),
              auth: offerAuth,
              authSignature
            }
          ]
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it("should reject if collateral is invalid (InvalidCollateralCriteria)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: collectionRoot,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinanceBatch(
          [
            { offer: refinanceOffer, offerSignature: refinanceSignature },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2),
              auth: offerAuth,
              authSignature
            }
          ]
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      });

      it("should reject if lien is invalid (InvalidLien)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: collectionRoot,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinanceBatch(
          [
            { offer: refinanceOffer, offerSignature: refinanceSignature },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: 1,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1),
              auth: offerAuth,
              authSignature
            }
          ]
        )).to.be.revertedWithCustomError(kettle, "InvalidLien");
      });

      it("should reject if lien is expired (LienIsDefaulted)", async () => {
        time.setNextBlockTimestamp(BigInt(lienPointers[0].lien.startTime) + BigInt(lienPointers[0].lien.duration) + 1n);

        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: collectionRoot,
            size: 1,
            collection: testErc721,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        await expect(kettle.connect(borrower).refinanceBatch(
          [
            { offer: refinanceOffer, offerSignature: refinanceSignature },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1),
              auth: offerAuth,
              authSignature
            }
          ]
        )).to.be.revertedWithCustomError(kettle, "LienIsDefaulted");
      });
    });

    describe("Single ERC1155", () => {
      let lien: LienStruct;
      let lienId: bigint;

      beforeEach(async () => {
        ({ offer: tokenOffer, offerSignature: tokenSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC1155,
            identifier: tokenId1,
            size: token1Amount,
            collection: testErc1155,
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
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId1,
            size: token1Amount
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
          async (receipt) => extractLien(receipt!, kettle)
        ));

        repaymentAmount = await kettle.getRepaymentAmount(
          lien.amount,
          lien.rate,
          lien.duration
        );

        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("should refinance single loan (lower amount)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount / 2n;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC1155,
            identifier: tokenId1,
            size: token1Amount,
            collection: testErc1155,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId1,
            size: token1Amount
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should reject if offer amount is different than lien amount (InvalidCollateralSize)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount / 2n;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC1155,
            identifier: tokenId1,
            size: 1,
            collection: testErc1155,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId1,
            size: token1Amount
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await expect(kettle.connect(borrower).refinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          offerAuth,
          refinanceSignature,
          authSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "InvalidCollateralSize")
      });
    });

    describe("Batch ERC1155", () => {
      let lienPointers: LienPointer[];

      beforeEach(async () => {
        ({ offer: collectionOffer, offerSignature: collectionSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC1155_WITH_CRITERIA,
            identifier: collectionRoot,
            size: token1Amount,
            collection: testErc1155,
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
          collectionOffer,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId1,
            size: token1Amount
          }
        ));

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          collectionOffer,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId2,
            size: token2Amount
          }
        );

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        const txn = await kettle.connect(borrower).borrowBatch(
          [{ offer: collectionOffer, offerSignature: collectionSignature }],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId1,
              proof: proof1,
              auth: offerAuth,
              authSignature
            },
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId2,
              proof: proof2,
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        lienPointers = await txn.wait().then(
          async (receipt) => extractLiens(receipt!, kettle)
        );

        expect(await testErc1155.balanceOf(kettle, tokenId1)).to.equal(token1Amount);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);

        expect(await testErc1155.balanceOf(kettle, tokenId2)).to.equal(token2Amount);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

        const repayments = await Promise.all(
          lienPointers.map(
            async (lienPointer) => kettle.getRepaymentAmount(
              lienPointer.lien.amount,
              lienPointer.lien.rate,
              lienPointer.lien.duration
            )
          )
        );

        repaymentAmount = repayments.reduce(
          (totalRepayment, repayment) => totalRepayment + repayment,
          BigInt(0)
        );

        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("should refinance batch loans", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const { offer: refinanceOffer, offerSignature: refinanceSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC1155_WITH_CRITERIA,
            identifier: collectionRoot,
            size: token1Amount,
            collection: testErc1155,
            currency: testErc20,
            totalAmount: newLoanAmount,
            minAmount: 0,
            maxAmount: newLoanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId1,
            size: token1Amount
          }
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId2,
            size: token2Amount
          }
        );

        await testErc20.mint(lender, newLoanAmount);
        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).refinanceBatch(
          [{ offer: refinanceOffer, offerSignature: refinanceSignature }],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1),
              auth: offerAuth,
              authSignature
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              offerIndex: 0,
              amount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2),
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ]
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });
    });
  });
});
