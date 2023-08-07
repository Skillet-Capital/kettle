import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Kettle, TestERC20, TestERC721, Helpers, CollateralVerifier } from "../typechain-types";
import { MaxUint256 } from "@ethersproject/constants";
import { formatEther } from "@ethersproject/units";

export interface Fixture {
  owner: Signer,
  borrower: Signer,
  lender: Signer,
  testErc721: TestERC721;
  testErc20: TestERC20;
  kettle: Kettle;
  helpers: Helpers;
  verifier: CollateralVerifier;
}

export async function getFixture(): Promise<Fixture> {
  const [owner, borrower, lender] = await ethers.getSigners();

  /* Deploy TestERC721 */
  const testErc721 = await ethers.deployContract("TestERC721");
  await testErc721.waitForDeployment()

  /* Deploy TestERC20 */
  const testErc20 = await ethers.deployContract("TestERC20");
  await testErc20.waitForDeployment()

  /* Deploy Helpers */
  const helpers = await ethers.deployContract("Helpers");
  await helpers.waitForDeployment();

  /* Deploy Collateral Verifier */
  const verifier = await ethers.deployContract("CollateralVerifier");
  await verifier.waitForDeployment();

  /* Deploy Kettle */
  const kettle = await ethers.deployContract("Kettle", { 
    libraries: { Helpers: helpers.target, CollateralVerifier: verifier.target },
    gasLimit: 1e8 
  });

  /* Set Approvals */
  await testErc721.connect(borrower).setApprovalForAll(kettle.getAddress(), true);
  await testErc721.connect(lender).setApprovalForAll(kettle.getAddress(), true);

  await testErc20.connect(lender).approve(kettle.getAddress(), MaxUint256.toBigInt());
  await testErc20.connect(borrower).approve(kettle.getAddress(), MaxUint256.toBigInt());

  console.log("\n---------- Contracts ----------");
  console.log("Kettle:".padEnd(15), await kettle.getAddress());
  console.log("TestERC721:".padEnd(15), await testErc721.getAddress());
  console.log("TestERC20:".padEnd(15), await testErc20.getAddress());

  console.log("\n----------- Wallets -----------");
  console.log("borrower:".padEnd(15), await borrower.getAddress(), `[balance = ${formatEther(await ethers.provider.getBalance(borrower.getAddress()))}]`);
  console.log("lender:".padEnd(15), await lender.getAddress(), `[balance = ${formatEther(await ethers.provider.getBalance(lender.getAddress()))}]`);

  return {
    owner,
    borrower,
    lender,
    testErc721,
    testErc20,
    kettle,
    helpers,
    verifier
  }
};
