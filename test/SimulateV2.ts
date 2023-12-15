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
  prepareLoanOfferAuth,
  prepareBorrowOffer,
  prepareBorrowOfferAuth,
  prepareRenegotiationOffer,
  prepareRenegotiationOfferAuth
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { BorrowOfferStruct, LienStruct, LoanOfferStruct, OfferAuthStruct, RenegotiationOfferStruct } from "../typechain-types/contracts/Kettle";
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
const BYTES32_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000"

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

    const criteria = generateMerkleRootForCollection([tokenId1, tokenId2]);

    let loanAmount: bigint;

    beforeEach(async () => {
      loanAmount = ethers.parseEther("10");

      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc1155.mint(borrower, tokenId1, token1Amount);
      await testErc1155.mint(borrower, tokenId2, token2Amount);

      await testErc20.mint(lender, loanAmount);
    });

    describe("Prepare", () => {
      let loanOfferHash: string;
      let loanOffer: LoanOfferStruct;
      let loanOfferSignature: string;
  
      let loanOfferAuth: OfferAuthStruct;
      let loanOfferAuthSignature: string;
  
      let criteriaLoanOfferHash: string;
      let criteriaLoanOffer: LoanOfferStruct;
      let criteriaLoanOfferSignature: string;
  
      let criteriaLoanOfferAuth: OfferAuthStruct;
      let criteriaLoanOfferAuthSignature: string;
  
      let borrowOfferHash: string;
      let borrowOffer: BorrowOfferStruct;
      let borrowOfferSignature: string;
  
      let borrowOfferAuth: OfferAuthStruct;
      let borrowOfferAuthSignature: string;

      let refinanceOfferHash: string;
      let refinanceOffer: LoanOfferStruct;
      let refinanceOfferSignature: string;

      let refinanceOfferAuth: OfferAuthStruct;
      let refinanceOfferAuthSignature: string;

      let renegotiationOfferHash: string;
      let renegotiationOffer: RenegotiationOfferStruct;
      let renegotiationOfferSignature: string;

      let renegotiationOfferAuth: OfferAuthStruct;
      let renegotiationOfferAuthSignature: string;
  
      beforeEach(async () => {
  
        // construct loan offer and signature
        ({ 
          offer: loanOffer, 
          offerSignature: loanOfferSignature, 
          offerHash: loanOfferHash
        } = await prepareLoanOffer(
          kettle,
          lender,
          {
            collateralType: CollateralType.ERC721,
            identifier: tokenId1,
            lender: lender,
            collection: testErc721,
            currency: testErc20,
            totalAmount: loanAmount,
            minAmount: loanAmount,
            maxAmount: loanAmount,
            duration: DAY_SECONDS * 30,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 365,
            fees: [{
              rate: 2_100,
              recipient: await feeRecipient.getAddress()
            }]
        }));
        
        // construct loan offer auth and signature
        ({ 
          auth: loanOfferAuth, 
          authSignature: loanOfferAuthSignature
        } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          await time.latest() + DAY_SECONDS * 365,
          loanOffer,
          {
            collateralType: CollateralType.ERC721,
            tokenId: tokenId1,
            collection: testErc721,
            size: 1
          }
        ));
  
        // construct criteria loan offer and signature
        ({
          offer: criteriaLoanOffer,
          offerSignature: criteriaLoanOfferSignature,
          offerHash: criteriaLoanOfferHash
        } = await prepareLoanOffer(
          kettle,
          lender,
          {
            collateralType: CollateralType.ERC721_WITH_CRITERIA,
            identifier: criteria,
            lender: lender,
            collection: testErc721,
            currency: testErc20,
            totalAmount: loanAmount,
            minAmount: loanAmount,
            maxAmount: loanAmount,
            duration: DAY_SECONDS * 30,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 365,
            fees: [{
              rate: 2_100,
              recipient: await feeRecipient.getAddress()
            }]
          })
        );
  
        // construct criteria loan offer auth and signature
        ({ 
          auth: criteriaLoanOfferAuth, 
          authSignature: criteriaLoanOfferAuthSignature
        } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          await time.latest() + DAY_SECONDS * 365,
          criteriaLoanOffer,
          {
            collateralType: CollateralType.ERC721,
            tokenId: tokenId1,
            collection: testErc721,
            size: 1
          }
        ));
  
        // construct borrow offer and signature
        ({ 
          offer: borrowOffer, 
          offerSignature: borrowOfferSignature, 
          offerHash: borrowOfferHash
        } = await prepareBorrowOffer(
          kettle,
          borrower,
          {
            borrower: borrower,
            collateralType: CollateralType.ERC721,
            tokenId: tokenId1,
            collection: testErc721,
            currency: testErc20,
            amount: loanAmount,
            duration: DAY_SECONDS * 30,
            rate: 100_000,
            expiration: blockTimestamp + DAY_SECONDS * 7,
          }
        ));
  
        ({ 
          auth: borrowOfferAuth, 
          authSignature: borrowOfferAuthSignature
        } = await prepareBorrowOfferAuth(
          kettle,
          authSigner,
          lender,
          await time.latest() + 100,
          borrowOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));

        // construct refinance offer and signature
        ({ offer: refinanceOffer, offerSignature: refinanceOfferSignature, offerHash: refinanceOfferHash } = await prepareLoanOffer(
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

        // construct refinance offer auth and signature
        ({ auth: refinanceOfferAuth, authSignature: refinanceOfferAuthSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          blockTimestamp + DAY_SECONDS * 7,
          refinanceOffer,
          {
            collateralType: CollateralType.ERC721,
            collection: testErc721,
            tokenId: tokenId1,
            size: 1
          }
        ));
      });

      for (const action of ["borrow", "borrow-criteria", "loan"]) {
        describe(action, () => {
          let lien: LienStruct;
          let lienId: bigint;

          it("simulate", async () => {

            let txn;

            if (action === "borrow") {
              txn = await kettle.connect(borrower).borrow(
                loanOffer,
                loanOfferAuth,
                loanOfferSignature,
                loanOfferAuthSignature,
                loanAmount,
                tokenId1,
                ADDRESS_ZERO,
                []
              );

            } else if (action === "borrow-criteria") {
              txn = await kettle.connect(borrower).borrow(
                criteriaLoanOffer,
                criteriaLoanOfferAuth,
                criteriaLoanOfferSignature,
                criteriaLoanOfferAuthSignature,
                loanAmount,
                tokenId1,
                ADDRESS_ZERO,
                generateMerkleProofForToken([tokenId1, tokenId2], tokenId1)
              );

            } else if (action === "loan") {
              txn = await kettle.connect(lender).loan(
                borrowOffer,
                borrowOfferAuth,
                borrowOfferSignature,
                borrowOfferAuthSignature
              );
            }

            // fetch lien and lien id
            ({ lien, lienId } = await txn!.wait().then((receipt) => extractLien(receipt!, kettle)));
            
            if (action === "borrow") {
              expect(lien.offerHash).to.equal(loanOfferHash);
            } else if (action === "borrow-criteria") {
              expect(lien.offerHash).to.equal(criteriaLoanOfferHash);
            } else if (action === "loan") {
              expect(lien.offerHash).to.equal(borrowOfferHash);
            }
            
            txn = await kettle.connect(borrower).refinance(
              lien,
              lienId,
              loanAmount,
              refinanceOffer,
              refinanceOfferAuth,
              refinanceOfferSignature,
              refinanceOfferAuthSignature,
              []
            );

            ({ lien, lienId } = await txn!.wait().then((receipt) => extractLien(receipt!, kettle)));
            expect(lien.offerHash).to.equal(refinanceOfferHash);

            // construct renegotiation and signature
            const { 
              offer: renegotiationOffer, 
              offerSignature: renegotiationOfferSignature, 
              offerHash: renegotiationOfferHash
            } = await prepareRenegotiationOffer(
              kettle,
              lender,
              {
                lender,
                lienId,
                lienHash: BYTES32_ZERO,
                newDuration: DAY_SECONDS * 60,
                newRate: 200_000,
                expiration: blockTimestamp + DAY_SECONDS * 365,
                fees: []
              }
            );
            
            // construct renegotiation auth and signature
            const { 
              auth: renegotiationOfferAuth, 
              authSignature: renegotiationOfferAuthSignature 
            } = await prepareRenegotiationOfferAuth(
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

            txn = await kettle.connect(borrower).renegotiate(
              lien,
              lienId,
              renegotiationOffer,
              renegotiationOfferAuth,
              renegotiationOfferSignature,
              renegotiationOfferAuthSignature
            );

            ({ lien, lienId } = await txn!.wait().then((receipt) => extractLien(receipt!, kettle)));
            expect(lien.offerHash).to.equal(renegotiationOfferHash);

            // repay
            const repaymentAmount = await kettle.getRepaymentAmount(
              lien!.amount,
              lien!.rate,
              lien!.duration
            );

            await testErc20.mint(borrower, repaymentAmount);

            txn = await kettle.connect(borrower).repay(lien, lienId);
          });
        });
      }
    })
  });
});
