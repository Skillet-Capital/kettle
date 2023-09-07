import { ethers } from "hardhat";
import { Signer } from "ethers";
import { MaxUint256 } from "@ethersproject/constants";
import { hexConcat } from "@ethersproject/bytes";

import { 
  Kettle, 
  TestERC20, 
  TestERC721, 
  TestERC1155, 
  Helpers, 
  CollateralVerifier, 
  ERC721EscrowBase, 
  ERC1155EscrowBase,
  ConduitControllerInterface__factory
} from "../typechain-types";

import CONDUIT_CONTROLLER_ABI from "../abis/conduit-controller.json";
import { ConduitControllerBytecode } from "../abis/conduit-controller-bytecode.json";

export interface Fixture {
  owner: Signer,
  borrower: Signer,
  lender: Signer,
  authSigner: Signer,
  feeRecipient: Signer,
  testErc721: TestERC721;
  testErc1155: TestERC1155;
  testErc20: TestERC20;
  kettle: Kettle;
  helpers: Helpers;
  verifier: CollateralVerifier;
  erc1155Escrow: ERC1155EscrowBase;
  erc721Escrow: ERC721EscrowBase;
}

export async function getFixture(): Promise<Fixture> {
  const [owner, borrower, lender, authSigner, feeRecipient] = await ethers.getSigners();

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

  /* Deploy Kettle */
  const kettle = await ethers.deployContract("Kettle", [authSigner], { 
    libraries: { Helpers: helpers.target, CollateralVerifier: verifier.target },
    gasLimit: 1e8 
  });

  /* Deploy ERC721 Escrow */
  const erc721Escrow = await ethers.deployContract("ERC721EscrowBase", [kettle, testErc721.target]);
  await erc721Escrow.waitForDeployment();

  /* deploy ERC1155 Escrow */
  const erc1155Escrow = await ethers.deployContract("ERC1155EscrowBase", [kettle, testErc1155.target]);
  await erc1155Escrow.waitForDeployment();

  /* Set Escrow */
  await kettle.setEscrow(testErc721.getAddress(), erc721Escrow.getAddress());
  await kettle.setEscrow(testErc1155.getAddress(), erc1155Escrow.getAddress());

  /* Set Approvals */
  await testErc721.connect(borrower).setApprovalForAll(kettle, true);
  await testErc721.connect(lender).setApprovalForAll(kettle, true);

  await testErc1155.connect(borrower).setApprovalForAll(kettle, true);
  await testErc1155.connect(lender).setApprovalForAll(kettle, true);

  await testErc20.connect(lender).approve(kettle, MaxUint256.toBigInt());
  await testErc20.connect(borrower).approve(kettle, MaxUint256.toBigInt());

  console.log("\n----------------------- Contracts -----------------------");
  console.log("Kettle:".padEnd(15), await kettle.getAddress());
  console.log("TestERC721:".padEnd(15), await testErc721.getAddress());
  console.log("TestERC1155:".padEnd(15), await testErc1155.getAddress());
  console.log("TestERC20:".padEnd(15), await testErc20.getAddress());
  console.log("ERC721Escrow:".padEnd(15), await erc721Escrow.getAddress());
  console.log("ERC1155Escrow:".padEnd(15), await erc1155Escrow.getAddress());

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
    testErc721,
    testErc1155,
    testErc20,
    kettle,
    helpers,
    verifier,
    erc721Escrow,
    erc1155Escrow,
  }
};
