import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import { Signer } from "ethers";
import { LoanOffer } from "../types/loanOffer";
import { Kettle, TestERC20, TestERC721 } from "../typechain-types";
import { formatLien, getFee, getLatestTimestamp, getLoanOffer } from "./helpers";

const DAY_SECONDS = 24 * 60 * 60;

describe("Kettle", function () {

  async function deployKettle() {

    /* Deploy TestERC721 */
    const testErc721 = await ethers.deployContract("TestERC721");

    /* Deploy TestERC20 */
    const testErc20 = await ethers.deployContract("TestERC20");

    /* Deploy Helpers */
    const helpers = await ethers.deployContract("Helpers");

    /* Deploy Kettle */
    const kettle = await ethers.deployContract("Kettle", { libraries: { Helpers: helpers.target }, gasLimit: 1e8 });

    return { kettle, testErc721, testErc20 };
  }

  describe("Deployment", function () {
    it("Should deploy", async function () {
      const { kettle, testErc721, testErc20 } = await loadFixture(deployKettle);

      // console.log("Kettle:\t\t", await kettle.getAddress());
      // console.log("TestERC721:\t", await testErc721.getAddress());
      // console.log("TestERC20:\t", await testErc20.getAddress());
    });
  });

  describe("Kettle", () => {
    let borrower: Signer;
    let lender: Signer;
    let protocolFeeCollector: Signer;
    let devFeeCollector: Signer;

    let borrowerAddress: string;
    let lenderAddress: string;
    let protocolFeeCollectorAddress: string;
    let devFeeCollectorAddress: string;

    let kettle: Kettle;
    let testErc721: TestERC721;
    let testErc20: TestERC20;

    let kettleAddress: string;
    let testErc721Address: string;
    let testErc20Address: string;

    let blockTimestamp: number;

    let loanOffer: LoanOffer;

    beforeEach(async () => {
      [, borrower, lender, protocolFeeCollector, devFeeCollector] = await ethers.getSigners();
      ({ kettle, testErc721, testErc20 } = await loadFixture(deployKettle));

      await testErc721.mint(await borrower.getAddress(), 1);
      await testErc721.connect(borrower).setApprovalForAll(await kettle.getAddress(), true);
      await testErc721.connect(lender).setApprovalForAll(await kettle.getAddress(), true);

      await testErc20.mint(await lender.getAddress(), ethers.parseEther("10"));
      await testErc20.connect(lender).approve(await kettle.getAddress(), ethers.MaxUint256);
      await testErc20.connect(borrower).approve(await kettle.getAddress(), ethers.MaxUint256);

      borrowerAddress = await borrower.getAddress();
      lenderAddress = await lender.getAddress();
      protocolFeeCollectorAddress = await protocolFeeCollector.getAddress();
      devFeeCollectorAddress = await devFeeCollector.getAddress();

      kettleAddress = await kettle.getAddress();
      testErc721Address = await testErc721.getAddress();
      testErc20Address = await testErc20.getAddress();

      blockTimestamp = await getLatestTimestamp();
    });

    describe("Borrow -> Repay", () => {

      beforeEach(async () => {
        loanOffer = getLoanOffer(
          lenderAddress,
          testErc721Address,
          testErc20Address,
          ethers.parseEther("10"),
          ethers.parseEther("0"),
          ethers.parseEther("10"),
          DAY_SECONDS * 7,
          "1000",
          blockTimestamp + DAY_SECONDS * 7,
          [
            getFee(250, await protocolFeeCollector.getAddress()),
            getFee(100, await devFeeCollector.getAddress())
          ]
        );

        await kettle.connect(borrower).borrow(
          loanOffer, 
          "0x", 
          ethers.parseEther("10").toString(), 
          1
        );

        expect(await testErc20.balanceOf(await protocolFeeCollector.getAddress())).to.equal(ethers.parseEther("0.25"));
        expect(await testErc20.balanceOf(await devFeeCollector.getAddress())).to.equal(ethers.parseEther("0.1"));
        expect(await testErc20.balanceOf(await borrower.getAddress())).to.equal(ethers.parseEther("9.65"));
        expect(await testErc721.ownerOf(1)).to.equal(await kettle.getAddress());
      });

      it("should repay loan (by borrower)", async function () {
        const repayAmount = await kettle.repayAmount(0);
        await testErc20.mint(borrowerAddress, repayAmount - await testErc20.balanceOf(borrowerAddress));
        await testErc20.connect(borrower).approve(kettleAddress, repayAmount);

        await kettle.connect(borrower).repay(formatLien(await kettle.liens(0)), 0);
        
        expect(await testErc20.balanceOf(borrowerAddress)).to.equal(0);
        expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

        expect(await testErc721.ownerOf(1)).to.equal(borrowerAddress);
      })

      it("should repay loan (by someone else)", async function () {
        const randomWallet = ethers.Wallet.createRandom(ethers.provider);
        await network.provider.send("hardhat_setBalance", [
          randomWallet.address,
          "0x3635C9ADC5DEA00000"
        ]);

        const repayAmount = await kettle.repayAmount(0);

        await testErc20.mint(randomWallet, repayAmount);
        await testErc20.connect(randomWallet).approve(kettleAddress, repayAmount);

        await kettle.connect(randomWallet).repay(formatLien(await kettle.liens(0)), 0);
        
        expect(await testErc20.balanceOf(randomWallet)).to.equal(0);
        expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

        expect(await testErc721.ownerOf(1)).to.equal(borrowerAddress);
      });
    });

    describe("Borrow -> Refinance", () => {
      beforeEach(async () => {
        loanOffer = getLoanOffer(
          lenderAddress,
          testErc721Address,
          testErc20Address,
          ethers.parseEther("10"),
          ethers.parseEther("0"),
          ethers.parseEther("10"),
          DAY_SECONDS * 7,
          "1000",
          blockTimestamp + DAY_SECONDS * 7,
          [
            getFee(250, await protocolFeeCollector.getAddress()),
            getFee(100, await devFeeCollector.getAddress())
          ]
        );

        await kettle.connect(borrower).borrow(
          loanOffer, 
          "0x", 
          ethers.parseEther("10").toString(), 
          1
        );

        expect(await testErc20.balanceOf(await protocolFeeCollector.getAddress())).to.equal(ethers.parseEther("0.25"));
        expect(await testErc20.balanceOf(await devFeeCollector.getAddress())).to.equal(ethers.parseEther("0.1"));
        expect(await testErc20.balanceOf(await borrower.getAddress())).to.equal(ethers.parseEther("9.65"));
        expect(await testErc721.ownerOf(1)).to.equal(await kettle.getAddress());
      });

      it("should refinance loan with repay amount (by anyone)", async function () {
        const randomWallet = ethers.Wallet.createRandom(ethers.provider);
        await network.provider.send("hardhat_setBalance", [
          randomWallet.address,
          "0x3635C9ADC5DEA00000"
        ]);
        
        const repayAmount = await kettle.repayAmount(0);

        await testErc20.mint(randomWallet.address, repayAmount);
        await testErc20.connect(randomWallet).approve(kettleAddress, repayAmount);

        const refinanceOffer = getLoanOffer(
          randomWallet.address,
          testErc721Address,
          testErc20Address,
          repayAmount,
          ethers.parseEther("0"),
          repayAmount,
          DAY_SECONDS * 7,
          "1000",
          blockTimestamp + DAY_SECONDS * 7,
          []
        );

        await kettle.connect(randomWallet).refinance(
          formatLien(await kettle.liens(0)),
          0,
          repayAmount,
          refinanceOffer,
          "0x"
        );

        expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
        expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);
      });

      it("should refinance loan with higher amount (by anyone)", async function () {
        const initialBorrowerBalance = await testErc20.balanceOf(borrowerAddress);

        const randomWallet = ethers.Wallet.createRandom(ethers.provider);
        await network.provider.send("hardhat_setBalance", [
          randomWallet.address,
          "0x3635C9ADC5DEA00000"
        ]);
        
        const repayAmount = await kettle.repayAmount(0);
        const loanTotal = repayAmount + ethers.parseEther("2");

        await testErc20.mint(randomWallet.address, loanTotal);
        await testErc20.connect(randomWallet).approve(kettleAddress, loanTotal);

        const refinanceOffer = getLoanOffer(
          randomWallet.address,
          testErc721Address,
          testErc20Address,
          loanTotal,
          ethers.parseEther("0"),
          loanTotal,
          DAY_SECONDS * 7,
          "1000",
          blockTimestamp + DAY_SECONDS * 7,
          []
        );

        await kettle.connect(randomWallet).refinance(
          formatLien(await kettle.liens(0)),
          0,
          loanTotal,
          refinanceOffer,
          "0x"
        );

        expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
        expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

        expect(await testErc20.balanceOf(borrowerAddress)).to.equal(initialBorrowerBalance + ethers.parseEther("2"))
      });

      it("should refinance loan with higher amount (by borrower)", async function () {
        const initialBorrowerBalance = await testErc20.balanceOf(borrowerAddress);

        const randomWallet = ethers.Wallet.createRandom(ethers.provider);
        await network.provider.send("hardhat_setBalance", [
          randomWallet.address,
          "0x3635C9ADC5DEA00000"
        ]);
        
        const repayAmount = await kettle.repayAmount(0);
        const loanTotal = repayAmount + ethers.parseEther("2");

        await testErc20.mint(randomWallet.address, loanTotal);
        await testErc20.connect(randomWallet).approve(kettleAddress, loanTotal);

        const refinanceOffer = getLoanOffer(
          randomWallet.address,
          testErc721Address,
          testErc20Address,
          loanTotal,
          ethers.parseEther("0"),
          loanTotal,
          DAY_SECONDS * 7,
          "1000",
          blockTimestamp + DAY_SECONDS * 7,
          []
        );

        await kettle.connect(borrower).borrowerRefinance(
          formatLien(await kettle.liens(0)),
          0,
          loanTotal,
          refinanceOffer,
          "0x"
        );

        expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
        expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

        expect(await testErc20.balanceOf(borrowerAddress)).to.equal(initialBorrowerBalance + ethers.parseEther("2"))
      })


      it("should refinance loan with lower amount (by borrower)", async function () {
        const initialBorrowerBalance = await testErc20.balanceOf(borrowerAddress);

        const randomWallet = ethers.Wallet.createRandom(ethers.provider);
        await network.provider.send("hardhat_setBalance", [
          randomWallet.address,
          "0x3635C9ADC5DEA00000"
        ]);
        
        const repayAmount = await kettle.repayAmount(0);
        const loanTotal = repayAmount - ethers.parseEther("2");

        await testErc20.mint(randomWallet.address, loanTotal);
        await testErc20.connect(randomWallet).approve(kettleAddress, loanTotal);

        const refinanceOffer = getLoanOffer(
          randomWallet.address,
          testErc721Address,
          testErc20Address,
          loanTotal,
          ethers.parseEther("0"),
          loanTotal,
          DAY_SECONDS * 7,
          "1000",
          blockTimestamp + DAY_SECONDS * 7,
          []
        );

        await kettle.connect(borrower).borrowerRefinance(
          formatLien(await kettle.liens(0)),
          0,
          loanTotal,
          refinanceOffer,
          "0x"
        );

        expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
        expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

        expect(await testErc20.balanceOf(borrowerAddress)).to.equal(initialBorrowerBalance - ethers.parseEther("2"))
      })
    });

    describe("Borrow -> Default", () => {
      beforeEach(async () => {
        loanOffer = getLoanOffer(
          lenderAddress,
          testErc721Address,
          testErc20Address,
          ethers.parseEther("10"),
          ethers.parseEther("0"),
          ethers.parseEther("10"),
          DAY_SECONDS * 7,
          "1000",
          blockTimestamp + DAY_SECONDS * 7,
          [
            getFee(250, await protocolFeeCollector.getAddress()),
            getFee(100, await devFeeCollector.getAddress())
          ]
        );

        await kettle.connect(borrower).borrow(
          loanOffer, 
          "0x", 
          ethers.parseEther("10").toString(), 
          1
        );

        expect(await testErc20.balanceOf(await protocolFeeCollector.getAddress())).to.equal(ethers.parseEther("0.25"));
        expect(await testErc20.balanceOf(await devFeeCollector.getAddress())).to.equal(ethers.parseEther("0.1"));
        expect(await testErc20.balanceOf(await borrower.getAddress())).to.equal(ethers.parseEther("9.65"));
        expect(await testErc721.ownerOf(1)).to.equal(await kettle.getAddress());
      });

      it("should let lender sieze loan if defaulted", async function () {
        const lien = await kettle.liens(0);
        time.setNextBlockTimestamp(lien.startTime + lien.duration + BigInt(1));

        await kettle.connect(lender).seize([
          {
            lien: formatLien(await kettle.liens(0)),
            lienId: 0
          }
        ]);

        expect(await testErc721.ownerOf(1)).to.equal(lenderAddress);
      });
    });
  });
});
    // it("should start loan (partial amounts)", async function () {
    //   const loanOffer = getLoanOffer(
    //     await lender.getAddress(),
    //     await testErc721.getAddress(),
    //     await testErc20.getAddress(),
    //     ethers.parseEther("1"),
    //     ethers.parseEther("0"),
    //     ethers.parseEther("1"),
    //     DAY_SECONDS * 7,
    //     1000,
    //     await getLatestTimestamp() + DAY_SECONDS * 7,
    //     [
    //       getFee(250, await protocolFeeCollector.getAddress()),
    //       getFee(100, await devFeeCollector.getAddress())
    //     ]
    //   );

    //   await kettle.connect(borrower).borrow(
    //     loanOffer, 
    //     "0x",
    //     ethers.parseEther("0.6"), 
    //     1
    //   );
      
    //   expect(await testErc20.balanceOf(await protocolFeeCollector.getAddress())).to.equal(ethers.parseEther("0.6") * BigInt(250) / BigInt(10000));
    //   expect(await testErc20.balanceOf(await devFeeCollector.getAddress())).to.equal(ethers.parseEther("0.6") * BigInt(100) / BigInt(10000));
    //   expect(await testErc20.balanceOf(await borrower.getAddress())).to.equal(ethers.parseEther("0.6") * BigInt(9650) / BigInt(10000));
    //   expect(await testErc721.ownerOf(1)).to.equal(await kettle.getAddress());

    //   await testErc721.mint(await borrower.getAddress(), 2);
    //   await kettle.connect(borrower).borrow(
    //     loanOffer,
    //     "0x",
    //     ethers.parseEther("0.4"),
    //     2
    //   )

    //   expect(await testErc20.balanceOf(await protocolFeeCollector.getAddress())).to.equal(ethers.parseEther("1") * BigInt(250) / BigInt(10000));
    //   expect(await testErc20.balanceOf(await devFeeCollector.getAddress())).to.equal(ethers.parseEther("1") * BigInt(100) / BigInt(10000));
    //   expect(await testErc20.balanceOf(await borrower.getAddress())).to.equal(ethers.parseEther("1") * BigInt(9650) / BigInt(10000));
    //   expect(await testErc721.ownerOf(2)).to.equal(await kettle.getAddress());
    // });

    // it('should throw error if loan offer is expired', async function () {
    //   const loanOffer = getLoanOffer(
    //     await lender.getAddress(),
    //     await testErc721.getAddress(),
    //     await testErc20.getAddress(),
    //     ethers.parseEther("1"),
    //     ethers.parseEther("0"),
    //     ethers.parseEther("1"),
    //     DAY_SECONDS * 7,
    //     1000,
    //     await getLatestTimestamp() + DAY_SECONDS * 7,
    //     [
    //       getFee(250, await protocolFeeCollector.getAddress()),
    //       getFee(100, await devFeeCollector.getAddress())
    //     ]
    //   );

    //   await time.setNextBlockTimestamp(await getLatestTimestamp() + DAY_SECONDS * 7 + 1);

    //   await expect(kettle.connect(borrower).borrow(
    //     loanOffer, 
    //     "0x", 
    //     ethers.parseEther("1").toString(), 
    //     1
    //   )).to.be.revertedWithCustomError(kettle, "OfferExpired")
    // })

    // it('should throw error if loan offer is cancelled', async function () {
    //   const loanOffer = getLoanOffer(
    //     await lender.getAddress(),
    //     await testErc721.getAddress(),
    //     await testErc20.getAddress(),
    //     ethers.parseEther("1"),
    //     ethers.parseEther("0"),
    //     ethers.parseEther("1"),
    //     DAY_SECONDS * 7,
    //     1000,
    //     await getLatestTimestamp() + DAY_SECONDS * 7,
    //     [
    //       getFee(250, await protocolFeeCollector.getAddress()),
    //       getFee(100, await devFeeCollector.getAddress())
    //     ]
    //   );

    //   // cancel offer
    //   await kettle.connect(lender).cancelOffer(loanOffer.salt);

    //   await expect(kettle.connect(borrower).borrow(
    //     loanOffer, 
    //     "0x", 
    //     ethers.parseEther("1").toString(), 
    //     1
    //   )).to.be.revertedWithCustomError(kettle, "OfferUnavailable")
    // })

    // it('should throw error if loan amount is higher than max amount', async function () {
    //   const loanOffer = getLoanOffer(
    //     await lender.getAddress(),
    //     await testErc721.getAddress(),
    //     await testErc20.getAddress(),
    //     ethers.parseEther("1"),
    //     ethers.parseEther("0"),
    //     ethers.parseEther("1"),
    //     DAY_SECONDS * 7,
    //     1000,
    //     await getLatestTimestamp() + DAY_SECONDS * 7,
    //     [
    //       getFee(250, await protocolFeeCollector.getAddress()),
    //       getFee(100, await devFeeCollector.getAddress())
    //     ]
    //   );

    //   await expect(kettle.connect(borrower).borrow(
    //     loanOffer, 
    //     "0x", 
    //     ethers.parseEther("1.5").toString(), 
    //     1
    //   )).to.be.revertedWithCustomError(kettle, "InvalidLoanAmount")
    // })

    // it('should throw error if loan amount is lower than min amount', async function () {
    //   const loanOffer = getLoanOffer(
    //     await lender.getAddress(),
    //     await testErc721.getAddress(),
    //     await testErc20.getAddress(),
    //     ethers.parseEther("1"),
    //     ethers.parseEther("0.5"),
    //     ethers.parseEther("1"),
    //     DAY_SECONDS * 7,
    //     1000,
    //     await getLatestTimestamp() + DAY_SECONDS * 7,
    //     [
    //       getFee(250, await protocolFeeCollector.getAddress()),
    //       getFee(100, await devFeeCollector.getAddress())
    //     ]
    //   );

    //   await expect(kettle.connect(borrower).borrow(
    //     loanOffer, 
    //     "0x", 
    //     ethers.parseEther("0.01").toString(), 
    //     1
    //   )).to.be.revertedWithCustomError(kettle, "InvalidLoanAmount")
    // });

    // it('should throw error if rate is too high', async function () {
    //   const loanOffer = getLoanOffer(
    //     await lender.getAddress(),
    //     await testErc721.getAddress(),
    //     await testErc20.getAddress(),
    //     ethers.parseEther("1"),
    //     ethers.parseEther("0"),
    //     ethers.parseEther("1"),
    //     DAY_SECONDS * 7,
    //     100_001,
    //     await getLatestTimestamp() + DAY_SECONDS * 7,
    //     [
    //       getFee(250, await protocolFeeCollector.getAddress()),
    //       getFee(100, await devFeeCollector.getAddress())
    //     ]
    //   );

    //   await expect(kettle.connect(borrower).borrow(
    //     loanOffer, 
    //     "0x", 
    //     ethers.parseEther("1").toString(), 
    //     1
    //   )).to.be.revertedWithCustomError(kettle, "RateTooHigh")
    // })

    // it('should throw error if insufficient balance', async function () {
    //   const loanOffer1 = getLoanOffer(
    //     await lender.getAddress(),
    //     await testErc721.getAddress(),
    //     await testErc20.getAddress(),
    //     ethers.parseEther("1"),
    //     ethers.parseEther("0"),
    //     ethers.parseEther("1"),
    //     DAY_SECONDS * 7,
    //     100_000,
    //     await getLatestTimestamp() + DAY_SECONDS * 7,
    //     [
    //       getFee(250, await protocolFeeCollector.getAddress()),
    //       getFee(100, await devFeeCollector.getAddress())
    //     ]
    //   );
  
    //   await kettle.connect(borrower).borrow(
    //     loanOffer1, 
    //     "0x", 
    //     ethers.parseEther("0.6").toString(), 
    //     1
    //   );

    //   await testErc721.mint(await borrower.getAddress(), 2);
    //   await expect(kettle.connect(borrower).borrow(
    //     loanOffer1, 
    //     "0x", 
    //     ethers.parseEther("0.6").toString(), 
    //     2
    //   )).to.be.revertedWithCustomError(kettle, "InsufficientOffer")
    // })
