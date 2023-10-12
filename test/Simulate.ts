import { expect } from "chai";
import {
  time,
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { formatEther, parseEther } from "ethers";

import { getFixture } from './setup';
import {
  formatLien,
  getLoanOffer,
  signLoanOffer,
  signOfferAuth,
  hashCollateral,
  generateMerkleRootForCollection,
  generateMerkleProofForToken,
  extractLien,
  prepareLoanOffer,
  prepareLoanOfferAuth
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

    blockTimestamp = await time.latest();
  });

  describe("Simulate", () => {
    const tokenId1 = 1;
    const tokenId2 = 2;

    const token1Amount = 2;
    const token2Amount = 2;

    let lien: LienStruct;
    let lienId: bigint;

    let offer: LoanOfferStruct;
    let offerSignature: string;
    let offerHash: string;

    let auth: OfferAuthStruct;
    let authSignature: string;

    let loanAmount: bigint;
    let repaymentAmount: bigint;

    beforeEach(async () => {
      loanAmount = ethers.parseEther("10");

      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc1155.mint(borrower, tokenId1, token1Amount);
      await testErc1155.mint(borrower, tokenId2, token2Amount);

      await testErc20.mint(lender, loanAmount);
    });

    describe('Same loan refinance', () => {

      it('should refinance with the same loan offer', async () => {
        const LOAN_COUNT = 12;

        // expect initail balances
        expect(await testErc20.balanceOf(lender)).to.equal(loanAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(0);

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
            totalAmount: loanAmount * BigInt(LOAN_COUNT),
            minAmount: loanAmount,
            maxAmount: loanAmount,
            // duration: DAY_SECONDS * 30,
            duration: 2628000,
            rate: 100_000,
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

        // initialize lien parameters
        const initialTime = lien.startTime;

        console.log("\nAction\t\t|\tBorrower|\tLender\t|\tFees\t|\tStart\t|\tDue\t|");
        console.log("-------------------------------------------------------------------------------------------------");

        console.log(
          "Start Loan\t|\t", 
          await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|\t",
          (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|"
        );

        // get repayment amount
        repaymentAmount = await kettle.getRepaymentAmount(
          lien.borrowAmount,
          lien.rate,
          lien.duration
        );

        // initialize fee amount
        let feeAmount = loanAmount * BigInt(offer.fees[0].rate) / BigInt(1_000_000);
        
        // initialize interest amount
        let interestAmount = repaymentAmount - loanAmount;

        // expect balances are updated
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount - feeAmount);

        // *****************************
        // setup of cascading refinance
        // *****************************
        for (var i=0; i<LOAN_COUNT-1; i++) {

          await testErc20.mint(borrower, interestAmount);
          await testErc20.mint(borrower, feeAmount);
          await time.setNextBlockTimestamp(BigInt(await time.latest()) + BigInt(lien.duration) - BigInt(DAY_SECONDS * 10));

          // expect initial borrower balance to equal the repayment amount
          expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

          txn = await kettle.connect(borrower).refinance(
            lien,
            lienId,
            loanAmount,
            offer,
            auth,
            offerSignature,
            authSignature,
            []
          );

          // extract lien and lien id
          ({ lien, lienId } = await txn.wait().then(
            (receipt) => extractLien(receipt!, kettle)
          ));

          console.log(
            `Refi Loan ${i + 1}\t|\t`, 
            await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
            "\t|\t",
            (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
            "\t|"
          );

          // expect the difference in loan times to be the duration on early repayment
          expect(lien.startTime).to.equal(BigInt(lien.duration) * BigInt(i + 1 ) + BigInt(initialTime));

          // expect borrower balance to just be loan amount
          expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount - feeAmount);

          // expect lender balance to equal total interest paid
          expect(await testErc20.balanceOf(lender)).to.equal((interestAmount) * BigInt(i + 1));
        }

        // repay loan
        await testErc20.mint(borrower, interestAmount);
        await testErc20.mint(borrower, feeAmount);

        await kettle.connect(borrower).repay(lien, lienId);

        console.log(
          `Repay Loan\t|\t`, 
          await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|\t",
          (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|"
        );
      })

      it('should refinance with the same loan offer (amortizing)', async () => {
        const LOAN_COUNT = 12;

        // expect initail balances
        expect(await testErc20.balanceOf(lender)).to.equal(loanAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(0);

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
            totalAmount: loanAmount * BigInt(LOAN_COUNT),
            minAmount: 0,
            maxAmount: loanAmount,
            // duration: DAY_SECONDS * 30,
            duration: 2628000,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 365,
            fees: [{
              rate: "0",
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

        // initialize lien parameters
        const initialTime = lien.startTime;

        console.log("\nAction\t\t|\tBorrower|\tLender\t|\tFees\t|\tStart\t|\tDue\t|");
        console.log("-------------------------------------------------------------------------------------------------");

        console.log(
          "Start Loan\t|\t", 
          await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|\t",
          (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|"
        );

        // get repayment amount
        repaymentAmount = await kettle.getRepaymentAmount(
          lien.borrowAmount,
          lien.rate,
          lien.duration
        );

        // initialize fee amount
        let feeAmount = loanAmount * BigInt(offer.fees[0].rate) / BigInt(10000);
        
        // initialize interest amount
        let interestAmount = repaymentAmount - loanAmount;

        // expect balances are updated
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount - feeAmount);

        // *****************************
        // setup of cascading refinance
        // *****************************
        let lastRepayAmount = repaymentAmount;
        for (var i=0; i<LOAN_COUNT-1; i++) {

          await testErc20.mint(borrower, interestAmount);
          await testErc20.mint(borrower, feeAmount);
          await time.setNextBlockTimestamp(BigInt(await time.latest()) + BigInt(lien.duration) - BigInt(DAY_SECONDS * 10));

          // expect initial borrower balance to equal the repayment amount
          // expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

          const 
          txn = await kettle.connect(borrower).refinance(
            lien,
            lienId,
            // repaymentAmount - parseEther((1.646879439 * (i + 1)).toString()),
            lastRepayAmount - parseEther("0.8791588723"),
            offer,
            auth,
            offerSignature,
            authSignature,
            []
          );

          // extract lien and lien id
          ({ lien, lienId } = await txn.wait().then(
            (receipt) => extractLien(receipt!, kettle)
          ));

          lastRepayAmount = await kettle.getRepaymentAmount(
            lien.borrowAmount,
            lien.rate,
            lien.duration
          );

          console.log(
            `Refi Loan ${i + 1}\t|\t`, 
            await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
            "\t|\t",
            (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
            "\t|"
          );

          // expect the difference in loan times to be the duration on early repayment
          // expect(lien.startTime).to.equal(BigInt(lien.duration) * BigInt(i + 1 ) + BigInt(initialTime));

          // // expect borrower balance to just be loan amount
          // expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount - feeAmount);

          // // expect lender balance to equal total interest paid
          // expect(await testErc20.balanceOf(lender)).to.equal((interestAmount) * BigInt(i + 1));
        }

        // repay loan
        await testErc20.mint(borrower, interestAmount);
        await testErc20.mint(borrower, feeAmount);

        await kettle.connect(borrower).repay(lien, lienId);

        console.log(
          `Repay Loan\t|\t`, 
          await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|\t",
          (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|"
        );
      })

      it('should refinance with different loan offer', async () => {
        const LOAN_COUNT = 12;

        // expect initail balances
        expect(await testErc20.balanceOf(lender)).to.equal(loanAmount);
        expect(await testErc20.balanceOf(borrower)).to.equal(0);

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
            totalAmount: loanAmount * BigInt(LOAN_COUNT),
            minAmount: loanAmount,
            maxAmount: loanAmount,
            duration: DAY_SECONDS * 30,
            rate: 121_667,
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

        // initialize lien parameters
        const initialTime = lien.startTime;

        console.log("\nAction\t\t|\tBorrower|\tLender\t|\tFees\t|\tStart\t|\tDue\t|");
        console.log("-------------------------------------------------------------------------------------------------");

        console.log(
          "Start Loan\t|\t", 
          await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|\t",
          (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|"
        );

        // get repayment amount
        repaymentAmount = await kettle.getRepaymentAmount(
          lien.borrowAmount,
          lien.rate,
          lien.duration
        );

        // initialize fee amount
        let feeAmount = loanAmount * BigInt(offer.fees[0].rate) / BigInt(1_000_000);
        
        // initialize interest amount
        let interestAmount = repaymentAmount - loanAmount;

        // expect balances are updated
        expect(await testErc20.balanceOf(lender)).to.equal(0);
        expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount - feeAmount);

        // *****************************
        // setup of different refinance
        // *****************************
        const { offer: refiOffer, offerSignature: refiSignature } = await prepareLoanOffer(
          kettle,
          lender,
          {
            collateralType: CollateralType.ERC721,
            collateralIdentifier: tokenId1,
            lender: lender,
            collection: testErc721,
            currency: testErc20,
            totalAmount: loanAmount * BigInt(LOAN_COUNT),
            minAmount: loanAmount,
            maxAmount: loanAmount,
            duration: DAY_SECONDS * 30,
            rate: 121_667,
            expiration: blockTimestamp + DAY_SECONDS * 365,
            fees: [{
              rate: 2_100,
              recipient: await feeRecipient.getAddress()
            }]
        });

        // construct auth and signature
        const { auth: refiAuth, authSignature: refiAuthSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          await time.latest() + DAY_SECONDS * 365,
          refiOffer,
          {
            collateralType: CollateralType.ERC721,
            tokenId: tokenId1,
            collection: testErc721,
            amount: 1
          }
        );

        await testErc20.mint(borrower, interestAmount);
        await testErc20.mint(borrower, feeAmount);

        await time.setNextBlockTimestamp(BigInt(await time.latest()) + BigInt(lien.duration) - BigInt(DAY_SECONDS * 10));

        txn = await kettle.connect(borrower).refinance(
          lien,
          lienId,
          loanAmount,
          refiOffer,
          refiAuth,
          refiSignature,
          refiAuthSignature,
          []
        );

        // extract lien and lien id
        ({ lien, lienId } = await txn.wait().then(
          (receipt) => extractLien(receipt!, kettle)
        ));

        console.log(
          `Refi Loan\t|\t`, 
          await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|\t",
          (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|"
        );

        // expect the new lien start time to only be 20 days after the initial time (no diff added)
        // expect(lien.startTime).to.equal(BigInt(initialTime) + BigInt(DAY_SECONDS * 20));

        for (var i=0; i<LOAN_COUNT-2; i++) {

          await testErc20.mint(borrower, interestAmount);
          await testErc20.mint(borrower, feeAmount);
          await time.setNextBlockTimestamp(BigInt(await time.latest()) + BigInt(lien.duration) - BigInt(DAY_SECONDS * 10));

          // expect initial borrower balance to equal the repayment amount
          expect(await testErc20.balanceOf(borrower)).to.equal(repaymentAmount);

          txn = await kettle.connect(borrower).refinance(
            lien,
            lienId,
            loanAmount,
            refiOffer,
            refiAuth,
            refiSignature,
            refiAuthSignature,
            []
          );

          // extract lien and lien id
          ({ lien, lienId } = await txn.wait().then(
            (receipt) => extractLien(receipt!, kettle)
          ));

          console.log(
            `Refi Loan ${i + 1}\t|\t`, 
            await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
            "\t|\t",
            (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
            "\t|\t",
            (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
            "\t|"
          );

          // expect the difference in loan times to be the duration on early repayment
          // expect(lien.startTime).to.equal(BigInt(lien.duration) * BigInt(i + 1 ) + BigInt(initialTime));

          // // expect borrower balance to just be loan amount
          // expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount - feeAmount);

          // // expect lender balance to equal total interest paid
          // expect(await testErc20.balanceOf(lender)).to.equal((interestAmount) * BigInt(i + 2));
        }

        // repay loan
        await testErc20.mint(borrower, interestAmount);
        await testErc20.mint(borrower, feeAmount);

        await kettle.connect(borrower).repay(lien, lienId);

        console.log(
          `Repay Loan\t|\t`, 
          await testErc20.balanceOf(borrower).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(lender).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          await testErc20.balanceOf(feeRecipient).then(b => parseFloat(formatEther(b)).toFixed(2)),
          "\t|\t",
          (BigInt(lien.startTime) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|\t",
          (BigInt(lien.startTime) + BigInt(lien.duration) - BigInt(initialTime)) / BigInt(DAY_SECONDS),
          "\t|"
        );
      })
    })
  });
});
