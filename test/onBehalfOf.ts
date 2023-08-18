import { expect } from "chai";
import { 
  time, 
  loadFixture 
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers, network } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import { 
  formatLien,
  getLoanOffer,
  signLoanOffer,
  generateMerkleRootForCollection, 
  generateMerkleProofForToken 
} from "./helpers";

import { CollateralType } from '../types/loanOffer';
import { LienStruct, LoanOfferStruct } from "../typechain-types/contracts/Kettle";
import { LienPointer } from "../types";
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

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc20: TestERC20;
  let erc721Escrow: ERC721EscrowBase;
  let conduitAddress: string;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      borrower,
      lender,
      kettle,
      testErc721,
      testErc20,
      erc721Escrow,
      conduitAddress
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
      let signature: string;

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
        });

        signature = await signLoanOffer(
          kettle,
          lender,
          tokenOffer
        );
      });

      it('should start loan on behalf of wallet', async () => {
        const txn = await kettle.connect(borrower).borrow(
          tokenOffer, 
          signature, 
          loanAmount,
          1,
          onBehalfOf,
          [],
        );

        ({ lien, lienId } = await txn.wait().then(
          async (receipt) => {
            const kettleAddres = await kettle.getAddress();
            const lienLog = receipt!.logs!.find(
              (log) => (log.address === kettleAddres)
            )!;
  
            const parsedLog = kettle.interface.decodeEventLog("LoanOfferTaken", lienLog!.data, lienLog!.topics);
            return {
              lienId: parsedLog.lienId,
              lien: formatLien(
                parsedLog.lender,
                parsedLog.borrower,
                parsedLog.collateralType,
                parsedLog.collection,
                parsedLog.tokenId,
                parsedLog.amount,
                parsedLog.currency,
                parsedLog.borrowAmount,
                parsedLog.duration,
                parsedLog.rate,
                parsedLog.startTime
              )
            }
          }));

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(loanAmount);
        expect(lien.borrower).to.equal(await onBehalfOf.getAddress());

        /* repay loan and transfer collateral to on behalf of wallet */
        repaymentAmount = await kettle.getRepaymentAmount(
          lien.borrowAmount,
          lien.rate,
          lien.duration
        );

        await testErc20.mint(onBehalfOf, repaymentAmount - await testErc20.balanceOf(onBehalfOf.getAddress()));
        await testErc20.connect(onBehalfOf).approve(conduitAddress, repaymentAmount);

        await kettle.connect(onBehalfOf).repay(lien, lienId);

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await onBehalfOf.getAddress());
        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(0);
      });

      it('should start loans in bulk on behalf of wallet', async () => {
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
        });

        const signature2 = await signLoanOffer(
          kettle,
          lender,
          tokenOffer2
        );

        const txn = await kettle.connect(borrower).borrowBatch(
          [
            { 
              offer: tokenOffer, 
              signature: signature 
            },
            {
              offer: tokenOffer2,
              signature: signature2
            }
          ],
          [
            {
              loanIndex: 0,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 1,
              proof: []
            },
            {
              loanIndex: 1,
              loanAmount: ethers.parseEther("5"),
              collateralIdentifier: 2,
              proof: []
            }
          ],
          onBehalfOf
        );

        lienPointers = await txn.wait().then(
          async (receipt) => {
            const kettleAddres = await kettle.getAddress();
            const lienLogs = receipt!.logs!.filter(
              (log) => (log.address === kettleAddres)
            )!;

            return lienLogs.map(
              (log) => {
                const parsedLog = kettle.interface.decodeEventLog("LoanOfferTaken", log!.data, log!.topics);
                return {
                  lienId: parsedLog.lienId,
                  lien: formatLien(
                    parsedLog.lender,
                    parsedLog.borrower,
                    parsedLog.collateralType,
                    parsedLog.collection,
                    parsedLog.tokenId,
                    parsedLog.amount,
                    parsedLog.currency,
                    parsedLog.borrowAmount,
                    parsedLog.duration,
                    parsedLog.rate,
                    parsedLog.startTime
                  )
                }
              }
            );
          });

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await erc721Escrow.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await erc721Escrow.getAddress());

        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(loanAmount);

        lienPointers.forEach(
          async (pointer: LienPointer) => expect(pointer.lien.borrower).to.equal(await onBehalfOf.getAddress())
        );

        /* repay loan and transfer collateral to on behalf of wallet */
        const repayments = await Promise.all(
          lienPointers.map(
            async (lienPointer) => kettle.getRepaymentAmount(
                lienPointer.lien.borrowAmount,
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
        await testErc20.connect(onBehalfOf).approve(conduitAddress, repaymentAmount);

        await kettle.connect(onBehalfOf).repayBatch(lienPointers);

        expect(await testErc721.ownerOf(tokenId1)).to.equal(await onBehalfOf.getAddress());
        expect(await testErc721.ownerOf(tokenId2)).to.equal(await onBehalfOf.getAddress());
        expect(await testErc20.balanceOf(onBehalfOf)).to.equal(0);
      });
    });
  });
});
