import { expect } from "chai";
import { 
  time, 
  loadFixture 
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers, network } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { 
  prepareLoanOffer,
  prepareLoanOfferAuth,
  extractLien,
  extractLiens
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct, OfferAuthStruct } from "../typechain-types/contracts/Kettle";
import { LienPointer } from "../types";
import { 
  Kettle, 
  TestERC20, 
  TestERC721
} from "../typechain-types";

const DAY_SECONDS = 24 * 60 * 60;

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc20: TestERC20;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      authSigner,
      kettle,
      testErc721,
      testErc20
    } = await loadFixture(getFixture));

    blockTimestamp = await time.latest();
  });

  describe("Borrow on Behalf", () => {
    let onBehalfOf: Signer;

    const tokenId1 = 1;
    const tokenId2 = 2;

    const loanAmount = ethers.parseEther("10");

    let repaymentAmount: bigint;

    let lienPointers: LienPointer[];
    let lien: LienStruct;
    let lienId: bigint;

    let offerHash: string;
    let collateralHash: string;
    let offerAuth: OfferAuthStruct;
    let authSignature: string;

    beforeEach(async () => {
      onBehalfOf = ethers.Wallet.createRandom(ethers.provider);
      await network.provider.send("hardhat_setBalance", [
        await onBehalfOf.getAddress(),
        "0x16345785D8A0000",
      ]);

      await testErc721.mint(borrower, tokenId1);
      await testErc721.mint(borrower, tokenId2);

      await testErc20.mint(lender, loanAmount);
    });

    describe("collateralType === ERC721", () => {
      let tokenOffer: LoanOfferStruct;
      let offerSignature: string;

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

      it('should start loan on behalf of wallet', async () => {
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer,
          offerAuth,
          offerSignature, 
          authSignature,
          loanAmount,
          1,
          onBehalfOf,
          [],
        );

        ({ lien, lienId } = await txn.wait().then(
          async (receipt) => extractLien(receipt!, kettle)
        ));

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(loanAmount);
        expect(lien.borrower).to.equal(await onBehalfOf.getAddress());

        /* repay loan and transfer collateral to on behalf of wallet */
        repaymentAmount = await kettle.getRepaymentAmount(
          lien.amount,
          lien.rate,
          lien.duration
        );

        await testErc20.mint(onBehalfOf, repaymentAmount - await testErc20.balanceOf(onBehalfOf.getAddress()));
        await testErc20.connect(onBehalfOf).approve(kettle, repaymentAmount);

        await kettle.connect(onBehalfOf).repay(lien, lienId);

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await onBehalfOf.getAddress());
        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(0);
      });

      it('should start loans in bulk on behalf of wallet', async () => {
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
              tokenId: 1,
              auth: offerAuth,
              authSignature,
              proof: []
            },
            {
              offerIndex: 1,
              amount: ethers.parseEther("5"),
              tokenId: 2,
              auth: offerAuth2,
              authSignature: authSignature2,
              proof: []
            }
          ],
          onBehalfOf
        );

        lienPointers = await txn.wait().then(
          async (receipt) => extractLiens(receipt!, kettle)
        );

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await kettle.getAddress());

        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(loanAmount);

        lienPointers.forEach(
          async (pointer: LienPointer) => expect(pointer.lien.borrower).to.equal(await onBehalfOf.getAddress())
        );

        /* repay loan and transfer collateral to on behalf of wallet */
        const repayments = await Promise.all(
          lienPointers.map(
            async (lienPointer) => kettle.getRepaymentAmount(
                lienPointer.lien.amount,
                lienPointer.lien.rate,
                lienPointer.lien.duration
              )
          )
        );

        repaymentAmount = repayments.reduce(
          (totalRepayment, repayment) => totalRepayment + repayment, 
          BigInt(0)
        );

        await testErc20.mint(onBehalfOf, repaymentAmount - await testErc20.balanceOf(onBehalfOf.getAddress()));
        await testErc20.connect(onBehalfOf).approve(kettle, repaymentAmount);

        await kettle.connect(onBehalfOf).repayBatch(lienPointers);

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await onBehalfOf.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await onBehalfOf.getAddress());
        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(0);
      });
    });
  });
});
