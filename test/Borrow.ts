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
import { LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC20,
  TestERC721,
  TestERC1155,
  CollateralVerifier
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
      verifier
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

      let offerAuth: OfferAuthStruct;
      let authSignature: string;

      beforeEach(async () => {

        ({ offer: tokenOffer, offerSignature, offerHash } = await prepareLoanOffer(
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
      });

      it('should start loan', async () => {
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          false,
          [],
        );

        // extract lien and lien id
        const { lien, lienId } = await txn.wait()
          .then((receipt) => extractLien(receipt!, kettle)
          );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
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
        const { offer: tokenOffer2, offerSignature: offerSignature2, offerHash: offerHash2 } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721,
            identifier: tokenId2,
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
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          tokenOffer2,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId2,
            size: 1
          }
        );

        const txn = await kettle.connect(borrower).borrowBatch(
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
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId1,
              useEscrow: false,
              proof: [],
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 1,
              amount: ethers.parseEther("5"),
              tokenId: tokenId2,
              useEscrow: false,
              proof: [],
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        const lienPointers = await txn.wait()
          .then(receipt => extractLiens(receipt!, kettle))

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await kettle.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

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
            expect(lien.amount).to.equal(loanAmount / 2n);

            expect(lien.duration).to.equal(DAY_SECONDS * 7);
            expect(lien.rate).to.equal(100_000);
          }
        );
      });

      it('should reject cancelled loan offer (OfferUnavailable)', async () => {
        await kettle.connect(lender).cancelOffer(tokenOffer.salt)

        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          false,
          []
        )).to.be.revertedWithCustomError(kettle, "OfferUnavailable");
      });

      it('should reject invalid loan offer nonce (InvalidSignature)', async () => {
        await kettle.connect(lender).incrementNonce();

        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          false,
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
          false,
          []
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateral");
      });

      it('should reject loans in bulk with invalid collateral criteria (InvalidCollateral)', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        await expect(kettle.connect(borrower).borrowBatch(
          [{
            offer: tokenOffer,
            offerSignature,
          }],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId1,
              useEscrow: false,
              proof: proof1,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId2,
              useEscrow: false,
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

      let collectionOfferHash: string;
      let traitOfferHash: string;

      let collectionLoanOfferSignature: string;
      let traitLoanOfferSignature: string;

      let collectionOfferAuth: OfferAuthStruct;
      let collectionOfferAuthSignature: string;

      let traitOfferAuth: OfferAuthStruct;
      let traitOfferAuthSignature: string;

      beforeEach(async () => {
        ({
          offer: collectionLoanOffer,
          offerSignature: collectionLoanOfferSignature,
          offerHash: collectionOfferHash
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

        ({ auth: collectionOfferAuth, authSignature: collectionOfferAuthSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          collectionLoanOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        ({
          offer: traitLoanOffer,
          offerSignature: traitLoanOfferSignature,
          offerHash: traitOfferHash
        } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            collection: testErc721,
            identifier: traitRoot,
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

        ({ auth: traitOfferAuth, authSignature: traitOfferAuthSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          traitLoanOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId2,
            size: 1
          }
        ));
      });

      it('should start loan (collection criteria)', async () => {
        const proof = generateMerkleProofForToken(tokenIds, tokenId1);

        const txn = await kettle.connect(borrower).borrow(
          collectionLoanOffer,
          collectionOfferAuth,
          collectionLoanOfferSignature,
          collectionOfferAuthSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          false,
          proof
        );

        // extract lien and lien id
        const { lien, lienId } = await txn.wait()
          .then((receipt) => extractLien(receipt!, kettle)
          );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

        // expect correct lienId
        expect(lienId).to.equal(0);

        // expect lien to have correct info
        expect(lien.offerHash).to.equal(collectionOfferHash);
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

      it('should start loans in bulk (collateral criteria)', async () => {
        const { auth: collectionOfferAuth2, authSignature: collectionOfferAuthSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          collectionLoanOffer,
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
          [{
            offer: collectionLoanOffer,
            offerSignature: collectionLoanOfferSignature
          }],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId1,
              useEscrow: false,
              proof: proof1,
              auth: collectionOfferAuth,
              authSignature: collectionOfferAuthSignature
            },
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId2,
              useEscrow: false,
              proof: proof2,
              auth: collectionOfferAuth2,
              authSignature: collectionOfferAuthSignature2
            }
          ],
          ADDRESS_ZERO
        );

        const lienPointers = await txn.wait()
          .then(receipt => extractLiens(receipt!, kettle))

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await kettle.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

        // expect lien pointers are correct
        const borrowerAddress = await borrower.getAddress();
        const lenderAddress = await lender.getAddress();
        const collectionAddress = await testErc721.getAddress();
        const currencyAddress = await testErc20.getAddress();

        [1, 2].forEach(
          (tokenId, index) => {
            const pointer = lienPointers[index];
            const { lien } = pointer;

            expect(lien.offerHash).to.equal(collectionOfferHash);
            expect(lien.lender).to.equal(lenderAddress);
            expect(lien.borrower).to.equal(borrowerAddress);

            // expect lien to have correct collateral
            expect(lien.collateralType).to.equal(CollateralType.ERC721);
            expect(lien.collection).to.equal(collectionAddress);
            expect(lien.tokenId).to.equal(tokenId);
            expect(lien.size).to.equal(1);

            // expect lien to be properly formatted payment info
            expect(lien.currency).to.equal(currencyAddress);
            expect(lien.amount).to.equal(loanAmount / 2n);

            expect(lien.duration).to.equal(DAY_SECONDS * 7);
            expect(lien.rate).to.equal(100_000);
          }
        );
      })

      it('should start loan (trait criteria)', async () => {
        const traitProof = generateMerkleProofForToken(traitTokenIds, tokenId2);

        await kettle.connect(borrower).borrow(
          traitLoanOffer,
          traitOfferAuth,
          traitLoanOfferSignature,
          traitOfferAuthSignature,
          loanAmount,
          tokenId2,
          ADDRESS_ZERO,
          false,
          traitProof
        );

        expect(await testErc721.ownerOf(tokenId2)).to.equal(await kettle.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
      });

      it('should take both collection offer and trait offer (collection and trait criteria)', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(traitTokenIds, tokenId2);

        const txn = await kettle.connect(borrower).borrowBatch(
          [
            {
              offer: collectionLoanOffer,
              offerSignature: collectionLoanOfferSignature
            },
            {
              offer: traitLoanOffer,
              offerSignature: traitLoanOfferSignature
            }
          ],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId1,
              useEscrow: false,
              proof: proof1,
              auth: collectionOfferAuth,
              authSignature: collectionOfferAuthSignature
            },
            {
              offerIndex: 1,
              amount: ethers.parseEther("5"),
              tokenId: tokenId2,
              useEscrow: false,
              proof: proof2,
              auth: traitOfferAuth,
              authSignature: traitOfferAuthSignature
            }
          ],
          ADDRESS_ZERO
        );

        const lienPointers = await txn.wait()
          .then(receipt => extractLiens(receipt!, kettle))

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await kettle.getAddress());
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

        // expect lien pointers are correct
        const borrowerAddress = await borrower.getAddress();
        const lenderAddress = await lender.getAddress();
        const collectionAddress = await testErc721.getAddress();
        const currencyAddress = await testErc20.getAddress();

        const offerHashes = [collectionOfferHash, traitOfferHash];
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
            expect(lien.amount).to.equal(loanAmount / 2n);

            expect(lien.duration).to.equal(DAY_SECONDS * 7);
            expect(lien.rate).to.equal(100_000);
          }
        );
      })

      it('should reject with invalid collateral criteria (InvalidCollateralCriteria)', async () => {
        const traitProof = generateMerkleProofForToken(traitTokenIds, tokenId2);

        await expect(kettle.connect(borrower).borrow(
          collectionLoanOffer,
          collectionOfferAuth,
          collectionLoanOfferSignature,
          collectionOfferAuthSignature,
          loanAmount,
          tokenId2,
          ADDRESS_ZERO,
          false,
          traitProof
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      })

      it('should reject loans in bulk with invalid collateral criteria (InvalidCollateralCriteria)', async () => {
        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        await expect(kettle.connect(borrower).borrowBatch(
          [{
            offer: collectionLoanOffer,
            offerSignature: collectionLoanOfferSignature
          }],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: 1,
              proof: proof1,
              useEscrow: false,
              auth: collectionOfferAuth,
              authSignature: collectionOfferAuthSignature
            },
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: 3,
              proof: proof2,
              useEscrow: false,
              auth: collectionOfferAuth,
              authSignature: collectionOfferAuthSignature
            }
          ],
          ADDRESS_ZERO
        )).to.be.revertedWithCustomError(verifier, "InvalidCollateralCriteria");
      })
    });

    describe("collateralType === ERC1155", () => {
      let tokenOffer: LoanOfferStruct;
      let offerSignature: string;

      let offerHash: string;

      let offerAuth: OfferAuthStruct;
      let authSignature: string;

      beforeEach(async () => {

        ({ offer: tokenOffer, offerSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            identifier: tokenId1,
            size: tokenAmount1,
            currency: testErc20,
            totalAmount: loanAmount,
            minAmount: 0,
            maxAmount: loanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }));

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
            size: tokenAmount1
          }
        ));
      });

      it('should start loan', async () => {
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          false,
          []
        );

        // extract lien and lien id
        const { lien, lienId } = await txn.wait()
          .then((receipt) => extractLien(receipt!, kettle)
          );

        expect(await testErc1155.balanceOf(kettle, tokenId1)).to.equal(tokenAmount1);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

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
        expect(lien.size).to.equal(tokenAmount1);

        // expect lien to be properly formatted payment info
        expect(lien.currency).to.equal(await testErc20.getAddress());
        expect(lien.amount).to.equal(loanAmount);

        expect(lien.duration).to.equal(DAY_SECONDS * 7);
        expect(lien.rate).to.equal(100_000);
      });

      it('should start loans in bulk', async () => {
        const { offer: tokenOffer2, offerSignature: offerSignature2, offerHash: offerHash2 } = await prepareLoanOffer(
          kettle,
          lender,
          {
            lender: lender,
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            identifier: tokenId2,
            size: tokenAmount2,
            currency: testErc20,
            totalAmount: loanAmount,
            minAmount: 0,
            maxAmount: loanAmount,
            duration: DAY_SECONDS * 7,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        );

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + 100,
          tokenOffer2,
          {
            collateralType: CollateralType.ERC1155,
            collection: testErc1155,
            tokenId: tokenId2,
            size: tokenAmount2
          }
        );

        const txn = await kettle.connect(borrower).borrowBatch(
          [
            {
              offer: tokenOffer,
              offerSignature: offerSignature
            },
            {
              offer: tokenOffer2,
              offerSignature: offerSignature2
            }
          ],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId1,
              useEscrow: false,
              proof: [],
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 1,
              amount: ethers.parseEther("5"),
              tokenId: tokenId2,
              useEscrow: false,
              proof: [],
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        expect(await testErc1155.balanceOf(kettle, tokenId1)).to.equal(tokenAmount1);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);

        expect(await testErc1155.balanceOf(kettle, tokenId2)).to.equal(tokenAmount2);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

        const lienPointers = await txn.wait()
          .then(receipt => extractLiens(receipt!, kettle))

        // expect correct number of lien pointers
        expect(lienPointers).to.have.length(2);

        // expect lien pointers are correct
        const borrowerAddress = await borrower.getAddress();
        const lenderAddress = await lender.getAddress();
        const collectionAddress = await testErc1155.getAddress();
        const currencyAddress = await testErc20.getAddress();

        const offerHashes = [offerHash, offerHash2];
        const tokenAmounts = [tokenAmount1, tokenAmount2];

        [1, 2].forEach(
          (tokenId, index) => {
            const pointer = lienPointers[index];
            const { lien } = pointer;
            const offerHash = offerHashes[index];
            const size = tokenAmounts[index];

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
            expect(lien.amount).to.equal(loanAmount / 2n);

            expect(lien.duration).to.equal(DAY_SECONDS * 7);
            expect(lien.rate).to.equal(100_000);
          }
        );
      });
    });

    describe("collateralType === ERC1155_WITH_CRITERIA", () => {
      let collectionOffer: LoanOfferStruct;
      let offerSignature: string;
      let offerHash: string;
      
      let offerAuth: OfferAuthStruct;
      let authSignature: string;

      beforeEach(async () => {

        ({ offer: collectionOffer, offerSignature, offerHash } = await prepareLoanOffer(
          kettle,
          lender,
          {
          lender: lender,
          collateralType: CollateralType.ERC1155_WITH_CRITERIA,
          identifier: collectionRoot,
          size: tokenAmount1,
          collection: testErc1155,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 100_000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
        }));

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
            size: tokenAmount1
          }
        ))
      });

      it('should start loan', async () => {
        const proof = generateMerkleProofForToken(tokenIds, tokenId1);

        const txn = await kettle.connect(borrower).borrow(
          collectionOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          false,
          proof
        );

        // extract lien and lien id
        const { lien, lienId } = await txn.wait()
          .then((receipt) => extractLien(receipt!, kettle)
          );

        expect(await testErc1155.balanceOf(kettle, tokenId1)).to.equal(tokenAmount1);
        expect(await testErc1155.balanceOf(borrower, tokenId1)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

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
        expect(lien.size).to.equal(tokenAmount1);

        // expect lien to be properly formatted payment info
        expect(lien.currency).to.equal(await testErc20.getAddress());
        expect(lien.amount).to.equal(loanAmount);

        expect(lien.duration).to.equal(DAY_SECONDS * 7);
        expect(lien.rate).to.equal(100_000);
      });

      it('should start loan in bulk', async () => {
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
            size: tokenAmount2
          }
        );

        const proof1 = generateMerkleProofForToken(tokenIds, tokenId1);
        const proof2 = generateMerkleProofForToken(tokenIds, tokenId2);

        const txn = await kettle.connect(borrower).borrowBatch(
          [
            {
              offer: collectionOffer,
              offerSignature: offerSignature
            },
          ],
          [
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId1,
              useEscrow: false,
              proof: proof1,
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: tokenId2,
              useEscrow: false,
              proof: proof2,
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        expect(await testErc1155.balanceOf(kettle, tokenId1)).to.equal(tokenAmount1);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

        expect(await testErc1155.balanceOf(kettle, tokenId2)).to.equal(tokenAmount2);
        expect(await testErc1155.balanceOf(borrower, tokenId2)).to.equal(0);

        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);

        const lienPointers = await txn.wait()
        .then(receipt => extractLiens(receipt!, kettle))

      // expect correct number of lien pointers
      expect(lienPointers).to.have.length(2);

      // expect lien pointers are correct
      const borrowerAddress = await borrower.getAddress();
      const lenderAddress = await lender.getAddress();
      const collectionAddress = await testErc1155.getAddress();
      const currencyAddress = await testErc20.getAddress();

      const tokenAmounts = [tokenAmount1, tokenAmount2];

      [1, 2].forEach(
        (tokenId, index) => {
          const pointer = lienPointers[index];
          const { lien } = pointer;
          const size = tokenAmounts[index];

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
          expect(lien.amount).to.equal(loanAmount / 2n);

          expect(lien.duration).to.equal(DAY_SECONDS * 7);
          expect(lien.rate).to.equal(100_000);
        }
      );
      });
    });
  });
});
