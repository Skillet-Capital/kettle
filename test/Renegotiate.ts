import { expect } from "chai";
import {
  time,
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

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
  TestERC721
} from "../typechain-types";

const DAY_SECONDS = 24 * 60 * 60;
const MONTH_SECONDS = (DAY_SECONDS * 365) / 12;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const BYTES32_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000"

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;
  let feeRecipient: Signer;
  let signers: Signer[];

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;

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
      signers,
      kettle,
      testErc721,
      testErc1155,
      testErc20,
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
          identifier: tokenId1,
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
          size: 1
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
        false,
        []
      );

      // extract lien and lien id
      ({ lien, lienId } = await txn.wait().then(
        (receipt) => extractLien(receipt!, kettle)
      ));
    });

    it('should renegotiate loan and update terms', async () => {
      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
          lienId,
          lienHash: BYTES32_ZERO,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // take renegotation offer
      let txn = await kettle.connect(borrower).renegotiate(
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
        lien.amount,
        lien.duration,
        lien.rate
      );

      const newRepayAmount = await kettle.getRepaymentAmount(
        newLien.amount,
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
      expect(newLien.size).to.equal(lien.size);
      expect(newLien.amount).to.equal(lien.amount);
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

    it('should renegotiate loan with specified lien hash and update terms', async () => {
      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // take renegotation offer
      let txn = await kettle.connect(borrower).renegotiate(
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
        lien.amount,
        lien.duration,
        lien.rate
      );

      const newRepayAmount = await kettle.getRepaymentAmount(
        newLien.amount,
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
      expect(newLien.size).to.equal(lien.size);
      expect(newLien.amount).to.equal(lien.amount);
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

    it('should renegotiate loan with fee', async () => {

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
          lienId,
          lienHash: BYTES32_ZERO,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // take renegotation offer
      let txn = await kettle.connect(borrower).renegotiate(
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
        lien.amount,
        lien.duration,
        lien.rate
      );

      const newRepayAmount = await kettle.getRepaymentAmount(
        newLien.amount,
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
      expect(newLien.size).to.equal(lien.size);
      expect(newLien.amount).to.equal(lien.amount);
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

    it('should FAIL to renegotiate if caller is not the borrower (Unauthorized)', async () => {
      const lienHash = await kettle.liens(lienId);

      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // take renegotation offer
      await expect(kettle.connect(signers[0]).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "Unauthorized");
    });

    it('should FAIL to renegotiate if lien hash is nonzero does not match (InvalidLienHash)', async () => {
      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
          lienId,
          lienHash: hexlify(randomBytes(32)).toString(),
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // take renegotation offer
     await expect(kettle.connect(borrower).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "InvalidLienHash")
    })

    it('should FAIL to renegotiate if signed lender is not current lender (LendersDoNotMatch)', async () => {
      const [signer] = signers;

      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        signer,
        {
          lender: signer,
          lienId,
          lienHash: BYTES32_ZERO,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // take renegotation offer
      await expect(kettle.connect(borrower).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "LendersDoNotMatch");
    })

    it('should FAIL to renegotiate if offer lienId does not match provided lienId (LienIdMismatch)', async () => {
      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
          lienId: lienId + BigInt(1),
          lienHash: BYTES32_ZERO,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // take renegotation offer
      await expect(kettle.connect(borrower).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "LienIdMismatch");
    })

    it('should FAIL to renegotiate if new endtime is less than current blocktime (InvalidDuration)', async () => {
      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
          lienId,
          lienHash: BYTES32_ZERO,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      await time.setNextBlockTimestamp(BigInt(await time.latest()) + BigInt(DAY_SECONDS * 21));

      // take renegotation offer
      await expect(kettle.connect(borrower).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "InvalidDuration");
    })

    it('should revert if lender updates nonce (InvalidSignature)', async () => {
      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
          lienId,
          lienHash: BYTES32_ZERO,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // increment nonce
      await kettle.connect(lender).incrementNonce();

      // take renegotation offer
      await expect(kettle.connect(borrower).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "InvalidSignature");
    })

    it('should revert if lender cancels offer (OfferUnavailable)', async () => {
      // construct offer and signature
      const { offer: renegotiationOffer, offerSignature, offerHash } = await prepareRenegotiationOffer(
        kettle,
        lender,
        {
          lender,
          lienId,
          lienHash: BYTES32_ZERO,
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
        borrower,
        await time.latest() + DAY_SECONDS * 365,
        renegotiationOffer,
        {
          collateralType: CollateralType.ERC721,
          tokenId: tokenId1,
          collection: testErc721,
          size: 1
        }
      );

      // cancel offer salt
      await kettle.connect(lender).cancelOffers([renegotiationOffer.salt]);

      // take renegotation offer
      await expect(kettle.connect(borrower).renegotiate(
        lien,
        lienId,
        renegotiationOffer,
        renegotiationAuth,
        offerSignature,
        authSignature
      )).to.be.revertedWithCustomError(kettle, "OfferUnavailable");
    })
  });
});
