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
  TestERC20,
  TestERC721,
  TestERC1155
} from "../typechain-types";
import { LienPointer } from "../types";

const DAY_SECONDS = 24 * 60 * 60;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

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

  describe("Seize", () => {
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

      it("should seize single loan", async () => {
        await time.setNextBlockTimestamp(BigInt(lien.startTime) + BigInt(lien.duration) + BigInt(1));
        await kettle.connect(lender).seize([{ lien, lienId }]);
  
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await lender.getAddress());
      });

      it("should revert if loan is not expired", async () => {
        await expect(kettle.connect(lender).seize([{ lien, lienId }]))
          .to.be.revertedWithCustomError(kettle, "LienNotDefaulted")
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
      })

      it("should revert if loan is already repaid", async () => {
        await kettle.connect(borrower).repay(lien, lienId);

        await expect(kettle.connect(lender).seize([{ lien, lienId }]))
          .to.be.revertedWithCustomError(kettle, "InvalidLien")
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await borrower.getAddress());
      })
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

        expect(await testErc1155.balanceOf(kettle, tokenId1)).to.equal(2);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);

        repaymentAmount = await kettle.getRepaymentAmount(
          lien.amount,
          lien.rate,
          lien.duration
        );
  
        await testErc20.mint(borrower, repaymentAmount - await testErc20.balanceOf(borrower.getAddress()));
      });

      it("should seize single loan", async () => {
        await time.setNextBlockTimestamp(BigInt(lien.startTime) + BigInt(lien.duration) + BigInt(1));
        await kettle.connect(lender).seize([{ lien, lienId }]);
  
        expect(await testErc1155.balanceOf(lender, tokenId1)).to.equal(2);
      });

      it("should revert if loan is not expired", async () => {
        await expect(kettle.connect(lender).seize([{ lien, lienId }]))
          .to.be.revertedWithCustomError(kettle, "LienNotDefaulted")
        
        expect(await testErc1155.balanceOf(kettle, tokenId1)).to.equal(2);
        })

      it("should revert if loan is already repaid", async () => {
        await kettle.connect(borrower).repay(lien, lienId);

        await expect(kettle.connect(lender).seize([{ lien, lienId }]))
          .to.be.revertedWithCustomError(kettle, "InvalidLien")
        
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(2);
      })
    });

    describe("Batch ERC721", () => {
      let lienPointers: LienPointer[];

      beforeEach(async () => {
        ({
          offer: collectionOffer,
          offerSignature: collectionSignature,
          offerHash
        } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            collection: testErc721,
            identifier: collectionRoot,
            size: 1,
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
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
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

      it("should seize batch loans", async () => {
        await time.setNextBlockTimestamp(BigInt(lienPointers[0].lien.startTime) + BigInt(lienPointers[0].lien.duration) + BigInt(1));
        await kettle.connect(lender).seize(lienPointers);
  
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await lender.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await lender.getAddress());
      });

      it("should revert if at least one loan is not expired", async () => {
        await expect(kettle.connect(lender).seize(lienPointers))
          .to.be.revertedWithCustomError(kettle, "LienNotDefaulted")
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
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
