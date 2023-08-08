import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'solidity-coverage'
import "hardhat-contract-sizer";
import "hardhat-gas-reporter"
import "hardhat-tracer";

const ALCHEMY_KEY = "1ZcejYUK_nDcZnF2Kyzx22d8h5T7xW72";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
        },
      },
    ]
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_KEY}`,
        blockNumber: 17119000
      },
      allowUnlimitedContractSize: true,
      chainId: 1,
      gas: 2100000,
      blockGasLimit: 0x1fffffffffffff,
    }
  },
  gasReporter: {
    enabled: true,
    gasPrice: 20
  },
  // tenderly: {
  //   username: "diamondjim",
  //   project: "kettle",
  //   privateVerification: true
  // }
}

export default config;
