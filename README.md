# Kettle

## Examples
Lender makes Loan Offer, Borrower takes through `borrow` method
```ts
// lender makes loan offer
const loanOffer = {
  lender: "0x1234...6789",
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: 6789,
  collateralAmount: 1,
  totalAmount: 10000000000,
  minAmount: 0,
  maxAmount: 10000000000,
  duration: 7776000,
  rate: 2500,
  salt: 1212453...384783743,
  expiration: 1695051103,
  fees: [
    {
      rate: 250,
      recipient: "0xbc4...04e7"
    }
  ]
}

// lender signs loan offer
const offerSignature = await lender.signTypedDate(loanOffer);

// borrower requests authentication to take loan offer with collateral
const collateral = {
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: 6789,
  collateralAmount: 1
}

// request authentication from sdk
const { offerAuth, authSignature } = await kettle.getAuthentication({
  side: Side.BORROWER,
  taker: borrower,
  offer: loanOffer,
  collateral
});

// borrower start loan
await kettle.connect(borrower).borrow(
  loanOffer,
  offerAuth,
  offerSignature,
  authSignature,
  collateral.collateralIdentifier,
  "0x0000...0000",
  []
);
```

Lender makes Loan Offer for Collection, Borrower takes through `borrow` method
```ts
// lender makes loan offer
const loanOffer = {
  lender: "0x1234...6789",
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: "0x3463...e36a", // root of merkle tree for collection token ids
  collateralAmount: 1,
  totalAmount: 10000000000,
  minAmount: 0,
  maxAmount: 10000000000,
  duration: 7776000,
  rate: 2500,
  salt: 1212453...384783743,
  expiration: 1695051103,
  fees: [
    {
      rate: 250,
      recipient: "0xbc4...04e7"
    }
  ]
}

// lender signs loan offer
const offerSignature = await lender.signTypedDate(loanOffer);

// borrower requests authentication to take loan offer with collateral
const collateral = {
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: 6789,
  collateralAmount: 1
}

// request authentication from sdk
const { offerAuth, authSignature } = await kettle.getAuthentication({
  side: Side.BORROWER,
  taker: borrower,
  offer: loanOffer,
  collateral
});

// request proof
const proof = await kettle.getCollateralProof({
  collection: "0xbc4...04e7",
  root: "0x3463...e36a",
  tokenId: 6789
});

// borrower start loan
await kettle.connect(borrower).borrow(
  loanOffer,
  offerAuth,
  offerSignature,
  authSignature,
  10000000000,
  collateral.collateralIdentifier,
  "0x0000...0000",
  proof
);
```

Borrower makes Borrow Offer, Lender takes offer through `loan` method
```ts
// lender makes loan offer
const borrowOffer = {
  borrower: "0x1234...6789",
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: 6789, // root of merkle tree for collection token ids
  collateralAmount: 1,
  loanAmount: 10000000000,
  duration: 7776000,
  rate: 2500,
  salt: 1212453...384783743,
  expiration: 1695051103,
  fees: [
    {
      rate: 250,
      recipient: "0xbc4...04e7"
    }
  ]
}

// borrower signs loan offer
const offerSignature = await borrower.signTypedDate(loanOffer);

// lender requests authentication to take loan offer with collateral
const collateral = {
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: 6789,
  collateralAmount: 1
}

// lender request authentication from sdk
const { offerAuth, authSignature } = await kettle.getAuthentication({
  side: Side.LENDER,
  taker: lender,
  offer: borrowOffer,
  collateral
});

// lender starts loan
await kettle.connect(lender).loan(
  borrowOffer,
  offerAuth,
  offerSignature,
  authSignature
);
```

