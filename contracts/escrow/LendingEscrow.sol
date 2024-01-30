// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { SafeTransfer } from "../SafeTransfer.sol";

contract LendingEscrow is SafeTransfer {

    uint256 private immutable ADMIN_ROLE = 0;
    uint256 private immutable ESCROW_ROUTER_ROLE = 1;
    uint256 private immutable ESCROW_WITHDRAWER_ROLE = 2;

    mapping(uint256 => mapping(address => uint256)) public _roles;
    mapping(bytes32 => EscrowFunds) public escrowFunds;

    error EscrowAlreadyExists();
    error EscrowNotExpired();
    error EscrowExpired();
    error Unauthorized();

    struct EscrowFunds {
        address lender;
        address currency;
        uint256 amount;
        uint256 expiration;
    }

    struct EscrowReturned {
        bytes32 offerHash;
    }

    constructor() {
        _roles[ADMIN_ROLE][msg.sender] = 1;
    }

    function setRole(uint256 role, address account, uint256 value) public requiresRole(ADMIN_ROLE) {
        _roles[role][account] = value;
    }

    function depositEscrow(
        bytes32 offerHash,
        address lender,
        address currency,
        uint256 amount,
        uint256 duration
    ) public {

        // if (escrowFunds[offerHash]) {
        //     revert EscrowAlreadyExists();
        // }

        escrowFunds[offerHash] = EscrowFunds({
            lender: lender,
            currency: currency,
            amount: amount,
            expiration: block.timestamp + duration
        });

        SafeTransfer.transferERC20(
            currency,
            msg.sender,
            address(this),
            amount
        );
    }

    function useEscrow(bytes32 offerHash) public requiresRole(ESCROW_ROUTER_ROLE) {

        EscrowFunds memory escrow = escrowFunds[offerHash];
        if (escrow.expiration < block.timestamp) {
            revert EscrowExpired();
        }

        // send funds to borrower from escrow
        SafeTransfer.transferERC20(
            escrow.currency,
            address(this),
            msg.sender,
            escrow.amount
        );

        delete escrowFunds[offerHash];
    }

    function returnEscrow(bytes32 offerHash) public requiresRole(ESCROW_WITHDRAWER_ROLE) {
        EscrowFunds memory escrow = escrowFunds[offerHash];

        // send funds to lender from escrow
        SafeTransfer.transferERC20(
            escrow.currency,
            address(this),
            escrow.lender,
            escrow.amount
        );

        delete escrowFunds[offerHash];
    }

    function withdrawEscrow(bytes32 offerHash) public {
        EscrowFunds memory escrow = escrowFunds[offerHash];

        if (msg.sender != escrow.lender) {
            revert Unauthorized();
        }

        if (escrow.expiration > block.timestamp) {
            revert EscrowNotExpired();
        }

        // send funds to lender from escrow
        SafeTransfer.transferERC20(
            escrow.currency,
            address(this),
            escrow.lender,
            escrow.amount
        );
        
        delete escrowFunds[offerHash];
    }

    modifier requiresRole(uint256 role) {
        require(_roles[role][msg.sender] == 1, "AccessControl");
        _;
    }
}
