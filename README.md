# Kettle

### Contract Structs and Types

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

### Contract Methods

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
  * @param loanAmount Loan amount in ETH
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
```