Borrower refinances current lien with new loan offer through `refinance` method
```ts
// lender makes loan offer
const loanOffer = {
  lender: "0x1234...6789",
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: 6789,
  collateralAmount: 1,
  totalAmount: 10000000000,
  minAmount: 0,
  maxAmount: 10000000000,
  duration: 7776000,
  rate: 2500,
  salt: 1212453...384783743,
  expiration: 1695051103,
  fees: [
    {
      rate: 250,
      recipient: "0xbc4...04e7"
    }
  ]
}

// lender signs loan offer
const offerSignature = await lender.signTypedDate(loanOffer);

// get lien structure
const lien = await kettle.getLien(lienId);

// borrower requests authentication to take loan offer with collateral
const collateral = {
  collection: "0xbc4...04e7",
  collateralType: 0,
  collateralIdentifier: 6789,
  collateralAmount: 1
}

// borrower request authentication from sdk
const { offerAuth, authSignature } = await kettle.getAuthentication({
  side: Side.LENDER,
  taker: lender,
  offer: borrowOffer,
  collateral
});

// borrower refinances loan
await kettle.connect(borrower).refinance(
  lien,
  lienId,
  10000000000,
  borrowOffer,
  loanOffer,
  offerAuth,
  offerSignature,
  authSignature,
  []
);
```

Borrower repays current lien with `repay` method
```ts
// get lien from graph
const lien = await kettle.getLien(lienId);

await kettle.connect(borrower).repay(
  lien,
  lienId
);
```

Lender seizes defaulted loan through `seize` method
```ts
// get lien from graph
const lien = await kettle.getLien(lienId);

await kettle.connect(lender).seize([{ lien, lienId }]);
```

## Contract Methods
```solidity

/**
  * Borrow
  * @notice can start loan on behalf of other borrower (default msg.sender)
  * called by borrowers taking loan offer signed by lenders
  * verifies and takes loan offer
  * transfers collateral from msg.sender to escrow
  * transfers payment from lender to borrower net of fees
  * starts lien and emits `LoanOfferTaken` event
  * @param offer Loan offer
  * @param auth Offer auth
  * @param offerSignature Lender offer signature
  * @param authSignature Auth signer signature
  * @param loanAmount Loan amount in currency denomination
  * @param collateralTokenId Token id to provide as collateral
  * @param borrower address of borrower
  * @param proof proof for criteria offer
  * @return lienId New lien id
  */
function borrow(
  LoanOffer calldata offer,
  OfferAuth calldata auth,
  bytes calldata offerSignature,
  bytes calldata authSignature,
  uint256 loanAmount,
  uint256 collateralTokenId,
  address borrower,
  bytes32[] calldata proof
) external returns (uint256 lienId);

/**
 * Loan
 * called by lenders taking borrow offer signed by borrower
 * verifies and takes loan offer
 * transfers collateral from borrower to escrow
 * transfers payment from msg.sender to borrower net of fees
 * starts lien and emits `LoanOfferTaken` event
 * @param offer Loan offer
 * @param auth Offer auth
 * @param offerSignature Lender offer signature
 * @param authSignature Auth signer signature
 * @return lienId New lien id
 */
function loan(
  BorrowOffer calldata offer,
  OfferAuth calldata auth,
  bytes calldata offerSignature,
  bytes calldata authSignature
) external returns (uint256 lienId);

/**
 * Refinance
 * ONLY callable by borrower
 * called by borrowers to refinance current lien with new loan offer
 * verifies and takes loan offer
 * if new loan amount is less than current repayment amount
 * - transfer loan amount from new lender to old lender
 * - transfer rest of repayment from borrower to old lender
 * else if the the new loan amount is greater than current repayment amount
 * - transfer full repayment from new lender to old lender
 * - transfer rest of loan amount from new lender to borrower
 * @param lien Existing lien
 * @param lienId Identifier of existing lien
 * @param loanAmount Loan amount in currency denomination
 * @param offer Loan offer
 * @param auth Offer auth
 * @param offerSignature Lender offer signature
 * @param authSignature Auth signer signature
 * @param proof proof for criteria offer
 */
function refinance(
  Lien calldata lien,
  uint256 lienId,
  uint256 loanAmount,
  LoanOffer calldata offer,
  OfferAuth calldata auth,
  bytes calldata offerSignature,
  bytes calldata authSignature,
  bytes32[] calldata proof
) external;

/**
 * Repay
 * fully repay lien
 * callable by any address
 * repayment amount is transferred from msg.sender to lender
 * collateral is transferred from escrow to lien borrower
 * @param lien Lien preimage
 * @param lienId Lien id
 */
function repay(
  Lien calldata lien, 
  uint256 lienId
) external;

/**
 * Seize
 * callable by lender
 * seize one or more loans in default
 * each loan must be defaulted in order to seize all
 * transfers collateral from escrow to lender
 * @param lienPointers List of lien, lienId pairs
 */
function seize(LienPointer[] calldata lienPointers) external;
```

