import { newMockEvent } from "matchstick-as"
import { ethereum, Bytes, BigInt, Address } from "@graphprotocol/graph-ts"
import {
  LoanOfferTaken,
  NonceIncremented,
  OfferCancelled,
  OwnershipTransferred,
  Refinance,
  Repay,
  Seize
} from "../generated/Kettle/Kettle"

export function createLoanOfferTakenEvent(
  offerHash: Bytes,
  lienId: BigInt,
  lender: Address,
  borrower: Address,
  currency: Address,
  collateralType: i32,
  collection: Address,
  tokenId: BigInt,
  amount: BigInt,
  borrowAmount: BigInt,
  rate: BigInt,
  duration: BigInt,
  startTime: BigInt
): LoanOfferTaken {
  let loanOfferTakenEvent = changetype<LoanOfferTaken>(newMockEvent())

  loanOfferTakenEvent.parameters = new Array()

  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "offerHash",
      ethereum.Value.fromFixedBytes(offerHash)
    )
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("lender", ethereum.Value.fromAddress(lender))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("borrower", ethereum.Value.fromAddress(borrower))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("currency", ethereum.Value.fromAddress(currency))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "collateralType",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(collateralType))
    )
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "collection",
      ethereum.Value.fromAddress(collection)
    )
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "borrowAmount",
      ethereum.Value.fromUnsignedBigInt(borrowAmount)
    )
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("rate", ethereum.Value.fromUnsignedBigInt(rate))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "duration",
      ethereum.Value.fromUnsignedBigInt(duration)
    )
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "startTime",
      ethereum.Value.fromUnsignedBigInt(startTime)
    )
  )

  return loanOfferTakenEvent
}

export function createNonceIncrementedEvent(
  user: Address,
  newNonce: BigInt
): NonceIncremented {
  let nonceIncrementedEvent = changetype<NonceIncremented>(newMockEvent())

  nonceIncrementedEvent.parameters = new Array()

  nonceIncrementedEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  nonceIncrementedEvent.parameters.push(
    new ethereum.EventParam(
      "newNonce",
      ethereum.Value.fromUnsignedBigInt(newNonce)
    )
  )

  return nonceIncrementedEvent
}

export function createOfferCancelledEvent(
  user: Address,
  salt: BigInt
): OfferCancelled {
  let offerCancelledEvent = changetype<OfferCancelled>(newMockEvent())

  offerCancelledEvent.parameters = new Array()

  offerCancelledEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  )
  offerCancelledEvent.parameters.push(
    new ethereum.EventParam("salt", ethereum.Value.fromUnsignedBigInt(salt))
  )

  return offerCancelledEvent
}

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address
): OwnershipTransferred {
  let ownershipTransferredEvent = changetype<OwnershipTransferred>(
    newMockEvent()
  )

  ownershipTransferredEvent.parameters = new Array()

  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam(
      "previousOwner",
      ethereum.Value.fromAddress(previousOwner)
    )
  )
  ownershipTransferredEvent.parameters.push(
    new ethereum.EventParam("newOwner", ethereum.Value.fromAddress(newOwner))
  )

  return ownershipTransferredEvent
}

export function createRefinanceEvent(
  lienId: BigInt,
  collection: Address,
  currency: Address,
  amount: BigInt,
  oldLender: Address,
  newLender: Address,
  oldBorrowAmount: BigInt,
  newBorrowAmount: BigInt,
  oldRate: BigInt,
  newRate: BigInt
): Refinance {
  let refinanceEvent = changetype<Refinance>(newMockEvent())

  refinanceEvent.parameters = new Array()

  refinanceEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam(
      "collection",
      ethereum.Value.fromAddress(collection)
    )
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("currency", ethereum.Value.fromAddress(currency))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("oldLender", ethereum.Value.fromAddress(oldLender))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("newLender", ethereum.Value.fromAddress(newLender))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam(
      "oldBorrowAmount",
      ethereum.Value.fromUnsignedBigInt(oldBorrowAmount)
    )
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam(
      "newBorrowAmount",
      ethereum.Value.fromUnsignedBigInt(newBorrowAmount)
    )
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam(
      "oldRate",
      ethereum.Value.fromUnsignedBigInt(oldRate)
    )
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam(
      "newRate",
      ethereum.Value.fromUnsignedBigInt(newRate)
    )
  )

  return refinanceEvent
}

export function createRepayEvent(
  lienId: BigInt,
  collection: Address,
  amount: BigInt
): Repay {
  let repayEvent = changetype<Repay>(newMockEvent())

  repayEvent.parameters = new Array()

  repayEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  repayEvent.parameters.push(
    new ethereum.EventParam(
      "collection",
      ethereum.Value.fromAddress(collection)
    )
  )
  repayEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return repayEvent
}

export function createSeizeEvent(lienId: BigInt, collection: Address): Seize {
  let seizeEvent = changetype<Seize>(newMockEvent())

  seizeEvent.parameters = new Array()

  seizeEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  seizeEvent.parameters.push(
    new ethereum.EventParam(
      "collection",
      ethereum.Value.fromAddress(collection)
    )
  )

  return seizeEvent
}
