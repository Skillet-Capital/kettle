import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Kettle, TestERC20, TestERC721, Helpers, CollateralVerifier, ERC721EscrowBase } from "../typechain-types";
import { MaxUint256 } from "@ethersproject/constants";
import { formatEther } from "@ethersproject/units";
import { hexConcat } from "@ethersproject/bytes";

import CONDUIT_CONTROLLER_ABI from "../abis/conduit-controller.json";

export interface Fixture {
  owner: Signer,
  borrower: Signer,
  lender: Signer,
  erc721Escrow: ERC721EscrowBase;
  testErc721: TestERC721;
  testErc20: TestERC20;
  kettle: Kettle;
  helpers: Helpers;
  verifier: CollateralVerifier;
}

export async function getFixture(): Promise<Fixture> {
  const [owner, borrower, lender] = await ethers.getSigners();

  /* Deploy Conduit */
  const conduitController = new ethers.Contract(
    "0x00000000f9490004c11cef243f5400493c00ad63",
    CONDUIT_CONTROLLER_ABI,
    owner
  );

  const conduitKey = hexConcat([owner.address, "0x000000000000000000000000"]);
  let { conduit, exists } = await conduitController.getConduit(conduitKey);

  if (!exists) {
    await conduitController.createConduit(
      conduitKey,
      owner.address
    );
    let { conduit } =  await conduitController.getConduit(conduitKey);
  }

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
  const kettle = await ethers.deployContract("Kettle", [conduit], { 
    libraries: { Helpers: helpers.target, CollateralVerifier: verifier.target },
    gasLimit: 1e8 
  });

  /* Open Conduit Channel */
  await conduitController.updateChannel(
    conduit,
    kettle.getAddress(),
    true
  );

  /* Deploy ERC721 Escrow */
  const erc721Escrow = await ethers.deployContract("ERC721EscrowBase", [conduit, testErc721.target]);
  await erc721Escrow.waitForDeployment();

  /* Set Escrow */
  await kettle.setEscrow(testErc721.getAddress(), erc721Escrow.getAddress());

  /* Set Approvals */
  await testErc721.connect(borrower).setApprovalForAll(conduit, true);
  await testErc721.connect(lender).setApprovalForAll(conduit, true);

  await testErc20.connect(lender).approve(conduit, MaxUint256.toBigInt());
  await testErc20.connect(borrower).approve(conduit, MaxUint256.toBigInt());

  console.log("\n---------- Contracts ----------");
  console.log("Kettle:".padEnd(15), await kettle.getAddress());
  console.log("Conduit:".padEnd(15), conduit);
  console.log("ERC721Escrow:".padEnd(15), await erc721Escrow.getAddress());
  console.log("TestERC721:".padEnd(15), await testErc721.getAddress());
  console.log("TestERC20:".padEnd(15), await testErc20.getAddress());

  console.log("\n----------- Wallets -----------");
  console.log("borrower:".padEnd(15), await borrower.getAddress(), `[balance = ${formatEther(await ethers.provider.getBalance(borrower.getAddress()))}]`);
  console.log("lender:".padEnd(15), await lender.getAddress(), `[balance = ${formatEther(await ethers.provider.getBalance(lender.getAddress()))}]`);

  return {
    owner,
    borrower,
    lender,
    erc721Escrow,
    testErc721,
    testErc20,
    kettle,
    helpers,
    verifier
  }
};
