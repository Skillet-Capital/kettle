import { expect } from "chai";
import { 
  time, 
  loadFixture 
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { 
  getLoanOffer,
  signLoanOffer,
  generateMerkleRootForCollection, 
  generateMerkleProofForToken 
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LoanOfferStruct } from "../typechain-types/contracts/Kettle";
import { 
  Kettle, 
  TestERC20, 
  TestERC721, 
  TestERC1155,
  CollateralVerifier,
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
  let verifier: CollateralVerifier;
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
      verifier,
      erc721Escrow,
      erc1155Escrow
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Borrow", () => {

    const tokenId = 1;
    const traitTokenId = 2;

    const tokenAmount = 2;
    const traitTokenAmount = 2;

    const tokenIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const traitTokenIds = [2, 3];

    const collectionRoot = generateMerkleRootForCollection(tokenIds);
    const traitRoot = generateMerkleRootForCollection(traitTokenIds);

    const loanAmount = ethers.parseEther("10");

    beforeEach(async () => {
      await testErc721.mint(borrower, tokenId);
      await testErc721.mint(borrower, traitTokenId);

      await testErc1155.mint(borrower, tokenId, tokenAmount);
      await testErc1155.mint(borrower, traitTokenId, traitTokenAmount);

      await testErc20.mint(lender, loanAmount);
    });

    describe("collateralType === ERC721", () => {
      let tokenOffer: LoanOfferStruct;
      let signature: string;

      beforeEach(async () => {

        tokenOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId,
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

        signature = await signLoanOffer(
          kettle,
          lender,
          tokenOffer
        );
      });

      it('should start loan', async () => {
        await kettle.connect(borrower).borrow(
          tokenOffer, 
          signature, 
          loanAmount, 
          1,
          []
        );

        expect(await testErc721.ownerOf(tokenId)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk', async () => {
        const tokenOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: traitTokenId,
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

        const signature2 = await signLoanOffer(
          kettle,
          lender,
          tokenOffer2
        );

        await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: tokenOffer, 
              signature: signature 
            },
            {
              offer: tokenOffer2,
              signature: signature2
            }
          ],
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: []
            },
            {
              loanIndex: 1,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 2,
              proof: []
            }
          ],
        );

        expect(await testErc721.ownerOf(tokenId)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc721.ownerOf(traitTokenId)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should reject with invalid collateral', async () => {
        await expect(kettle.connect(borrower).borrow(
          tokenOffer, 
          signature, 
          loanAmount, 
          2,
          []
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it('should reject loans in bulk with invalid collateral criteria', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId);
        const proof2 = generateMerkleProofForToken(tokenIds, traitTokenId);

        await expect(kettle.connect(borrower).borrowBatch(
          [{ offer: tokenOffer, signature: signature }],  
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
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it('should reject with no escrow implementation', async () => {
        const testErc721_2 = await ethers.deployContract("TestERC721");
        await testErc721_2.waitForDeployment();

        const tokenOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId,
          lender: lender,
          collection: testErc721_2,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        const signature2 = await signLoanOffer(
          kettle,
          lender,
          tokenOffer2
        );

        await expect(kettle.connect(borrower).borrow(
          tokenOffer2, 
          signature2, 
          loanAmount, 
          1,
          []
        )).to.be.revertedWithCustomError(kettle, "NoEscrowImplementation");
      })
    });

    describe("collateralType === ERC721_WITH_CRITERIA", () => {
      let collectionLoanOffer: LoanOfferStruct;
      let traitLoanOffer: LoanOfferStruct;
      
      let collectionLoanOfferSignature: string;
      let traitLoanOfferSignature: string;

      beforeEach(async () => {
        collectionLoanOffer = await getLoanOffer({
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

        collectionLoanOfferSignature = await signLoanOffer(
          kettle,
          lender,
          collectionLoanOffer
        );

        traitLoanOffer = await getLoanOffer({
          collateralType: CollateralType.ERC721_WITH_CRITERIA,
          collateralIdentifier: traitRoot,
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

        traitLoanOfferSignature = await signLoanOffer(
          kettle,
          lender,
          traitLoanOffer
        );
      });

      it('should start loan (collection criteria)', async () => {
        const proof = generateMerkleProofForToken(tokenIds, tokenId);

        await kettle.connect(borrower).borrow(
          collectionLoanOffer,
          collectionLoanOfferSignature,
          loanAmount,
          1,
          proof
        );

        expect(await testErc721.ownerOf(tokenId)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk (collateral criteria)', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId);
        const proof2 = generateMerkleProofForToken(tokenIds, traitTokenId);

        await kettle.connect(borrower).borrowBatch(
          [{ offer: collectionLoanOffer, signature: collectionLoanOfferSignature }],  
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

        expect(await testErc721.ownerOf(tokenId)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc721.ownerOf(traitTokenId)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      })

      it('should start loan (trait criteria)', async () => {
        const traitProof = generateMerkleProofForToken(traitTokenIds, traitTokenId);

        await kettle.connect(borrower).borrow(
          traitLoanOffer,
          traitLoanOfferSignature,
          loanAmount,
          traitTokenId,
          traitProof
        );

        expect(await testErc721.ownerOf(traitTokenId)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should reject with invalid collateral criteria', async () => {
        const traitProof = generateMerkleProofForToken(traitTokenIds, traitTokenId);

        await expect(kettle.connect(borrower).borrow(
          collectionLoanOffer,
          collectionLoanOfferSignature,
          loanAmount,
          traitTokenId,
          traitProof
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      })

      it('should reject loans in bulk with invalid collateral criteria', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId);
        const proof2 = generateMerkleProofForToken(tokenIds, traitTokenId);

        await expect(kettle.connect(borrower).borrowBatch(
          [{ offer: collectionLoanOffer, signature: collectionLoanOfferSignature }],  
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
              collateralIdentifier: 3,
              proof: proof2
            }
          ],
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      })
    });

    describe("collateralType === ERC1155", () => {
      let tokenOffer: LoanOfferStruct;
      let signature: string;

      beforeEach(async () => {

        tokenOffer = await getLoanOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: tokenId,
          collateralAmount: tokenAmount,
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

        signature = await signLoanOffer(
          kettle,
          lender,
          tokenOffer
        );
      });

      it('should start loan', async () => {
        await kettle.connect(borrower).borrow(
          tokenOffer, 
          signature, 
          loanAmount, 
          1,
          []
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId)).to.equal(2);
        expect(await testErc1155.balanceOf(borrower, tokenId)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk', async () => {
        const tokenOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: traitTokenId,
          collateralAmount: traitTokenAmount,
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

        const signature2 = await signLoanOffer(
          kettle,
          lender,
          tokenOffer2
        );

        await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: tokenOffer, 
              signature
            },
            {
              offer: tokenOffer2,
              signature: signature2
            }
          ],
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: tokenId,
              proof: []
            },
            {
              loanIndex: 1,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: traitTokenId,
              proof: []
            }
          ],
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId)).to.equal(tokenAmount);
        expect(await testErc1155.balanceOf(borrower, tokenId)).to.equal(0);
        
        expect(await testErc1155.balanceOf(erc1155Escrow, traitTokenId)).to.equal(traitTokenAmount);
        expect(await testErc1155.balanceOf(borrower, traitTokenId)).to.equal(0);

        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });
    });

    describe("collateralType === ERC1155_WITH_CRITERIA", () => {
      let collectionOffer: LoanOfferStruct;
      let signature: string;

      beforeEach(async () => {

        collectionOffer = await getLoanOffer({
          collateralType: CollateralType.ERC1155_WITH_CRITERIA,
          collateralIdentifier: collectionRoot,
          collateralAmount: 2,
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

        signature = await signLoanOffer(
          kettle,
          lender,
          collectionOffer
        );
      });

      it('should start loan', async () => {
        const proof = generateMerkleProofForToken(tokenIds, tokenId);

        await kettle.connect(borrower).borrow(
          collectionOffer, 
          signature, 
          loanAmount, 
          1,
          proof
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId)).to.equal(2);
        expect(await testErc1155.balanceOf(borrower, tokenId)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loan in bulk', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId);
        const proof2 = generateMerkleProofForToken(tokenIds, traitTokenId);

        await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: collectionOffer, 
              signature 
            },
          ],
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: tokenId,
              proof: proof1
            },
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: traitTokenId,
              proof: proof2
            }
          ],
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId)).to.equal(tokenAmount);
        expect(await testErc1155.balanceOf(borrower, tokenId)).to.equal(0);
        
        expect(await testErc1155.balanceOf(erc1155Escrow, traitTokenId)).to.equal(traitTokenAmount);
        expect(await testErc1155.balanceOf(borrower, traitTokenId)).to.equal(0);

        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });
    });
  });
});
