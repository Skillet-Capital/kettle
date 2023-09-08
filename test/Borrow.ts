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
  generateMerkleProofForToken,
  hashCollateral,
  signOfferAuth
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
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
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;

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
      authSigner,
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

    const tokenId1 = 1;
    const tokenId2 = 2;

    const tokenAmount1 = 2;
    const tokenAmount2 = 2;

    const tokenIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const traitTokenIds = [2, 3];

    const collectionRoot = generateMerkleRootForCollection(tokenIds);
    const traitRoot = generateMerkleRootForCollection(traitTokenIds);

    const loanAmount = ethers.parseEther("10");

    beforeEach(async () => {
      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc1155.mint(borrower, tokenId1, tokenAmount1);
      await testErc1155.mint(borrower, tokenId2, tokenAmount2);

      await testErc20.mint(lender, loanAmount);
    });

    describe("collateralType === ERC721", () => {
      let tokenOffer: LoanOfferStruct;
      let offerSignature: string;

      let offerHash: string;
      let collateralHash: string;
      let offerAuth: OfferAuthStruct;
      let authSignature: string;

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

        offerSignature = await signLoanOffer(
          kettle,
          lender,
          tokenOffer
        );

        offerHash = await kettle.getLoanOfferHash(tokenOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC721,
          testErc721,
          tokenId1,
          1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
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
        await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature, 
          authSignature,
          loanAmount, 
          1,
          ADDRESS_ZERO,
          [],
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk', async () => {
        const tokenOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId2,
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

        const offerSignature2 = await signLoanOffer(
          kettle,
          lender,
          tokenOffer2
        );

        const offerHash2 = await kettle.getLoanOfferHash(tokenOffer2);

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC721,
          testErc721,
          tokenId2,
          1
        );

        const offerAuth2 = {
          offerHash: offerHash2,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: tokenOffer,
              offerSignature,
            },
            {
              offer: tokenOffer2,
              offerSignature: offerSignature2,
            }
          ],
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: [],
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              loanIndex: 1,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 2,
              proof: [],
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it.only('should send to kettle with no escrow implementation', async () => {
        const testErc721_2 = await ethers.deployContract("TestERC721");
        await testErc721_2.waitForDeployment();

        await testErc721_2.mint(borrower, tokenId1);
        await testErc721_2.connect(borrower).setApprovalForAll(kettle, true);

        const tokenOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
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

        const offerSignature2 = await signLoanOffer(
          kettle,
          lender,
          tokenOffer2
        );

        const offerHash2 = await kettle.getLoanOfferHash(tokenOffer2);

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC721,
          testErc721_2,
          tokenId1,
          1
        );

        const offerAuth2 = {
          offerHash: offerHash2,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        await kettle.connect(borrower).borrow(
          tokenOffer2,
          offerAuth2,
          offerSignature2,
          authSignature2,
          loanAmount, 
          tokenId1,
          ADDRESS_ZERO,
          []
        );

        expect(await testErc721_2.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      })

      it('should reject cancelled loan offer', async () => {
        await kettle.connect(lender).cancelOffer(tokenOffer.salt)

        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature, 
          authSignature,
          loanAmount, 
          tokenId1,
          ADDRESS_ZERO,
          []
        )).to.be.revertedWithCustomError(kettle, "OfferUnavailable");
      });

      it('should reject invalid loan offer nonce', async () => {
        await kettle.connect(lender).incrementNonce();

        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature, 
          authSignature,
          loanAmount, 
          tokenId1,
          ADDRESS_ZERO,
          []
        )).to.be.revertedWithCustomError(kettle, "InvalidSignature");
      });

      it('should reject with invalid collateral', async () => {
        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature, 
          authSignature,
          loanAmount, 
          tokenId2,
          ADDRESS_ZERO,
          []
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it('should reject loans in bulk with invalid collateral criteria', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        await expect(kettle.connect(borrower).borrowBatch(
          [{ 
            offer: tokenOffer,
            offerSignature,
          }],  
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: proof1,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 2,
              proof: proof2,
              auth: offerAuth,
              authSignature: authSignature
            }
          ],
          ADDRESS_ZERO
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });
    });

    describe("collateralType === ERC721_WITH_CRITERIA", () => {
      let collectionLoanOffer: LoanOfferStruct;
      let traitLoanOffer: LoanOfferStruct;
      
      let collectionLoanOfferSignature: string;
      let traitLoanOfferSignature: string;

      let offerHash: string;
      let collateralHash: string;
      let offerAuth: OfferAuthStruct;
      let authSignature: string;

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
        offerHash = await kettle.getLoanOfferHash(collectionLoanOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC721_WITH_CRITERIA,
          testErc721,
          tokenId1,
          1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );

        const proof = generateMerkleProofForToken(tokenIds, tokenId1);

        await kettle.connect(borrower).borrow(
          collectionLoanOffer,
          offerAuth,
          collectionLoanOfferSignature,
          authSignature,
          loanAmount,
          1,
          ADDRESS_ZERO,
          proof
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk (collateral criteria)', async () => {
        offerHash = await kettle.getLoanOfferHash(collectionLoanOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC721_WITH_CRITERIA,
          testErc721,
          tokenId1,
          1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC721_WITH_CRITERIA,
          testErc721,
          tokenId2,
          1
        );

        const offerAuth2 = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        await kettle.connect(borrower).borrowBatch(
          [{ 
            offer: collectionLoanOffer,
            offerSignature: collectionLoanOfferSignature 
          }],  
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: proof1,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 2,
              proof: proof2,
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      })

      it('should start loan (trait criteria)', async () => {
        offerHash = await kettle.getLoanOfferHash(traitLoanOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC721_WITH_CRITERIA,
          testErc721,
          tokenId2,
          1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );

        const traitProof = generateMerkleProofForToken(traitTokenIds, tokenId2);

        await kettle.connect(borrower).borrow(
          traitLoanOffer,
          offerAuth,
          traitLoanOfferSignature,
          authSignature,
          loanAmount,
          tokenId2,
          ADDRESS_ZERO,
          traitProof
        );

        expect(await testErc721.ownerOf(tokenId2)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should reject with invalid collateral criteria', async () => {
        offerHash = await kettle.getLoanOfferHash(traitLoanOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC721_WITH_CRITERIA,
          testErc721,
          tokenId2,
          1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );

        const traitProof = generateMerkleProofForToken(traitTokenIds, tokenId2);

        await expect(kettle.connect(borrower).borrow(
          collectionLoanOffer,
          offerAuth,
          collectionLoanOfferSignature,
          authSignature,
          loanAmount,
          tokenId2,
          ADDRESS_ZERO,
          traitProof
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      })

      it('should reject loans in bulk with invalid collateral criteria', async () => {
        offerHash = await kettle.getLoanOfferHash(collectionLoanOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC721_WITH_CRITERIA,
          testErc721,
          tokenId1,
          1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC721_WITH_CRITERIA,
          testErc721,
          tokenId2,
          1
        );

        const offerAuth2 = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2 
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        )

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        await expect(kettle.connect(borrower).borrowBatch(
          [{ offer: collectionLoanOffer, offerSignature: collectionLoanOfferSignature }],  
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: proof1,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 3,
              proof: proof2,
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      })
    });

    describe("collateralType === ERC1155", () => {
      let tokenOffer: LoanOfferStruct;
      let signature: string;

      let offerHash: string;
      let collateralHash: string;
      let offerAuth: OfferAuthStruct;
      let authSignature: string;

      beforeEach(async () => {

        tokenOffer = await getLoanOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: tokenId1,
          collateralAmount: tokenAmount1,
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

        offerHash = await kettle.getLoanOfferHash(tokenOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC1155,
          testErc1155,
          tokenId1,
          tokenAmount1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
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
        await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          signature,
          authSignature,
          loanAmount, 
          1,
          ADDRESS_ZERO,
          []
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(tokenAmount1);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loans in bulk', async () => {
        const tokenOffer2 = await getLoanOffer({
          collateralType: CollateralType.ERC1155,
          collateralIdentifier: tokenId2,
          collateralAmount: tokenAmount2,
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

        const offerHash2 = await kettle.getLoanOfferHash(tokenOffer2);

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC1155,
          testErc1155,
          tokenId2,
          tokenAmount2
        );

        const offerAuth2 = {
          offerHash: offerHash2,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: tokenOffer, 
              offerSignature: signature
            },
            {
              offer: tokenOffer2,
              offerSignature: signature2
            }
          ],
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: tokenId1,
              proof: [],
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              loanIndex: 1,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: tokenId2,
              proof: [],
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(tokenAmount1);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        
        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId2)).to.equal(tokenAmount2);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });
    });

    describe("collateralType === ERC1155_WITH_CRITERIA", () => {
      let collectionOffer: LoanOfferStruct;
      let signature: string;

      let offerHash: string;
      let collateralHash: string;
      let offerAuth: OfferAuthStruct;
      let authSignature: string;

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
        offerHash = await kettle.getLoanOfferHash(collectionOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC1155_WITH_CRITERIA,
          testErc1155,
          tokenId1,
          tokenAmount1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );

        const proof = generateMerkleProofForToken(tokenIds, tokenId1);

        await kettle.connect(borrower).borrow(
          collectionOffer, 
          offerAuth,
          signature,
          authSignature,
          loanAmount, 
          tokenId1,
          ADDRESS_ZERO,
          proof
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(2);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should start loan in bulk', async () => {
        offerHash = await kettle.getLoanOfferHash(collectionOffer);

        collateralHash = await hashCollateral(
          CollateralType.ERC1155_WITH_CRITERIA,
          testErc1155,
          tokenId1,
          tokenAmount1
        );

        offerAuth = {
          offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash
        }

        authSignature = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth
        );

        const collateralHash2 = await hashCollateral(
          CollateralType.ERC1155_WITH_CRITERIA,
          testErc1155,
          tokenId2,
          tokenAmount2
        );

        const offerAuth2 = {
          offerHash: offerHash,
          taker: await borrower.getAddress(),
          expiration: await time.latest() + 100,
          collateralHash: collateralHash2
        }

        const authSignature2 = await signOfferAuth(
          kettle,
          authSigner,
          offerAuth2
        );

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: collectionOffer, 
              offerSignature: signature 
            },
          ],
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: tokenId1,
              proof: proof1,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: tokenId2,
              proof: proof2,
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId1)).to.equal(tokenAmount1);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);
        
        expect(await testErc1155.balanceOf(erc1155Escrow, tokenId2)).to.equal(tokenAmount2);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });
    });
  });
});
