import * as hre from "hardhat";

async function deploy() {
  const [owner, authSigner] = await hre.ethers.getSigners();

  /* Deploy Helpers */
  const helpers = await hre.ethers.deployContract("Helpers");
  await helpers.waitForDeployment();

  console.log("Helpers:".padEnd(15), await helpers.getAddress())

  /* Deploy Collateral Verifier */
  const verifier = await hre.ethers.deployContract("CollateralVerifier");
  await verifier.waitForDeployment();

  console.log("Verifier:".padEnd(15), await verifier.getAddress())

  /* Deploy Kettle */
  const kettle = await hre.ethers.deployContract("Kettle", [authSigner], { 
    libraries: { Helpers: helpers.target, CollateralVerifier: verifier.target }
  });
  await kettle.waitForDeployment();

  console.log("Kettle:".padEnd(15), await kettle.getAddress());

  return {
    contractName: "Kettle",
    address: await kettle.getAddress()
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deploy()
.then((result) => hre.run("init", result))
.then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
