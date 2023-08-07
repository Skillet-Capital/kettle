// import {
//   time,
//   loadFixture,
// } from "@nomicfoundation/hardhat-network-helpers";
// import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

// import { expect } from "chai";
// import { ethers, network } from "hardhat";

// import { Wallet } from "ethers";
// import { LoanOffer } from "../types/loanOffer";
// import { formatLien, getFee, getLatestTimestamp, getLoanOffer } from "./helpers";

// import { Kettle, TestERC20, TestERC721 } from "../typechain-types";
// import { LienStruct } from "../typechain-types/contracts/Kettle";

// import { parseEther } from '@ethersproject/units';
// import { MaxUint256 } from "@ethersproject/constants";

// const DAY_SECONDS = 24 * 60 * 60;

// describe.skip("Kettle", function () {

//   async function deployKettle() {

//     /* Deploy TestERC721 */
//     const TestERC721 = await ethers.getContractFactory("TestERC721");
//     const testErc721 = await TestERC721.deploy();
//     await testErc721.deployed();

//     /* Deploy TestERC20 */
//     const TestErc20 = await ethers.getContractFactory("TestERC20");
//     const testErc20 = await TestErc20.deploy();
//     await testErc20.deployed();

//     /* Deploy Helpers */
//     const Helpers = await ethers.getContractFactory("Helpers");
//     const helpers = await Helpers.deploy();
//     await helpers.deployed();

//     /* Deploy Kettle */
//     const Kettle = await ethers.getContractFactory("Kettle", { libraries: { Helpers: helpers.address } });
//     const kettle = await Kettle.deploy({ gasLimit: 1e8 });
//     await kettle.deployed();

//     return { kettle, testErc721, testErc20 };
//   }

//   describe.skip("Deployment", function () {
//     it("Should deploy", async function () {
//       const { kettle, testErc721, testErc20 } = await loadFixture(deployKettle);

//       console.log("Kettle:", kettle.address);
//       console.log("TestERC721:", testErc721.address);
//       console.log("TestERC20:", testErc20.address);
//     });
//   });

//   describe.skip("Kettle", () => {
//     let borrower: Wallet;
//     let lender: Wallet;
//     let protocolFeeCollector: Wallet;
//     let devFeeCollector: Wallet;

//     let kettle: Kettle;
//     let testErc721: TestERC721;
//     let testErc20: TestERC20;

//     let kettleAddress: string;
//     let testErc721Address: string;
//     let testErc20Address: string;

//     let blockTimestamp: number;

//     let loanAmount: bigint;
//     let loanOffer: LoanOffer;

//     let lien: LienStruct;
//     let repayAmount: bigint;

//     beforeEach(async () => {
//       ({ kettle, testErc721, testErc20 } = await loadFixture(deployKettle));

//       [, borrower, lender, protocolFeeCollector, devFeeCollector] = await ethers.getSigners();

//       await testErc721.connect(borrower).setApprovalForAll(kettle.address, true);
//       await testErc721.connect(lender).setApprovalForAll(kettle.address, true);

//       await testErc20.connect(lender).approve(kettle.address, MaxUint256);
//       await testErc20.connect(borrower).approve(kettle, MaxUint256);

//       blockTimestamp = await getLatestTimestamp();
//     });

//     describe("Borrow", () => {

//       it("collateralType === ERC721", async () => {
//         const loanAmount = parseEther("10");

//         await testErc721.mint(borrower.address, 1);
//         await testErc20.mint(lender.address, loanAmount);

//         loanOffer = getLoanOffer(
//           1,
//           lender.address,
//           testErc721Address,
//           testErc20Address,
//           loanAmount,
//           0,
//           loanAmount,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, await protocolFeeCollector.getAddress()),
//             getFee(100, await devFeeCollector.getAddress())
//           ]
//         );

//         // const txn = await kettle.connect(borrower).borrow(
//         //   loanOffer, 
//         //   "0x", 
//         //   loanAmount, 
//         //   1,
//         //   []
//         // );
//       });

