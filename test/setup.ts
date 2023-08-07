import hre from "hardhat";
import { Signer } from "ethers";
import { Kettle, TestERC20, TestERC721 } from "../typechain-types";
import { MaxUint256 } from "@ethersproject/constants";

export interface Fixture {
  owner: Signer,
  borrower: Signer,
  lender: Signer,
  testErc721: TestERC721;
  testErc20: TestERC20;
  kettle: Kettle;
}

export async function getFixture(): Promise<Fixture> {
  const [owner, borrower, lender] = await hre.ethers.getSigners();

  /* Deploy TestERC721 */
  const testErc721 = await hre.ethers.deployContract("TestERC721");
  await testErc721.waitForDeployment()

  /* Deploy TestERC20 */
  const testErc20 = await hre.ethers.deployContract("TestERC20");
  await testErc20.waitForDeployment()

  /* Deploy Helpers */
  const helpers = await hre.ethers.deployContract("Helpers");
  await helpers.waitForDeployment();

  /* Deploy Kettle */
  const kettle = await hre.ethers.deployContract("Kettle", { libraries: { Helpers: helpers.target }, gasLimit: 1e8 });

  /* Set Approvals */
  await testErc721.connect(borrower).setApprovalForAll(kettle.address, true);
  await testErc721.connect(lender).setApprovalForAll(kettle.address, true);

  await testErc20.connect(lender).approve(kettle.address, MaxUint256);
  await testErc20.connect(borrower).approve(kettle, MaxUint256);

  console.log("\n---------- Contracts ----------");
  console.log("Kettle:".padEnd(15), kettle.address);
  console.log("TestERC721:".padEnd(15), testErc721.address);
  console.log("TestERC20:".padEnd(15), testErc20.address);

  console.log("\n----------- Wallets -----------");
  console.log("borrower:".padEnd(15), borrower.address, `[balance = ${ethers.utils.formatEther(await borrower.getBalance())}]`);
  console.log("lender:".padEnd(15), lender.address, `[balance = ${ethers.utils.formatEther(await lender.getBalance())}]`);

  return {
    owner,
    borrower,
    lender,
    testErc721,
    testErc20,
    kettle
  }
};
