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
  extractLien,
  signLoanOffer,
  hashCollateral,
  signOfferAuth,
  prepareLoanOfferAuth
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
  let feeRecipient: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;

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
      testErc20
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Fees", () => {

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

    describe("collateralType === ERC721", () => {
      let tokenOffer: LoanOfferStruct;
      let offerSignature: string;

      let offerHash: string;
      let collateralHash: string;
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
          collection: testErc721,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 100_000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
          fees: [
            {
              rate: 5_000,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 5_000,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 5_000,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 5_000,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 5_000,
              recipient: await feeRecipient.getAddress()
            }
          ]
        }));

        ({ auth: offerAuth, authSignature } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          await time.latest() + DAY_SECONDS * 7,
          tokenOffer,
          {
            collateralType: CollateralType.ERC721,
            tokenId: tokenId1,
            collection: testErc721,
            size: 1
          }
        ))
      });

      it('should start loan with fees', async () => {
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature, 
          authSignature,
          loanAmount, 
          1,
          ADDRESS_ZERO,
          [],
        );

        // extract lien log
        const lien = await txn.wait().then(
          async (receipt) => extractLien(receipt!, kettle)
        );
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());

        const netLoanAmount = loanAmount * BigInt(9_750) / BigInt(10_000);
        expect(await testErc20.balanceOf(borrower)).to.equal(netLoanAmount);
        expect(await testErc20.balanceOf(feeRecipient)).to.equal(loanAmount - netLoanAmount)
      });

      it('should start loans in bulk with fees', async () => {
        const { offer: tokenOffer2, offerSignature: offerSignature2 } = await prepareLoanOffer(
          kettle,
          lender,
          {
          lender: lender,
          collateralType: CollateralType.ERC721,
          identifier: tokenId2,
          collection: testErc721,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 100_000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
          fees: [{
            rate: 25_000,
            recipient: await feeRecipient.getAddress()
          }]
        });

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          await time.latest() + DAY_SECONDS * 7,
          tokenOffer2,
          {
            collateralType: CollateralType.ERC721,
            tokenId: tokenId2,
            collection: testErc721,
            size: 1
          }
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
              offerIndex: 0,
              amount: ethers.parseEther("5"),
              tokenId: 1,
              proof: [],
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 1,
              amount: ethers.parseEther("5"),
              tokenId: 2,
              proof: [],
              auth: offerAuth2,
              authSignature: authSignature2
            }
          ],
          ADDRESS_ZERO
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await kettle.getAddress());

        const netLoanAmount = loanAmount * BigInt(9_750) / BigInt(10_000);

        expect(await testErc20.balanceOf(borrower)).to.equal(netLoanAmount);
        expect(await testErc20.balanceOf(feeRecipient)).to.equal(loanAmount - netLoanAmount)
      });

      it('should revert if fees are too high', async () => {
        const { offer: tokenOffer2, offerSignature: offerSignature2 } = await prepareLoanOffer(
          kettle,
          lender,
          {
          lender: lender,
          collateralType: CollateralType.ERC721,
          identifier: tokenId2,
          collection: testErc721,
          currency: testErc20,
          totalAmount: loanAmount,
          minAmount: 0,
          maxAmount: loanAmount,
          duration: DAY_SECONDS * 7,
          rate: 100_000,
          expiration: blockTimestamp + DAY_SECONDS * 7,
          fees: [
            {
            rate: 999_999,
            recipient: await feeRecipient.getAddress()
          },
          {
            rate: 1,
            recipient: await feeRecipient.getAddress()
          }
        ]
        });

        const { auth: offerAuth2, authSignature: authSignature2 } = await prepareLoanOfferAuth(
          kettle,
          authSigner,
          borrower,
          await time.latest() + DAY_SECONDS * 7,
          tokenOffer2,
          {
            collateralType: CollateralType.ERC721,
            tokenId: tokenId2,
            collection: testErc721,
            size: 1
          }
        );

        await expect(kettle.connect(borrower).borrow(
          tokenOffer2,
          offerAuth2,
          offerSignature2, 
          authSignature2,
          loanAmount, 
          tokenId2,
          ADDRESS_ZERO,
          [],
        )).to.be.revertedWithCustomError(kettle, "TotalFeeTooHigh")
      });
    });
  });
});
