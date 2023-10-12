import { expect } from "chai";
import {
  time,
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { formatEther, parseEther } from "ethers";

import { hexlify } from '@ethersproject/bytes';
import { randomBytes } from '@ethersproject/random';

import { getFixture } from './setup';
import {
  extractLien,
  prepareLoanOffer,
  prepareLoanOfferAuth,
  prepareRenegotiationOffer,
  prepareRenegotiationOfferAuth
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
import {
  Kettle,
  TestERC1155,
  TestERC20,
  TestERC721,
  ERC721EscrowBase,
  ERC1155EscrowBase,
  CollateralVerifier
} from "../typechain-types";
import { LienPointer } from "../types";

const DAY_SECONDS = 24 * 60 * 60;
const MONTH_SECONDS = (DAY_SECONDS * 365) / 12;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;
  let feeRecipient: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;

  let verifier: CollateralVerifier;
  let erc721Escrow: ERC721EscrowBase;
  let erc1155Escrow: ERC1155EscrowBase;

  let blockTimestamp: number;

  const tokenId1 = 1;
  const tokenId2 = 2;

  const token1Amount = 2;
  const token2Amount = 2;

  let loanAmount: bigint;
  let repaymentAmount: bigint;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      authSigner,
      feeRecipient,
      kettle,
      testErc721,
      testErc1155,
      testErc20,
      erc721Escrow,
      erc1155Escrow,
      verifier
    } = await loadFixture(getFixture));

    loanAmount = ethers.parseEther("10");

    await testErc721.mint(borrower, tokenId1);
    await testErc721.mint(borrower, tokenId2);

    await testErc1155.mint(borrower, tokenId1, token1Amount);
    await testErc1155.mint(borrower, tokenId2, token2Amount);

    await testErc20.mint(lender, loanAmount);

    blockTimestamp = await time.latest();
  });

  describe("Renegotiation", () => {
    let lien: LienStruct;
    let lienId: bigint;

    let offer: LoanOfferStruct;
    let offerSignature: string;
    let offerHash: string;

    let auth: OfferAuthStruct;
    let authSignature: string;


    beforeEach(async () => {
      // construct offer and signature
      ({ offer, offerSignature, offerHash } = await prepareLoanOffer(
        kettle,
        lender,
        {
          collateralType: CollateralType.ERC721,
          collateralIdentifier: tokenId1,
          lender: lender,
          collection: testErc721,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: MONTH_SECONDS,
          rate: 120_000,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: [{
            rate: 2_100,
            recipient: await feeRecipient.getAddress()
          }]
        }));

      // construct auth and signature
      ({ auth, authSignature } = await prepareLoanOfferAuth(
        kettle,
        authSigner,
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        offer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      ));

      // start loan
      let txn = await kettle.connect(borrower).borrow(
        offer,
        auth,
        offerSignature,
        authSignature,
        loanAmount,
        tokenId1,
        ADDRESS_ZERO,
        []
      );

      // extract lien and lien id
      ({ lien, lienId } = await txn.wait().then(
        (receipt) => extractLien(receipt!, kettle)
      ));
    });

    it('should renegotiate loan with updated terms', async () => {
      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId,
          lienHash,
          newDuration: MONTH_SECONDS * 2,
          newRate: 60_000,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: []
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // take renegotation offer
      let txn = await kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      );

      // extract lien and lien id
      const { lien: newLien, lienId: newLienId } = await txn.wait().then(
        (receipt) => extractLien(receipt!, kettle)
      );

      // expect repayment amounts to be the same
      const oldRepayAmount = await kettle.getRepaymentAmount(
        lien.borrowAmount,
        lien.duration,
        lien.rate
      );

      const newRepayAmount = await kettle.getRepaymentAmount(
        newLien.borrowAmount,
        newLien.duration,
        newLien.rate
      );

      expect(oldRepayAmount).to.equal(newRepayAmount);

      // expect new lien to match old lien non-updated fields
      expect(newLien.lender).to.equal(lien.lender);
      expect(newLien.borrower).to.equal(lien.borrower);
      expect(newLien.currency).to.equal(lien.currency);
      expect(newLien.collection).to.equal(lien.collection);
      expect(newLien.collateralType).to.equal(lien.collateralType);
      expect(newLien.tokenId).to.equal(lien.tokenId);
      expect(newLien.amount).to.equal(lien.amount);
      expect(newLien.borrowAmount).to.equal(lien.borrowAmount);
      expect(newLien.startTime).to.equal(lien.startTime);

      // expect new lien to match old lien except offerHash, duration, and rate
      expect(newLien.offerHash).to.equal(offerHash);
      expect(newLien.duration).to.equal(MONTH_SECONDS * 2);
      expect(newLien.rate).to.equal(60_000);

      // expect new lien to match old lien except offerHash, duration, and rate
      expect(newLien.offerHash).to.not.equal(lien.offerHash);
      expect(newLien.duration).to.not.equal(lien.duration);
      expect(newLien.rate).to.not.equal(lien.rate);
    })

    it('should renegotiate with fee', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId,
          lienHash,
          newDuration: MONTH_SECONDS * 2,
          newRate: 60_000,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: [{
            rate: 2_100,
            recipient: await feeRecipient.getAddress()
          }]
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // take renegotation offer
      let txn = await kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      );

      // extract lien and lien id
      const { lien: newLien, lienId: newLienId } = await txn.wait().then(
        (receipt) => extractLien(receipt!, kettle)
      );

      // expect repayment amounts to be different
      const oldRepayAmount = await kettle.getRepaymentAmount(
        lien.borrowAmount,
        lien.duration,
        lien.rate
      );

      const newRepayAmount = await kettle.getRepaymentAmount(
        newLien.borrowAmount,
        newLien.duration,
        newLien.rate
      );

      expect(newRepayAmount).to.equal(oldRepayAmount);

      // expect new lien to match old lien non-updated fields
      expect(newLien.lender).to.equal(lien.lender);
      expect(newLien.borrower).to.equal(lien.borrower);
      expect(newLien.currency).to.equal(lien.currency);
      expect(newLien.collection).to.equal(lien.collection);
      expect(newLien.collateralType).to.equal(lien.collateralType);
      expect(newLien.tokenId).to.equal(lien.tokenId);
      expect(newLien.amount).to.equal(lien.amount);
      expect(newLien.borrowAmount).to.equal(lien.borrowAmount);
      expect(newLien.startTime).to.equal(lien.startTime);

      // expect new lien to match old lien except offerHash, duration, and rate
      expect(newLien.offerHash).to.equal(offerHash);
      expect(newLien.duration).to.equal(MONTH_SECONDS * 2);
      expect(newLien.rate).to.equal(60_000);

      // expect new lien to match old lien except offerHash, duration, and rate
      expect(newLien.offerHash).to.not.equal(lien.offerHash);
      expect(newLien.duration).to.not.equal(lien.duration);
      expect(newLien.rate).to.not.equal(lien.rate);
    })

    it('should renegotiate with updated repayment', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId,
          lienHash,
          newDuration: MONTH_SECONDS * 2,
          newRate: 120_000,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: [{
            rate: 2_100,
            recipient: await feeRecipient.getAddress()
          }]
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // take renegotation offer
      let txn = await kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      );

      // extract lien and lien id
      const { lien: newLien, lienId: newLienId } = await txn.wait().then(
        (receipt) => extractLien(receipt!, kettle)
      );

      // expect repayment amounts to be different
      const oldRepayAmount = await kettle.getRepaymentAmount(
        lien.borrowAmount,
        lien.duration,
        lien.rate
      );

      const newRepayAmount = await kettle.getRepaymentAmount(
        newLien.borrowAmount,
        newLien.duration,
        newLien.rate
      );

      expect(newRepayAmount - loanAmount).to.equal((oldRepayAmount - loanAmount) * 2n);

      // expect new lien to match old lien non-updated fields
      expect(newLien.lender).to.equal(lien.lender);
      expect(newLien.borrower).to.equal(lien.borrower);
      expect(newLien.currency).to.equal(lien.currency);
      expect(newLien.collection).to.equal(lien.collection);
      expect(newLien.collateralType).to.equal(lien.collateralType);
      expect(newLien.tokenId).to.equal(lien.tokenId);
      expect(newLien.amount).to.equal(lien.amount);
      expect(newLien.borrowAmount).to.equal(lien.borrowAmount);
      expect(newLien.startTime).to.equal(lien.startTime);

      // expect new lien to match old lien except offerHash, duration, and rate
      expect(newLien.offerHash).to.equal(offerHash);
      expect(newLien.duration).to.equal(MONTH_SECONDS * 2);
      expect(newLien.rate).to.equal(120_000);

      // expect new lien to match old lien except offerHash, duration, and rate
      expect(newLien.offerHash).to.not.equal(lien.offerHash);
      expect(newLien.duration).to.not.equal(lien.duration);
    })

    it('should revert if caller is not lender', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId,
          lienHash,
          newDuration: DAY_SECONDS * 60,
          newRate: 500,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: []
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // take renegotation offer
      await expect(kettle.connect(feeRecipient).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "Unauthorized");
    })

    it('should revert if lienId does not match provided lienId', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId: lienId + BigInt(1),
          lienHash,
          newDuration: DAY_SECONDS * 60,
          newRate: 500,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: []
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // take renegotation offer
      await expect(kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "LienIdMismatch");
    })

    it('should revert if lienHash does not match stored lienHash', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId: lienId,
          lienHash: hexlify(randomBytes(32)).toString(),
          newDuration: DAY_SECONDS * 60,
          newRate: 500,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: []
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // take renegotation offer
      await expect(kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "InvalidLienHash");
    })

    it('should revert if new endtime is less than current blocktime', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId,
          lienHash,
          newDuration: DAY_SECONDS * 20,
          newRate: 500,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: []
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      await time.setNextBlockTimestamp(BigInt(await time.latest()) + BigInt(DAY_SECONDS * 21));

      // take renegotation offer
      await expect(kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "InvalidDuration");
    })

    it('should revert if borrower is not borrower of lien', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower: feeRecipient,
          lienId,
          lienHash,
          newDuration: DAY_SECONDS * 20,
          newRate: 500,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: []
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // increment nonce
      await kettle.connect(borrower).incrementNonce();

      // take renegotation offer
      await expect(kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "BorrowersDoNotMatch");
    })

    it('should revert if borrower updates nonce', async () => {

      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        borrower,
        {
          borrower,
          lienId,
          lienHash,
          newDuration: DAY_SECONDS * 20,
          newRate: 500,
          expiration: blockTimestamp + DAY_SECONDS * 365,
          fees: []
        }
      );

      // construct auth and signature
      const { auth: renegotiationAuth, authSignature } = await prepareRenegotiationOfferAuth(
        kettle,
        authSigner,
        lender,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          amount: 1
        }
      );

      // increment nonce
      await kettle.connect(borrower).incrementNonce();

      // take renegotation offer
      await expect(kettle.connect(lender).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "InvalidSignature");
    })
  });
});
