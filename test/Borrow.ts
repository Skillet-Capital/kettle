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
  generateMerkleRootForCollection, 
  generateMerkleProofForToken 
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LoanOfferStruct } from "../typechain-types/contracts/Kettle";
import { 
  Kettle, 
  TestERC20, 
  TestERC721, 
  CollateralVerifier,
  ERC721EscrowBase
} from "../typechain-types";

const DAY_SECONDS = 24 * 60 * 60;

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc20: TestERC20;
  let verifier: CollateralVerifier;
  let erc721Escrow: ERC721EscrowBase;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      kettle,
      testErc721,
      testErc20,
      verifier,
      erc721Escrow
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Borrow", () => {

    const tokenId = 1;
    const traitTokenId = 2;

    const tokenIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const traitTokenIds = [2, 3];

    const collectionRoot = generateMerkleRootForCollection(tokenIds);
    const traitRoot = generateMerkleRootForCollection(traitTokenIds);

    const loanAmount = ethers.parseEther("10");

    beforeEach(async () => {
      await testErc721.mint(borrower, tokenId);
      await testErc721.mint(borrower, traitTokenId);

      await testErc20.mint(lender, loanAmount);
    });

    describe("collateralType === ERC721", () => {
      let tokenOffer: LoanOfferStruct;

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
      });

      it('should start loan', async () => {
        await kettle.connect(borrower).borrow(
          tokenOffer, 
          "0x", 
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

        await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: tokenOffer, 
              signature: "0x" 
            },
            {
              offer: tokenOffer2,
              signature: "0x"
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
          "0x", 
          loanAmount, 
          2,
          []
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it('should reject loans in bulk with invalid collateral criteria', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId);
        const proof2 = generateMerkleProofForToken(tokenIds, traitTokenId);

        await expect(kettle.connect(borrower).borrowBatch(
          [{ offer: tokenOffer, signature: "0x" }],  
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
        const testErc7212 = await ethers.deployContract("TestERC721");
        await testErc721.waitForDeployment();

        const tokenOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId,
          lender: lender,
          collection: testErc7212,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 1000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        });

        await expect(kettle.connect(borrower).borrow(
          tokenOffer2, 
          "0x", 
          loanAmount, 
          1,
          []
        )).to.be.revertedWithCustomError(kettle, "NoEscrowImplementation");
      })
    });

    describe("collateralType === ERC721_WITH_CRITERIA", () => {
      let collectionLoanOffer: LoanOfferStruct;
      let traitLoanOffer: LoanOfferStruct;

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
      });

      it('should start loan (collection criteria)', async () => {
        const proof = generateMerkleProofForToken(tokenIds, tokenId);

        await kettle.connect(borrower).borrow(
          collectionLoanOffer,
          "0x",
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
          [{ offer: collectionLoanOffer, signature: "0x" }],  
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
          "0x",
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
          "0x",
          loanAmount,
          traitTokenId,
          traitProof
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      })

      it('should reject loans in bulk with invalid collateral criteria', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId);
        const proof2 = generateMerkleProofForToken(tokenIds, traitTokenId);

        await expect(kettle.connect(borrower).borrowBatch(
          [{ offer: collectionLoanOffer, signature: "0x" }],  
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
  });
});
