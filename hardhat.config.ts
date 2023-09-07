import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import 'solidity-coverage'
import "hardhat-contract-sizer";
import "hardhat-gas-reporter"
import "hardhat-tracer";

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
    }
  },
  gasReporter: {
    enabled: true,
    gasPrice: 20
  }
}

export default config;
