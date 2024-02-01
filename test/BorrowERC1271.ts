import { expect } from "chai";
import {
  time,
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers } from "hardhat";
import { Signer } from "ethers";

import { getFixture } from './setup';
import {
  getLoanOffer,
  signLoanOffer,
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
  ERC1271WalletMock,
  ERC1271MaliciousMock
} from "../typechain-types";

const DAY_SECONDS = 24 * 60 * 60;
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"

describe("Kettle", () => {
  let borrower: Signer;
  let lender: Signer;
  let authSigner: Signer;
  let signers: Signer[];

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
      kettle,
      testErc721,
      testErc1155,
      testErc20,
      signers
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

    describe("ERC1271", () => {
      let signer: Signer;
      let signerContract: ERC1271WalletMock;

      beforeEach(async () => {
        signer = signers[0];

        signerContract = await ethers.deployContract("ERC1271WalletMock", signer)
        await signerContract.waitForDeployment();

        await testErc20.mint(signerContract, loanAmount);
        await signerContract.approveCurrencyForOperator(kettle, testErc20);
      });

      describe("collateralType === ERC721", () => {
        let tokenOffer: LoanOfferStruct;
        let offerSignature: string;
    
        let offerAuth: OfferAuthStruct;
        let authSignature: string;
  
        beforeEach(async () => {
          
          tokenOffer = await getLoanOffer({
            lender: signerContract,
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
          });

          offerSignature = await signLoanOffer(kettle, signer, tokenOffer);
  
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
  
        it('should start loan', async () => {
          const txn = await kettle.connect(borrower).borrow(
            tokenOffer,
            offerAuth,
            offerSignature,
            authSignature,
            loanAmount,
            tokenId1,
            ADDRESS_ZERO,
            false,
            [],
          );
  
          // extract lien and lien id
          const { lien, lienId } = await txn.wait()
            .then((receipt) => extractLien(receipt!, kettle)
          );
  
          expect(await testErc721.ownerOf(tokenId1)).to.equal(await kettle.getAddress());
          expect(await testErc20.balanceOf(borrower)).to.equal(loanAmount);
          expect(await testErc20.balanceOf(signerContract)).to.equal(0);
  
          // expect correct lienId
          expect(lienId).to.equal(0);
        });
      });
    });
  });
});