//   });
// });

//   describe("Repay", function () {

//   })
// });

//   describe.skip("Signature", function () {
//     it("Should sign an offer", async function () {
//       const [signer] = await ethers.getSigners();
//       console.log("Signer:", signer.address)

//       const { kettle } = await loadFixture(deployKettle);

//       const collection = ethers.Wallet.createRandom();
//       const currency = ethers.Wallet.createRandom();

//       const feeCollector = ethers.Wallet.createRandom();

//       const offer = {
//         lender: signer.address,
//         collection: collection.address,
//         currency: currency.address,
//         totalAmount: ethers.parseEther("1").toString(),
//         minAmount: ethers.parseEther("0").toString(),
//         maxAmount: ethers.parseEther("1").toString(),
//         duration: 60 * 60 * 24 * 7,
//         rate: 1000,
//         fees: [{
//           rate: 250,
//           recipient: feeCollector.address
//         }],
//         salt: ethers.hexlify(ethers.randomBytes(32)),
//         expirationTime: 1000,
//         nonce: 0
//       }

//       const offerHash = await kettle.getOfferHash(offer);
//       // console.log("offerHash:", offerHash);

//       const domain = {
//         name: "Kettle",
//         version: "1",
//         chainId: "1",
//         verifyingContract: kettle.target.toString()
//       }

