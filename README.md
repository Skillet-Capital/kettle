# Kettle

### Loan Offer

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
  rate: BigNumber;
  recipient: Address;
}

interface OfferAuth {
  
}

/**
 * Collateral Type
 * enumerated collateral types
 * ERC721 - ERC721 specified by specific token id
 * ERC1155 - ERC1155 specified by specific token id
 * ERC721_WITH_CRITERIA - ERC721 specified by range of token ids (i.e. collection or trait offer)
 * ERC1155_WITH_CRITERIA - ERC1155 specified by range of token ids (i.e. collection or trait offer)
 */
enum CollateralType {
  ERC721: 0
  ERC1155: 1
  ERC721_WITH_CRITERIA: 2
  ERC1155_WITH_CRITERIA: 3
}
```