//       it("collateralType === ERC721_WITH_CRITERIA", async () => {
//         const loanAmount = parseEther("10");

//         await testErc721.mint(borrower.address, 1);
//         await testErc20.mint(lender.address, loanAmount);

//         loanOffer = getLoanOffer(
//           1,
//           lender.address,
//           testErc721Address,
//           testErc20Address,
//           loanAmount,
//           0,
//           loanAmount,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, await protocolFeeCollector.getAddress()),
//             getFee(100, await devFeeCollector.getAddress())
//           ]
//         );

//         const txn = await kettle.connect(borrower).borrow(
//           loanOffer, 
//           "0x", 
//           loanAmount, 
//           1,
//           []
//         );
//       });
//     });

//     describe.skip("Borrow Batch -> Repay Batch", () => {
//       it("should start multiple loans from single offer", async () => {
//         loanAmount = ethers.parseEther("10");

//         loanOffer = getLoanOffer(
//           0,
//           lenderAddress,
//           testErc721Address,
//           testErc20Address,
//           loanAmount,
//           0,
//           loanAmount,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, protocolFeeCollectorAddress),
//             getFee(100, devFeeCollectorAddress)
//           ]
//         );
        
//         /* mint multiple ERC721 tokens */
//         await testErc721.mint(borrowerAddress, 1);
//         await testErc721.mint(borrowerAddress, 2);
//         await testErc721.mint(borrowerAddress, 3);

//         const fullfillments = [
//           {
//             loanIndex: 0,
//             loanAmount: ethers.parseEther("5"),
//             collateralIdentifier: 1,
//             proof: []
//           },
//           {
//             loanIndex: 0,
//             loanAmount: ethers.parseEther("2"),
//             collateralIdentifier: 2,
//             proof: []
//           },
//           {
//             loanIndex: 0,
//             loanAmount: ethers.parseEther("3"),
//             collateralIdentifier: 3,
//             proof: []
//           }
//         ];

//         /** Start Multiple Loans */
//         const txn = await kettle.connect(borrower).borrowBatch(
//           [{
//             offer: loanOffer,
//             signature: "0x"
//           }],
//           fullfillments
//         );

//         const receipt = await txn.wait();
//         const liens = receipt!.logs
//           .filter((log) => log.address === kettleAddress)
//           .map((log) => kettle.interface.decodeEventLog("LoanOfferTaken", log.data, log.topics))
//           .map((lien) => formatLien(lien))

//         /** Repay Multiple Loans */
//         const totalRepaymentAmount = await Promise.all(
//           liens.map((lien) => kettle.getRepaymentAmount(lien.borrowAmount, lien.rate, lien.duration))
//         ).then((repayments) => repayments.reduce((a, b) => BigInt(a) + BigInt(b), BigInt(0)));

//         await testErc20.mint(borrowerAddress, totalRepaymentAmount - await testErc20.balanceOf(borrowerAddress));
//         await kettle.connect(borrower).repayBatch(liens.map((lien) => ({ lien, lienId: lien.lienId })));
//       })

//       it("should start multiple loans from multiple offers", async () => {
//         await testErc20.mint(await lender.getAddress(), ethers.parseEther("10"));
//         loanAmount = ethers.parseEther("10");

//         const loanOffer1 = getLoanOffer(
//           0,
//           lenderAddress,
//           testErc721Address,
//           testErc20Address,
//           loanAmount,
//           0,
//           loanAmount,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, protocolFeeCollectorAddress),
//             getFee(100, devFeeCollectorAddress)
//           ]
//         );

//         const loanOffer2 = getLoanOffer(
//           0,
//           lenderAddress,
//           testErc721Address,
//           testErc20Address,
//           loanAmount,
//           0,
//           loanAmount,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, protocolFeeCollectorAddress),
//             getFee(100, devFeeCollectorAddress)
//           ]
//         );
        
