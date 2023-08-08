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
  generateMerkleRootForCollection,
  generateMerkleProofForToken
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC20,
  TestERC721,
  ERC721EscrowBase
} from "../typechain-types";
import { LienPointer } from "../types";

const DAY_SECONDS = 24 * 60 * 60;

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc20: TestERC20;
  let erc721Escrow: ERC721EscrowBase;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      kettle,
      testErc721,
      testErc20,
      erc721Escrow
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Seize", () => {
    const tokenId1 = 1;
    const tokenId2 = 2;

    const tokenIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const collectionRoot = generateMerkleRootForCollection(tokenIds);

    let tokenOffer: LoanOfferStruct;
    let collectionOffer: LoanOfferStruct;

    let loanAmount: bigint;
    let repaymentAmount: bigint;

    beforeEach(async () => {
      loanAmount = ethers.parseEther("10");

      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);
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

        /* Start Loan */
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          "0x",
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
                parsedLog.collection,
                parsedLog.tokenId,
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

      it("should seize single loan", async () => {
        await time.setNextBlockTimestamp(BigInt(lien.startTime) + BigInt(lien.duration) + BigInt(1));
        await kettle.connect(lender).seize([{ lien, lienId }]);
  
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await lender.getAddress());
      });

      it("should revert if loan is not expired", async () => {
        await expect(kettle.connect(lender).seize([{ lien, lienId }]))
          .to.be.revertedWithCustomError(kettle, "LienNotDefaulted")
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
      })

      it("should revert if loan is already repaid", async () => {
        await kettle.connect(borrower).repay(lien, lienId);

        await expect(kettle.connect(lender).seize([{ lien, lienId }]))
          .to.be.revertedWithCustomError(kettle, "InvalidLien")
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await borrower.getAddress());
      })
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

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        const txn = await kettle.connect(borrower).borrowBatch(
          [{ offer: collectionOffer, signature: "0x" }],  
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
                    parsedLog.collection,
                    parsedLog.tokenId,
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

      it("should seize batch loans", async () => {
        await time.setNextBlockTimestamp(BigInt(lienPointers[0].lien.startTime) + BigInt(lienPointers[0].lien.duration) + BigInt(1));
        await kettle.connect(lender).seize(lienPointers);
  
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await lender.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await lender.getAddress());
      });

      it("should revert if at least one loan is not expired", async () => {
        await expect(kettle.connect(lender).seize(lienPointers))
          .to.be.revertedWithCustomError(kettle, "LienNotDefaulted")
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
      })

      it("should revert if at least one loan is already repaid", async () => {
        await kettle.connect(borrower).repay(lienPointers[0].lien, lienPointers[0].lienId);

        await expect(kettle.connect(lender).seize(lienPointers))
          .to.be.revertedWithCustomError(kettle, "InvalidLien")
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await borrower.getAddress());
      })
    });
  });
});
