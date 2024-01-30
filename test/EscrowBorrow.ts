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
  prepareUpdateEscrowAuth
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC20,
  TestERC721,
  TestERC1155,
  LendingEscrow
} from "../typechain-types";

const DAY_SECONDS = 24 * 60 * 60;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;

  let kettle: Kettle;
  let escrow: LendingEscrow;

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
      escrow
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Borrow", () => {

    const tokenId1 = 1;
    const tokenId2 = 2;

    const tokenAmount1 = 2;
    const tokenAmount2 = 2;

    const loanAmount = ethers.parseEther("10");

    beforeEach(async () => {
      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc1155.mint(borrower, tokenId1, tokenAmount1);
      await testErc1155.mint(borrower, tokenId2, tokenAmount2);

      await testErc20.mint(lender, loanAmount);

    });

    describe("Escrow", () => {
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
          blockTimestamp + DAY_SECONDS * 7,
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
        await escrow.connect(lender).depositEscrow(
          offerHash,
          lender,
          testErc20,
          loanAmount,
          DAY_SECONDS * 7
        );

        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          true,
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
      });

      it('should reject loan if escrow amount is insufficient', async () => {
        await escrow.connect(lender).depositEscrow(
          offerHash,
          lender,
          testErc20,
          loanAmount / 2n,
          DAY_SECONDS * 7
        );

        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          true,
          [],
        )).to.be.revertedWithCustomError(escrow, "InsufficientFunds");
      });

      it('should reject loan if escrow amount is insufficient (update authorized amount)', async () => {
        await escrow.connect(lender).depositEscrow(
          offerHash,
          lender,
          testErc20,
          loanAmount,
          DAY_SECONDS * 7
        );

        // authorize escrow update amount
        const { auth: updateAuth, authSignature: updateSignature } = await prepareUpdateEscrowAuth(
          escrow,
          authSigner,
          lender,
          offerHash,
          loanAmount / 2n,
          await time.latest() + DAY_SECONDS * 7
        );

        // update authorized amount
        await escrow.connect(lender).updateAuthorizedAmount(
          offerHash,
          loanAmount / 2n,
          updateAuth,
          updateSignature
        );

        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          true,
          [],
        )).to.be.revertedWithCustomError(escrow, "InsufficientFunds");
      });

      it('should reject loan if escrow is expired', async () => {
        await escrow.connect(lender).depositEscrow(
          offerHash,
          lender,
          testErc20,
          loanAmount,
          DAY_SECONDS
        );

        await time.increase(DAY_SECONDS + 1);

        await expect(kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature,
          authSignature,
          loanAmount,
          tokenId1,
          ADDRESS_ZERO,
          true,
          [],
        )).to.be.revertedWithCustomError(escrow, "EscrowExpired");
      });
    });
  });
});
