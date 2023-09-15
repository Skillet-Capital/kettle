# Kettle

### Loan Offer

```solidity
/**
 * Loan Offer
 * created and signed by lenders
 * specifies a partially fulfillable offer to start a lien
 * amount taken during loan must be less than `maxAmount` and greater than `minAmount`
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

struct BorrowOffer {
  address borrower;               // address of borrower
  address collection;             // address of collection
  uint8 collateralType;           // type of collateral
  uint256 collateralIdentifier;   // token identifier
  uint256 collateralAmount;       // amount of collateral (default 1 for ERC721)
  address currency;               // address of currency
  uint256 loanAmount;             // desired loan amount by borrower
  uint256 duration;               // designed
  uint256 rate;
  uint256 salt;
  uint256 expiration;
  Fee[] fees;
}

interface Fee {
  rate: BigNumber;
  recipient: Address;
}

type CollateralType {
  ERC721: 0
  ERC1155: 1
  ERC721_WITH_CRITERIA: 2
  ERC1155_WITH_CRITERIA: 3
}

interface OfferAuth {
  
}
```