//         /* mint multiple ERC721 tokens */
//         await testErc721.mint(borrowerAddress, 1);
//         await testErc721.mint(borrowerAddress, 2);
//         await testErc721.mint(borrowerAddress, 3);
//         await testErc721.mint(borrowerAddress, 4);
//         await testErc721.mint(borrowerAddress, 5);
//         await testErc721.mint(borrowerAddress, 6);

//         const loanOffers = [
//           {
//             offer: loanOffer1,
//             signature: "0x"
//           },
//           {
//             offer: loanOffer2,
//             signature: "0x"
//           }
//         ]

//         const fullfillments = [
//           {
//             loanIndex: 0,
//             loanAmount: ethers.parseEther("5"),
//             collateralIdentifier: 1,
//             proof: []
//           },
//           {
//             loanIndex: 0,
//             loanAmount: ethers.parseEther("2"),
//             collateralIdentifier: 2,
//             proof: []
//           },
//           {
//             loanIndex: 0,
//             loanAmount: ethers.parseEther("3"),
//             collateralIdentifier: 3,
//             proof: []
//           },
//           {
//             loanIndex: 1,
//             loanAmount: ethers.parseEther("5"),
//             collateralIdentifier: 4,
//             proof: [],
//           },
//           {
//             loanIndex: 1,
//             loanAmount: ethers.parseEther("2"),
//             collateralIdentifier: 5,
//             proof: []
//           },
//           {
//             loanIndex: 1,
//             loanAmount: ethers.parseEther("3"),
//             collateralIdentifier: 6,
//             proof: []
//           }
//         ];

//         const txn = await kettle.connect(borrower).borrowBatch(
//           loanOffers,
//           fullfillments
//         );
//       })
//     })

//     describe("Borrow -> Repay", () => {

//       beforeEach(async () => {
//         await testErc721.mint(borrowerAddress, 1);

//         loanAmount = ethers.parseEther("10");

//         loanOffer = getLoanOffer(
//           1,
//           lenderAddress,
//           testErc721Address,
//           testErc20Address,
//           loanAmount,
//           0,
//           loanAmount,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, await protocolFeeCollector.getAddress()),
//             getFee(100, await devFeeCollector.getAddress())
//           ]
//         );

//         const txn = await kettle.connect(borrower).borrow(
//           loanOffer, 
//           "0x", 
//           loanAmount, 
//           1,
//           []
//         );

//         (lien = await txn.wait().then(
//           (receipt) => {
//             const offerTakenLog = receipt?.logs?.find(
//               (log) => (log.address === kettleAddress)
//             );

//             const _lien = kettle.interface.decodeEventLog(
//               "LoanOfferTaken", 
//               offerTakenLog?.data ?? "0x", 
//               offerTakenLog?.topics
//             );

//             return formatLien(_lien);
//           }
//         ));

//         repayAmount = await kettle.getRepaymentAmount(lien.borrowAmount, lien.rate, lien.duration);

//         let totalFees: bigint = BigInt(0);
//         for (const fee of loanOffer.fees) {
//           let feeAmount: bigint = loanAmount * BigInt(fee.rate) / BigInt(10000);
//           expect(await testErc20.balanceOf(fee.recipient)).to.equal(feeAmount);
//           totalFees += feeAmount
//         }

//         expect(await testErc20.balanceOf(borrowerAddress)).to.equal(loanAmount - totalFees);
//         expect(await testErc721.ownerOf(1)).to.equal(await kettle.getAddress());
//       });

//       it("should repay loan (by borrower)", async function () {
//         await testErc20.mint(borrowerAddress, repayAmount - await testErc20.balanceOf(borrowerAddress));
//         await testErc20.connect(borrower).approve(kettleAddress, repayAmount);

//         await kettle.connect(borrower).repay(lien, 0);

//         expect(await testErc20.balanceOf(borrowerAddress)).to.equal(0);
//         expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

//         expect(await testErc721.ownerOf(1)).to.equal(borrowerAddress);
//       })

//       it("should repay loan (by someone else)", async function () {
//         const randomWallet = ethers.Wallet.createRandom(ethers.provider);
//         await network.provider.send("hardhat_setBalance", [
//           randomWallet.address,
//           "0x3635C9ADC5DEA00000"
//         ]);

