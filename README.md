# Kettle

### Loan Offer

```js
interface LoanOffer {
  lender: Address;
  collection: Address;
  collateralType: CollateralType;
  collateralIdentifier: BigNumber;
  collateralAmount: BigNumber;
  currency: Address;
  totalAmount: BigNumber;
  minAmount: BigNumber;
  maxAmount: BigNumber;
  duration: BigNumber;
  rate: BigNumber;
  salt: BigNumber;
  expiration: BigNumber;
  fees: Fee[];
}

interface BorrowOffer {
  borrower: Address;
  collection: Address;
  collateralType: CollateralType;
  collateralIdentifier: BigNumber;
  collateralAmount: BigNumber;
  currency: Address;
  loanAmount: BigNumber;
  duration: BigNumber;
  rate: BigNumber;
  salt: BigNumber;
  expiration: BigNumber;
  fees: Fee[];
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
```
