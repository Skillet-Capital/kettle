import { expect } from "chai";
import { 
  time, 
  loadFixture 
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { 
  formatLien,
  getLoanOffer,
  signLoanOffer,
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
  let feeRecipient: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc1155: TestERC1155;
  let testErc20: TestERC20;
  let erc721Escrow: ERC721EscrowBase;

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
          fees: [
            {
              rate: 50,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 50,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 50,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 50,
              recipient: await feeRecipient.getAddress()
            },
            {
              rate: 50,
              recipient: await feeRecipient.getAddress()
            }
          ]
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

        const lienLog = await txn.wait().then(
          async (receipt) => {
            const kettleAddres = await kettle.getAddress();
            const lienLog = receipt!.logs!.find(
              (log) => (log.address === kettleAddres)
            )!;
  
            return  kettle.interface.decodeEventLog("LoanOfferTaken", lienLog!.data, lienLog!.topics);
          });
        
        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());

        const netLoanAmount = loanAmount * BigInt(9_750) / BigInt(10_000);
        expect(netLoanAmount).to.equal(lienLog.netBorrowAmount)

        expect(await testErc20.balanceOf(borrower)).to.equal(netLoanAmount);
        expect(await testErc20.balanceOf(feeRecipient)).to.equal(loanAmount - netLoanAmount)
      });

      it('should start loans in bulk with fees', async () => {
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
          fees: [{
            rate: 250,
            recipient: await feeRecipient.getAddress()
          }]
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
              offerIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: [],
              auth: offerAuth,
              authSignature: authSignature
            },
            {
              offerIndex: 1,
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

        const netLoanAmount = loanAmount * BigInt(9_750) / BigInt(10_000);

        expect(await testErc20.balanceOf(borrower)).to.equal(netLoanAmount);
        expect(await testErc20.balanceOf(feeRecipient)).to.equal(loanAmount - netLoanAmount)
      });

      it('should revert if fees are too high', async () => {
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
          fees: [
            {
            rate: 9999,
            recipient: await feeRecipient.getAddress()
          },
          {
            rate: 1,
            recipient: await feeRecipient.getAddress()
          }
        ]
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