//         await testErc20.mint(randomWallet, repayAmount);
//         await testErc20.connect(randomWallet).approve(kettleAddress, repayAmount);

//         await kettle.connect(randomWallet).repay(lien, 0);
        
//         expect(await testErc20.balanceOf(randomWallet)).to.equal(0);
//         expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

//         expect(await testErc721.ownerOf(1)).to.equal(borrowerAddress);
//       });
//     });

//     describe.skip("Borrow -> Refinance", () => {
//       beforeEach(async () => {
//         loanOffer = getLoanOffer(
//           1,
//           lenderAddress,
//           testErc721Address,
//           testErc20Address,
//           ethers.parseEther("10"),
//           ethers.parseEther("0"),
//           ethers.parseEther("10"),
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, await protocolFeeCollector.getAddress()),
//             getFee(100, await devFeeCollector.getAddress())
//           ]
//         );

//         const txn = await kettle.connect(borrower).borrow(
//           loanOffer, 
//           "0x", 
//           ethers.parseEther("10").toString(), 
//           1
//         );

//         (lien = await txn.wait().then(
//           (receipt) => {
//             const offerTakenLog = receipt?.logs?.find(
//               (log) => (log.address === kettleAddress)
//             );

//             const _lien = kettle.interface.decodeEventLog(
//               "LoanOfferTaken", 
//               offerTakenLog?.data ?? "0x", 
//               offerTakenLog?.topics
//             );

//             return formatLien(_lien);
//           }
//         ));

//         repayAmount = await kettle.getRepaymentAmount(lien.borrowAmount, lien.rate, lien.duration);

//         expect(await testErc20.balanceOf(await protocolFeeCollector.getAddress())).to.equal(ethers.parseEther("0.25"));
//         expect(await testErc20.balanceOf(await devFeeCollector.getAddress())).to.equal(ethers.parseEther("0.1"));
//         expect(await testErc20.balanceOf(await borrower.getAddress())).to.equal(ethers.parseEther("9.65"));
//         expect(await testErc721.ownerOf(1)).to.equal(await kettle.getAddress());
//       });

//       it("should refinance loan with repay amount (by anyone)", async function () {
//         const randomWallet = ethers.Wallet.createRandom(ethers.provider);
//         await network.provider.send("hardhat_setBalance", [
//           randomWallet.address,
//           "0x3635C9ADC5DEA00000"
//         ]);
        
//         await testErc20.mint(randomWallet.address, repayAmount);
//         await testErc20.connect(randomWallet).approve(kettleAddress, repayAmount);

//         const refinanceOffer = getLoanOffer(
//           randomWallet.address,
//           testErc721Address,
//           testErc20Address,
//           repayAmount,
//           ethers.parseEther("0"),
//           repayAmount,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           []
//         );

//         await kettle.connect(randomWallet).refinance(
//           lien,
//           0,
//           repayAmount,
//           refinanceOffer,
//           "0x"
//         );

//         expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
//         expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);
//       });

//       it("should refinance loan with higher amount (by anyone)", async function () {
//         const initialBorrowerBalance = await testErc20.balanceOf(borrowerAddress);

//         const randomWallet = ethers.Wallet.createRandom(ethers.provider);
//         await network.provider.send("hardhat_setBalance", [
//           randomWallet.address,
//           "0x3635C9ADC5DEA00000"
//         ]);
        
//         const loanTotal = repayAmount + ethers.parseEther("2");

//         await testErc20.mint(randomWallet.address, loanTotal);
//         await testErc20.connect(randomWallet).approve(kettleAddress, loanTotal);

//         const refinanceOffer = getLoanOffer(
//           randomWallet.address,
//           testErc721Address,
//           testErc20Address,
//           loanTotal,
//           ethers.parseEther("0"),
//           loanTotal,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           []
//         );

//         await kettle.connect(randomWallet).refinance(
//           lien,
//           0,
//           loanTotal,
//           refinanceOffer,
//           "0x"
//         );

