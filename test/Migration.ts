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
  Helpers,
  CollateralVerifier
} from "../typechain-types";

const DAY_SECONDS = 24 * 60 * 60;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;

  let kettle: Kettle;
  let helpers: Helpers;
  let verifier: CollateralVerifier;

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
      helpers,
      verifier
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Borrow on current version and repay on new version", () => {

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

      it('should start loan on current version and repay on new version', async () => {
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
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

        // create new kettle contract
        const newKettle = await ethers.deployContract("Kettle", [0, authSigner, kettle], { 
          libraries: { Helpers: helpers.target, CollateralVerifier: verifier.target },
          gasLimit: 1e8 
        });

        // repay loan on new kettle contract
        const repaymentAmount = await newKettle.getRepaymentAmount(
          lien.amount,
          lien.rate,
          lien.duration
        );

        await testErc20.connect(borrower).approve(newKettle, repaymentAmount);

        await newKettle.connect(borrower).repay(lien, lienId);

      });
    });
  });
});
