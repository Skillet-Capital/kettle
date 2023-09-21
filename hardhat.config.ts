import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'solidity-coverage'
import "hardhat-contract-sizer";
import "hardhat-gas-reporter"
import "hardhat-tracer";
import "hardhat-graph";


import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 100000,
            details: {
              yulDetails: {
                optimizerSteps: "u",
              },
            },
          },
        },
      },
    ]
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: 1,
      gas: 2100000,
      blockGasLimit: 0x1fffffffffffff,
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.SEPOLIA_ALCHEMY_KEY}`,
      accounts: [
        process.env.OWNER_PK!,
        process.env.SIGNER_PK!
      ]
    }
  },
  gasReporter: {
    enabled: true,
    gasPrice: 20
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY
  }
}

export default config;