//         expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
//         expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

//         expect(await testErc20.balanceOf(borrowerAddress)).to.equal(initialBorrowerBalance + ethers.parseEther("2"))
//       });

//       it("should refinance loan with higher amount (by borrower)", async function () {
//         const initialBorrowerBalance = await testErc20.balanceOf(borrowerAddress);

//         const randomWallet = ethers.Wallet.createRandom(ethers.provider);
//         await network.provider.send("hardhat_setBalance", [
//           randomWallet.address,
//           "0x3635C9ADC5DEA00000"
//         ]);
        
//         const loanTotal = repayAmount + ethers.parseEther("2");

//         await testErc20.mint(randomWallet.address, loanTotal);
//         await testErc20.connect(randomWallet).approve(kettleAddress, loanTotal);

//         const refinanceOffer = getLoanOffer(
//           randomWallet.address,
//           testErc721Address,
//           testErc20Address,
//           loanTotal,
//           ethers.parseEther("0"),
//           loanTotal,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           []
//         );

//         await kettle.connect(borrower).borrowerRefinance(
//           lien,
//           0,
//           loanTotal,
//           refinanceOffer,
//           "0x"
//         );

//         expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
//         expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

//         expect(await testErc20.balanceOf(borrowerAddress)).to.equal(initialBorrowerBalance + ethers.parseEther("2"))
//       })


//       it("should refinance loan with lower amount (by borrower)", async function () {
//         const initialBorrowerBalance = await testErc20.balanceOf(borrowerAddress);

//         const randomWallet = ethers.Wallet.createRandom(ethers.provider);
//         await network.provider.send("hardhat_setBalance", [
//           randomWallet.address,
//           "0x3635C9ADC5DEA00000"
//         ]);
        
//         const loanTotal = repayAmount - ethers.parseEther("2");

//         await testErc20.mint(randomWallet.address, loanTotal);
//         await testErc20.connect(randomWallet).approve(kettleAddress, loanTotal);

//         const refinanceOffer = getLoanOffer(
//           randomWallet.address,
//           testErc721Address,
//           testErc20Address,
//           loanTotal,
//           ethers.parseEther("0"),
//           loanTotal,
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           []
//         );

//         await kettle.connect(borrower).borrowerRefinance(
//           lien,
//           0,
//           loanTotal,
//           refinanceOffer,
//           "0x"
//         );

//         expect(await testErc20.balanceOf(randomWallet.address)).to.equal(0);
//         expect(await testErc20.balanceOf(lenderAddress)).to.equal(repayAmount);

//         expect(await testErc20.balanceOf(borrowerAddress)).to.equal(initialBorrowerBalance - ethers.parseEther("2"))
//       })
//     });

//     describe.skip("Borrow -> Default", () => {
//       beforeEach(async () => {
//         loanOffer = getLoanOffer(
//           lenderAddress,
//           testErc721Address,
//           testErc20Address,
//           ethers.parseEther("10"),
//           ethers.parseEther("0"),
//           ethers.parseEther("10"),
//           DAY_SECONDS * 7,
//           "1000",
//           blockTimestamp + DAY_SECONDS * 7,
//           [
//             getFee(250, await protocolFeeCollector.getAddress()),
//             getFee(100, await devFeeCollector.getAddress())
//           ]
//         );

//         const txn = await kettle.connect(borrower).borrow(
//           loanOffer, 
//           "0x", 
//           ethers.parseEther("10").toString(), 
//           1
//         );

//         (lien = await txn.wait().then(
//           (receipt) => {
//             const offerTakenLog = receipt?.logs?.find(
//               (log) => (log.address === kettleAddress)
//             );

//             const _lien = kettle.interface.decodeEventLog(
//               "LoanOfferTaken", 
//               offerTakenLog?.data ?? "0x", 
//               offerTakenLog?.topics
//             );

//             return formatLien(_lien);
//           }
//         ));

