import { getFixture, Fixture } from './setup';
import { expect } from "chai";

import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";

import { ethers, network } from "hardhat";

import { Signer } from "ethers";
import { LoanOffer } from "../types/loanOffer";
import { formatLien, getFee, getLatestTimestamp, getLoanOffer } from "./helpers";

import { Kettle, TestERC20, TestERC721 } from "../typechain-types";
import { LienStruct } from "../typechain-types/contracts/Kettle";

import { parseEther } from '@ethersproject/units';
import { MaxUint256 } from "@ethersproject/constants";

const DAY_SECONDS = 24 * 60 * 60;

describe("Kettle", () => {
  let owner: Signer;
  let borrower: Signer;
  let lender: Signer;

  let kettle: Kettle;
  let testErc721: TestERC721;
  let testErc20: TestERC20;

  let blockTimestamp: number;

  beforeEach(async () => {
    ({
      owner,
      borrower,
      lender,
      kettle,
      testErc721,
      testErc20
    } = await loadFixture(getFixture));

    blockTimestamp = await getLatestTimestamp();
  });

  it('should deploy', async () => {});

  describe.skip("Borrow", () => {

    it("collateralType === ERC721", async () => {
      // const loanAmount = parseEther("10");

      // await testErc721.mint(borrower.address, 1);
      // await testErc20.mint(lender.address, loanAmount);

      // const loanOffer = getLoanOffer(
      //   1,
      //   lender.address,
      //   testErc721.address,
      //   testErc20.address,
      //   loanAmount,
      //   0,
      //   loanAmount,
      //   DAY_SECONDS * 7,
      //   "1000",
      //   blockTimestamp + DAY_SECONDS * 7,
      //   [
      //     getFee(250, await protocolFeeCollector.getAddress()),
      //     getFee(100, await devFeeCollector.getAddress())
      //   ]
      // );

      // const txn = await kettle.connect(borrower).borrow(
      //   loanOffer, 
      //   "0x", 
      //   loanAmount, 
      //   1,
      //   []
      // );
    });

    it("collateralType === ERC721_WITH_CRITERIA", async () => {
      // const loanAmount = parseEther("10");

      // await testErc721.mint(borrower.address, 1);
      // await testErc20.mint(lender.address, loanAmount);

      // const loanOffer = getLoanOffer(
      //   1,
      //   lender.address,
      //   testErc721.address,
      //   testErc20.address,
      //   loanAmount,
      //   0,
      //   loanAmount,
      //   DAY_SECONDS * 7,
      //   "1000",
      //   blockTimestamp + DAY_SECONDS * 7,
      //   [
      //     getFee(250, await protocolFeeCollector.getAddress()),
      //     getFee(100, await devFeeCollector.getAddress())
      //   ]
      // );

      // const txn = await kettle.connect(borrower).borrow(
      //   loanOffer,
      //   "0x",
      //   loanAmount,
      //   1,
      //   []
      // );
    });
  });
});
