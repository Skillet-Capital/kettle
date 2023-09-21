import "@nomicfoundation/hardhat-toolbox";

task("add-erc721-escrow", "Add ERC721 escrow implementation")
  .addParam("kettle", "Kettle address")
  .addParam("contract", "ERC721 address")
  .setAction(async (taskArgs) => {
    const [owner] = await ethers.getSigners();

    const erc721Escrow = await ethers.deployContract("ERC721EscrowBase", [taskArgs.kettle, taskArgs.contract]);
    await erc721Escrow.waitForDeployment();

    const kettle = await ethers.getContractAt("Kettle", taskArgs.kettle, owner);
    await kettle.setEscrow(taskArgs.contract, erc721Escrow)
  })