//         // expect(await testErc20.balanceOf(await protocolFeeCollector.getAddress())).to.equal(ethers.parseEther("0.25"));
//         // expect(await testErc20.balanceOf(await devFeeCollector.getAddress())).to.equal(ethers.parseEther("0.1"));
//         // expect(await testErc20.balanceOf(await borrower.getAddress())).to.equal(ethers.parseEther("9.65"));
//         expect(await testErc721.ownerOf(1)).to.equal(await kettle.getAddress());
//       });

//       it("should let lender sieze loan if defaulted", async function () {
//         time.setNextBlockTimestamp(BigInt(lien.startTime) + BigInt(lien.duration) + BigInt(1));

//         await kettle.connect(lender).seize([
//           {
//             lien: lien,
//             lienId: 0
//           }
//         ]);

//         expect(await testErc721.ownerOf(1)).to.equal(lenderAddress);
//       });
//     });
//   });
// });

// //   describe.skip("Signature", function () {
// //     it("Should sign an offer", async function () {
// //       const [signer] = await ethers.getSigners();
// //       console.log("Signer:", signer.address)

// //       const collection = ethers.Wallet.createRandom();
// //       const currency = ethers.Wallet.createRandom();

// //       const feeCollector = ethers.Wallet.createRandom();

// //       const offer = {
// //         lender: signer.address,
// //         collection: collection.address,
// //         currency: currency.address,
// //         totalAmount: ethers.parseEther("1").toString(),
// //         minAmount: ethers.parseEther("0").toString(),
// //         maxAmount: ethers.parseEther("1").toString(),
// //         duration: 60 * 60 * 24 * 7,
// //         rate: 1000,
// //         fees: [{
// //           rate: 250,
// //           recipient: feeCollector.address
// //         }],
// //         salt: ethers.hexlify(ethers.randomBytes(32)),
// //         expirationTime: 1000,
// //         nonce: 0
// //       }

// //       const offerHash = await kettle.getOfferHash(offer);
// //       // console.log("offerHash:", offerHash);

// //       const domain = {
// //         name: "Kettle",
// //         version: "1",
// //         chainId: "1",
// //         verifyingContract: kettle.target.toString()
// //       }

// //       console.log("Domain Seperator:", await kettle.information().then((info) => info.domainSeparator.toString()));

// //       console.log("Hash:", await kettle.getHashToSign(offerHash))

// //       const typedLoanItemsData = {
// //         types: {
// //           Fee: [
// //             { name: "rate", type: "uint16" },
// //             { name: "recipient", type: "address" },
// //           ],
// //           LoanOffer: [
// //             { name: "lender", type: "address" },
// //             { name: "collection", type: "address" },
// //             { name: "currency", type: "address" },
// //             { name: "totalAmount", type: "uint256" },
// //             { name: "maxAmount", type: "uint256" },
// //             { name: "minAmount", type: "uint256" },
// //             { name: "duration", type: "uint256" },
// //             { name: "rate", type: "uint256" },
// //             { name: "fees", type: "Fee[]" },
// //             { name: "salt", type: "uint256" },
// //             { name: "expirationTime", type: "uint256" },
// //             { name: "nonce", type: "uint256" },
// //           ],
// //         },
// //         primaryType: "LoanOffer",
// //       };

// //       // const message = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [domainHash, offerHash]);

// //       // console.log("message:", message);

// //       // const signature = await signer.signMessage(offerHash);
// //       // console.log("recover:", ethers.verifyMessage(offerHash, signature));

// //       // const signature = await signer.signMessage(ethers.getBytes(message));
// //       // console.log("Recovered", ethers.verifyMessage(message, signature));


// //       const signature = await signer.signTypedData(domain, typedLoanItemsData.types, offer);
// //       console.log("Message:", ethers.TypedDataEncoder.hash(domain, typedLoanItemsData.types, offer));
// //       console.log("Recovered:", ethers.verifyTypedData(domain, typedLoanItemsData.types, offer, signature));

// //       await kettle.verifyOfferSignature(offer, signature);

// //     });
// //   })
// // });