## Contract Structs and Types
```solidity
/**
 * Loan Offer
 * created and signed by `lenders`
 * specifies a partially fulfillable offer to start a lien with lender payment
 * amount taken when starting lien must be less than `maxAmount` and greater than `minAmount`
 */
struct LoanOffer {
  address lender;                 // address of lender
  address collection;             // address of collection
  uint8 collateralType;           // type of collateral
  uint256 collateralIdentifier;   // token id or criteria root
  uint256 collateralAmount;       // amount of collateral (default 1 for ERC721)
  address currency;               // address of the currency
  uint256 totalAmount;            // total amount takeable by loan offer over all liens
  uint256 minAmount;              // min amount takeable by loan offer for a single lien
  uint256 maxAmount;              // max amount takeable by loan offer for a single lien
  uint256 duration;               // duration of lien
  uint256 rate;                   // annualized rate of lien
  uint256 salt;                   // random number for unique offer hashing
  uint256 expiration;             // loan offer expirtation
  Fee[] fees;                     // array of fees
}

/**
 * Borrow Offer
 * created and signed by `borrowers`
 * specifies a fully takeable offer to start a lien against borrower collateral
 * amount taken when starting lien must equal `loanAmount`
 */
struct BorrowOffer {
  address borrower;               // address of borrower
  address collection;             // address of collection
  uint8 collateralType;           // type of collateral
  uint256 collateralIdentifier;   // token identifier
  uint256 collateralAmount;       // amount of collateral (default 1 for ERC721)
  address currency;               // address of currency
  uint256 loanAmount;             // desired loan amount by borrower
  uint256 duration;               // lien duration
  uint256 rate;                   // annualized lien rate
  uint256 salt;                   // random number for unique offer hashing
  uint256 expiration;             // borrow offer expiration
  Fee[] fees;                     // array of fees
}

/**
 * Fee
 * specifies the proportional amount of principal taken as fee
 * recipient recieves fee
 * fee is taken taken from loan amount before lien is started
 * the amount that must be paid back for loan is based on GROSS amount before fee
 * (i.e.) fee does not reduce principal reflected in lien, only principal sent to borrower
 */
interface Fee {
  uint16 rate;                    // basis point rate of fee (50 = 0.50%)
  address recipient;              // address of fee recipient
}

/**
 * Offer Auth
 * object needs to be signed by Kettle authenticator
 * protects borrowers and lenders from unathenticated loan agreements
 * specifies certain collateral can be taken by a certain offer by a certain taker
 */
interface OfferAuth {
  bytes32 offerHash               // hash of the offer being taken
  address taker                   // address taking offer
  uint256 expiration              // authentication expiration
  bytes32 collateralHash          // hash of the collateral being taken by offer
}

/**
 * Collateral Type
 * enumerated collateral types
 */
enum CollateralType {
  ERC721: 0                       // specified by specific token id
  ERC1155: 1                      // specified by specific token id
  ERC721_WITH_CRITERIA: 2         // specified by range of token ids (i.e. collection or trait offer)
  ERC1155_WITH_CRITERIA: 3        // specified by range of token ids (i.e. collection or trait offer)
}
```

