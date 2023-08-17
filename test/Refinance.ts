import { expect } from "chai";
import {
  time,
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import {
  formatLien,
  getLoanOffer,
  signLoanOffer,
  generateMerkleRootForCollection,
  generateMerkleProofForToken
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC1155,
  TestERC20,
  TestERC721,
  ERC1155EscrowBase,
  CollateralVerifier
} from "../typechain-types";
import { LienPointer } from "../types";

const DAY_SECONDS = 24 * 60 * 60;

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;

  let verifier: CollateralVerifier;
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
      erc1155Escrow,
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
        tokenOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        tokenSignature = await signLoanOffer(kettle, lender, tokenOffer);

        /* Start Loan */
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          tokenSignature,
          loanAmount,
          tokenId1,
          []
        );

        ({ lien, lienId } = await txn.wait().then(
          async (receipt) => {
            const kettleAddres = await kettle.getAddress();
            const lienLog = receipt!.logs!.find(
              (log) => (log.address === kettleAddres)
            )!;
  
            const parsedLog = kettle.interface.decodeEventLog("LoanOfferTaken", lienLog!.data, lienLog!.topics);
            return {
              lienId: parsedLog.lienId,
              lien: formatLien(
                parsedLog.lender,
                parsedLog.borrower,
                parsedLog.collateralType,
                parsedLog.collection,
                parsedLog.tokenId,
                parsedLog.amount,
                parsedLog.currency,
                parsedLog.borrowAmount,
                parsedLog.duration,
                parsedLog.rate,
                parsedLog.startTime
              )
            }
          }));

        repaymentAmount = await kettle.getRepaymentAmount(
          lien.borrowAmount,
          lien.rate,
          lien.duration
        );
  
        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("should refinance single loan (lower principal)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount / 2n;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          []
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should refinance single loan (higher principal)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount * 2n;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          []
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should refinance single loan (from token to criteria offer)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = repaymentAmount;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        const tokenProof = generateMerkleProofForToken(tokenIds, tokenId1)
        await kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          tokenProof
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it('should reject if collateral is invalid', async () => {
        const newLoanAmount = loanAmount;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId2,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          []
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it('should reject if loanAmount is higher than maxAmount', async () => {
        const newLoanAmount = loanAmount;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount * 2n,
          refinanceOffer,
          refinanceSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "InvalidLoanAmount");
      });

      it('should reject if sender is not borrower', async () => {
        const newLoanAmount = loanAmount;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(lender).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount * 2n,
          refinanceOffer,
          refinanceSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "Unauthorized");
      });

      it('should reject if lien is invalid', async () => {
        const newLoanAmount = loanAmount;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinance(
          lien,
          1,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "InvalidLien");
      });    

      it('should reject if lien is defaulted', async () => {
        time.setNextBlockTimestamp(BigInt(lien.startTime) + BigInt(lien.duration) + 1n);

        const newLoanAmount = loanAmount;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "LienIsDefaulted");
      });

      it('should reject if lien is collections do not match', async () => {
        const newLoanAmount = loanAmount;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: ethers.Wallet.createRandom(),
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          []
        )).to.be.revertedWithCustomError(kettle, "CollectionsDoNotMatch");
      });
    });

    describe("Batch ERC721", () => {
      let lienPointers: LienPointer[];

      beforeEach(async () => {
        collectionOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        collectionSignature = await signLoanOffer(kettle, lender, collectionOffer);

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        const txn = await kettle.connect(borrower).borrowBatch(
          [{ offer: collectionOffer, signature: collectionSignature }],  
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: proof1
            },
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 2,
              proof: proof2
            }
          ],
        );

        lienPointers = await txn.wait().then(
          async (receipt) => {
            const kettleAddres = await kettle.getAddress();
            const lienLogs = receipt!.logs!.filter(
              (log) => (log.address === kettleAddres)
            )!;

            return lienLogs.map(
              (log) => {
                const parsedLog = kettle.interface.decodeEventLog("LoanOfferTaken", log!.data, log!.topics);
                return {
                  lienId: parsedLog.lienId,
                  lien: formatLien(
                    parsedLog.lender,
                    parsedLog.borrower,
                    parsedLog.collateralType,
                    parsedLog.collection,
                    parsedLog.tokenId,
                    parsedLog.amount,
                    parsedLog.currency,
                    parsedLog.borrowAmount,
                    parsedLog.duration,
                    parsedLog.rate,
                    parsedLog.startTime
                  )
                }
              }
            );
          });

          const repayments = await Promise.all(
            lienPointers.map(
              async (lienPointer) => kettle.getRepaymentAmount(
                  lienPointer.lien.borrowAmount,
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

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).borrowerRefinanceBatch(
          [{ offer: refinanceOffer, signature: refinanceSignature }],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2)
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

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).borrowerRefinanceBatch(
          [{ offer: refinanceOffer, signature: refinanceSignature }],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2)
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

        const refinanceOffer1 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature1 = await signLoanOffer(kettle, lender, refinanceOffer1);

        const refinanceOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId2,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature2 = await signLoanOffer(kettle, lender, refinanceOffer2);

        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).borrowerRefinanceBatch(
          [
            { offer: refinanceOffer1, signature: refinanceSignature1 },
            { offer: refinanceOffer2, signature: refinanceSignature2 }
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              loanIndex: 1,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2)
            }
          ]
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });

      it("should reject if sender is not borrower", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const refinanceOffer1 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature1 = await signLoanOffer(kettle, lender, refinanceOffer1);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(lender).borrowerRefinanceBatch(
          [
            { offer: refinanceOffer1, signature: refinanceSignature1 },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            }
          ]
        )).to.be.revertedWithCustomError(kettle, "Unauthorized");
      });

      it("should reject if collateral is invalid", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const refinanceOffer1 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId2,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature1 = await signLoanOffer(kettle, lender, refinanceOffer1);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinanceBatch(
          [
            { offer: refinanceOffer1, signature: refinanceSignature1 },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            }
          ]
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it("should reject if collateral is invalid", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const refinanceOffer1 = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature1 = await signLoanOffer(kettle, lender, refinanceOffer1);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinanceBatch(
          [
            { offer: refinanceOffer1, signature: refinanceSignature1 },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2)
            }
          ]
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      });

      it("should reject if lien is invalid", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const refinanceOffer1 = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature1 = await signLoanOffer(kettle, lender, refinanceOffer1);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinanceBatch(
          [
            { offer: refinanceOffer1, signature: refinanceSignature1 },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: 1,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            }
          ]
        )).to.be.revertedWithCustomError(kettle, "InvalidLien");
      });

      it("should reject if lien is invalid", async () => {
        time.setNextBlockTimestamp(BigInt(lienPointers[0].lien.startTime) + BigInt(lienPointers[0].lien.duration) + 1n);

        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount;

        const refinanceOffer1 = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature1 = await signLoanOffer(kettle, lender, refinanceOffer1);
        await testErc20.mint(lender, newLoanAmount);

        await expect(kettle.connect(borrower).borrowerRefinanceBatch(
          [
            { offer: refinanceOffer1, signature: refinanceSignature1 },
          ],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            }
          ]
        )).to.be.revertedWithCustomError(kettle, "LienIsDefaulted");
      });
    });

    describe("Single ERC1155", () => {
      let lien: LienStruct;
      let lienId: bigint;

      beforeEach(async () => {
        tokenOffer = await getLoanOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: tokenId1,
          collateralAmount: token1Amount,
          lender: lender,
          collection: testErc1155,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        tokenSignature = await signLoanOffer(kettle, lender, tokenOffer);

        /* Start Loan */
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          tokenSignature,
          loanAmount,
          tokenId1,
          []
        );

        ({ lien, lienId } = await txn.wait().then(
          async (receipt) => {
            const kettleAddres = await kettle.getAddress();
            const lienLog = receipt!.logs!.find(
              (log) => (log.address === kettleAddres)
            )!;
  
            const parsedLog = kettle.interface.decodeEventLog("LoanOfferTaken", lienLog!.data, lienLog!.topics);
            return {
              lienId: parsedLog.lienId,
              lien: formatLien(
                parsedLog.lender,
                parsedLog.borrower,
                parsedLog.collateralType,
                parsedLog.collection,
                parsedLog.tokenId,
                parsedLog.amount,
                parsedLog.currency,
                parsedLog.borrowAmount,
                parsedLog.duration,
                parsedLog.rate,
                parsedLog.startTime
              )
            }
          }));

        repaymentAmount = await kettle.getRepaymentAmount(
          lien.borrowAmount,
          lien.rate,
          lien.duration
        );
  
        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("should refinance single loan (lower amount)", async () => {
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

        const newLoanAmount = loanAmount / 2n;

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: tokenId1,
          collateralAmount: token1Amount,
          lender: lender,
          collection: testErc1155,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).borrowerRefinance(
          lien,
          lienId,
          newLoanAmount,
          refinanceOffer,
          refinanceSignature,
          []
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });
    });

    describe("Batch ERC1155", () => {
      let lienPointers: LienPointer[];

      beforeEach(async () => {
        collectionOffer = await getLoanOffer({
          collateralType: CollateralType.ERC1155_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          collateralAmount: token1Amount,
          lender: lender,
          collection: testErc1155,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        collectionSignature = await signLoanOffer(kettle, lender, collectionOffer);

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        const txn = await kettle.connect(borrower).borrowBatch(
          [{ offer: collectionOffer, signature: collectionSignature }],  
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: proof1
            },
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 2,
              proof: proof2
            }
          ],
        );

        lienPointers = await txn.wait().then(
          async (receipt) => {
            const kettleAddres = await kettle.getAddress();
            const lienLogs = receipt!.logs!.filter(
              (log) => (log.address === kettleAddres)
            )!;

            return lienLogs.map(
              (log) => {
                const parsedLog = kettle.interface.decodeEventLog("LoanOfferTaken", log!.data, log!.topics);
                return {
                  lienId: parsedLog.lienId,
                  lien: formatLien(
                    parsedLog.lender,
                    parsedLog.borrower,
                    parsedLog.collateralType,
                    parsedLog.collection,
                    parsedLog.tokenId,
                    parsedLog.amount,
                    parsedLog.currency,
                    parsedLog.borrowAmount,
                    parsedLog.duration,
                    parsedLog.rate,
                    parsedLog.startTime
                  )
                }
              }
            );
          });

          expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(token1Amount);
          expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);

          expect(await testErc1155.balanceOf(erc1155Escrow, tokenId2)).to.equal(token2Amount);
          expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

          const repayments = await Promise.all(
            lienPointers.map(
              async (lienPointer) => kettle.getRepaymentAmount(
                  lienPointer.lien.borrowAmount,
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

        const refinanceOffer = await getLoanOffer({
          collateralType: CollateralType.ERC1155_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          collateralAmount: token1Amount,
          lender: lender,
          collection: testErc1155,
          currency: testErc20,
          totalAmount: newLoanAmount,
          minAmount: 0,
          maxAmount: newLoanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const refinanceSignature = await signLoanOffer(kettle, lender, refinanceOffer);
        await testErc20.mint(lender, newLoanAmount);

        expect(await testErc20.balanceOf(lender)).to.equal(newLoanAmount);

        await kettle.connect(borrower).borrowerRefinanceBatch(
          [{ offer: refinanceOffer, signature: refinanceSignature }],
          [
            {
              lien: lienPointers[0].lien,
              lienId: lienPointers[0].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId1)
            },
            {
              lien: lienPointers[1].lien,
              lienId: lienPointers[1].lienId,
              loanIndex: 0,
              loanAmount: newLoanAmount / 2n,
              proof: generateMerkleProofForToken(tokenIds, tokenId2)
            }
          ]
        );

        expect(await testErc20.balanceOf(lender)).to.equal(repaymentAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(newLoanAmount);
      });
    });
  });
});
