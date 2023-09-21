import { BigInt } from "@graphprotocol/graph-ts"
import {
  Kettle,
  LoanOfferTaken,
  NonceIncremented,
  OfferCancelled,
  OwnershipTransferred,
  Refinance,
  Repay,
  Seize
} from "../generated/Kettle/Kettle"
import { Lien, Nonce, Cancel } from "../generated/schema"

export function handleLoanOfferTaken(event: LoanOfferTaken): void {
  let id = ["lien", event.params.lienId.toString()].join("/");
  let lien = Lien.load(id);

  // if lien does not exists, create new lien
  if (!lien) lien = new Lien(id);

  // populate lien fields
  lien.lienId = event.params.lienId;
  lien.offerHash = event.params.offerHash;
  lien.lender = event.params.lender;
  lien.borrower = event.params.borrower;
  lien.collateralType = BigInt.fromU64(event.params.collateralType);
  lien.collateralAddress = event.params.collection;
  lien.collateralId = event.params.tokenId;
  lien.collateralAmount = event.params.amount;
  lien.currency = event.params.currency;
  lien.loanAmount = event.params.borrowAmount;
  lien.rate = event.params.rate;
  lien.duration = event.params.duration;
  lien.startTime = event.params.startTime;
  lien.endTime = event.params.startTime.plus(event.params.duration);
  lien.isActive = true;
  lien.isRepaid = false;
  lien.isDefaulted = false;
  
  lien.save();
  return;
}

export function handleRefinance(event: Refinance): void {
  return;
}

export function handleRepay(event: Repay): void {
  let id = ["lien", event.params.lienId.toString()].join("/");
  let lien = Lien.load(id) as Lien;

  lien.isActive = false;
  lien.isRepaid = true;
  
  lien.save();
  return;
}

export function handleSeize(event: Seize): void {
  let id = ["lien", event.params.lienId.toString()].join("/");
  let lien = Lien.load(id) as Lien;

  lien.isActive = false;
  lien.isDefaulted = true;
  
  lien.save();
  return;
}

export function handleNonceIncremented(event: NonceIncremented): void {
  let userNonceId = ["nonce", event.params.user.toHexString()].join("/");
  let nonce = Nonce.load(userNonceId);
  if (!nonce) {
    nonce = new Nonce(userNonceId);
    nonce.user = event.params.user;
    nonce.nonce = event.params.newNonce;
  } else {
    nonce.nonce = event.params.newNonce;
  }

  nonce.save();
  return;
}

export function handleOfferCancelled(event: OfferCancelled): void {
  let cancelId = ["cancel", event.params.user.toHexString(), event.params.salt.toString()].join("/");
  const cancel = new Cancel(cancelId);
  cancel.user = event.params.user;
  cancel.salt = event.params.salt;
  cancel.save();
}
