import { ethers } from "hardhat";
import { Signer } from "ethers";
import { MaxUint256 } from "@ethersproject/constants";

import { 
  Kettle, 
  TestERC20, 
  TestERC721, 
  TestERC1155, 
  Helpers, 
  CollateralVerifier,
  LendingEscrow
} from "../typechain-types";

export interface Fixture {
  owner: Signer,
  borrower: Signer,
  lender: Signer,
  authSigner: Signer,
  feeRecipient: Signer,
  signers: Signer[],
  testErc721: TestERC721;
  testErc1155: TestERC1155;
  testErc20: TestERC20;
  escrow: LendingEscrow;
  kettle: Kettle;
  helpers: Helpers;
  verifier: CollateralVerifier;
}

export async function getFixture(): Promise<Fixture> {
  const [owner, borrower, lender, authSigner, feeRecipient, rebateFunder, ...signers] = await ethers.getSigners();

  /* Deploy TestERC721 */
  const testErc721 = await ethers.deployContract("TestERC721");
  await testErc721.waitForDeployment()

  /* Deploy ERC1155 */
  const testErc1155 = await ethers.deployContract("TestERC1155");
  await testErc1155.waitForDeployment();

  /* Deploy TestERC20 */
  const testErc20 = await ethers.deployContract("TestERC20");
  await testErc20.waitForDeployment()

  /* Deploy Helpers */
  const helpers = await ethers.deployContract("Helpers");
  await helpers.waitForDeployment();

  /* Deploy Collateral Verifier */
  const verifier = await ethers.deployContract("CollateralVerifier");
  await verifier.waitForDeployment();

  /* Deploy Lending Escrow */
  const escrow = await ethers.deployContract("LendingEscrow", [authSigner, rebateFunder]);
  await escrow.waitForDeployment();

  /* Deploy Kettle */
  const kettle = await ethers.deployContract("Kettle", [authSigner, escrow], { 
    libraries: { Helpers: helpers.target, CollateralVerifier: verifier.target },
    gasLimit: 1e8 
  });

  /* Set Kettle Role on Lending Escrow */
  await escrow.setRole(1, kettle, 1);

  /* Set Approvals */
  await testErc721.connect(borrower).setApprovalForAll(kettle, true);
  await testErc721.connect(lender).setApprovalForAll(kettle, true);

  await testErc1155.connect(borrower).setApprovalForAll(kettle, true);
  await testErc1155.connect(lender).setApprovalForAll(kettle, true);

  await testErc20.connect(lender).approve(kettle, MaxUint256.toBigInt());
  await testErc20.connect(lender).approve(escrow, MaxUint256.toBigInt());
  await testErc20.connect(borrower).approve(kettle, MaxUint256.toBigInt());

  console.log("\n----------------------- Contracts -----------------------");
  console.log("Kettle:".padEnd(15), await kettle.getAddress());
  console.log("TestERC721:".padEnd(15), await testErc721.getAddress());
  console.log("TestERC1155:".padEnd(15), await testErc1155.getAddress());
  console.log("TestERC20:".padEnd(15), await testErc20.getAddress());

  console.log("\n------------------------ Wallets ------------------------");
  console.log("owner:".padEnd(15), await owner.getAddress());
  console.log("borrower:".padEnd(15), await borrower.getAddress());
  console.log("lender:".padEnd(15), await lender.getAddress());

  return {
    owner,
    borrower,
    lender,
    authSigner,
    feeRecipient,
    signers,
    testErc721,
    testErc1155,
    testErc20,
    escrow,
    kettle,
    helpers,
    verifier
  }
};
