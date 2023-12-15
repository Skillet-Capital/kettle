import { ethers } from "hardhat";

async function main() {
  const [owner, authSigner] = await ethers.getSigners();

  console.log(await authSigner.getAddress());

  /* Deploy Helpers */
  const helpers = await ethers.deployContract("Helpers");
  await helpers.waitForDeployment();

  console.log("Helpers:".padEnd(15), await helpers.getAddress())

  /* Deploy Collateral Verifier */
  const verifier = await ethers.deployContract("CollateralVerifier");
  await verifier.waitForDeployment();

  console.log("Verifier:".padEnd(15), await verifier.getAddress())

  /* Deploy Kettle */
  const kettle = await ethers.deployContract("Kettle", [authSigner], { 
    libraries: { Helpers: helpers.target, CollateralVerifier: verifier.target }
  });
  await kettle.waitForDeployment();

  console.log("Kettle:".padEnd(15), await kettle.getAddress());
  return;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