//       console.log("Domain Seperator:", await kettle.information().then((info) => info.domainSeparator.toString()));

//       console.log("Hash:", await kettle.getHashToSign(offerHash))

//       const typedLoanItemsData = {
//         types: {
//           Fee: [
//             { name: "rate", type: "uint16" },
//             { name: "recipient", type: "address" },
//           ],
//           LoanOffer: [
//             { name: "lender", type: "address" },
//             { name: "collection", type: "address" },
//             { name: "currency", type: "address" },
//             { name: "totalAmount", type: "uint256" },
//             { name: "maxAmount", type: "uint256" },
//             { name: "minAmount", type: "uint256" },
//             { name: "duration", type: "uint256" },
//             { name: "rate", type: "uint256" },
//             { name: "fees", type: "Fee[]" },
//             { name: "salt", type: "uint256" },
//             { name: "expirationTime", type: "uint256" },
//             { name: "nonce", type: "uint256" },
//           ],
//         },
//         primaryType: "LoanOffer",
//       };

//       // const message = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [domainHash, offerHash]);

//       // console.log("message:", message);

//       // const signature = await signer.signMessage(offerHash);
//       // console.log("recover:", ethers.verifyMessage(offerHash, signature));

//       // const signature = await signer.signMessage(ethers.getBytes(message));
//       // console.log("Recovered", ethers.verifyMessage(message, signature));


//       const signature = await signer.signTypedData(domain, typedLoanItemsData.types, offer);
//       console.log("Message:", ethers.TypedDataEncoder.hash(domain, typedLoanItemsData.types, offer));
//       console.log("Recovered:", ethers.verifyTypedData(domain, typedLoanItemsData.types, offer, signature));

//       await kettle.verifyOfferSignature(offer, signature);

//     });
//   })
// });
