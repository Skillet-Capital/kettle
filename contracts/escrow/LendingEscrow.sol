// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeTransfer } from "../SafeTransfer.sol";

import { Signatures } from "./Signatures.sol";
import { ILendingEscrow } from "../interfaces/ILendingEscrow.sol";

import { SafeTransfer } from "../SafeTransfer.sol";

import { EscrowFunds, UpdateEscrowAuth } from "../lib/Structs.sol";

contract LendingEscrow is ILendingEscrow, SafeTransfer, Signatures {
    address public _authSigner;
    address public _rebateFunder;
    address public _rebateCurrency;

    uint256 private immutable ADMIN_ROLE = 0;
    uint256 private immutable ESCROW_ROUTER_ROLE = 1;
    uint256 private immutable ESCROW_WITHDRAWER_ROLE = 2;

    mapping(uint256 => mapping(address => uint256)) public _roles;
    mapping(bytes32 => EscrowFunds) public escrowFunds;

    error EscrowNotFound();
    error EscrowAlreadyExists();
    error EscrowNotExpired();
    error EscrowExpired();
    error InsufficientFunds();
    error Unauthorized();

    constructor(address signer, address rebateFunder) {
        _authSigner = signer;
        _rebateFunder = rebateFunder;

        _roles[ADMIN_ROLE][msg.sender] = 1;
        _roles[ESCROW_WITHDRAWER_ROLE][msg.sender] = 1;
    }

    function updateSigner(address signer) public requiresRole(ADMIN_ROLE) {
        _authSigner = signer;
    }

    function updateRebateFunder(address rebateFunder) public requiresRole(ADMIN_ROLE) {
        _rebateFunder = rebateFunder;
    }

    function updateRebateCurrency(address rebateCurrency) public requiresRole(ADMIN_ROLE) {
        _rebateCurrency = rebateCurrency;
    }

    function setRole(uint256 role, address account, uint256 value) public requiresRole(ADMIN_ROLE) {
        _roles[role][account] = value;
    }

    /// @notice Deposit funds into escrow
    /// @param offerHash Hash of offer for which funds are usable
    /// @param lender Address of lender
    /// @param currency Address of currency
    /// @param amount Amount of currency
    /// @param duration Duration of escrow
    function depositEscrow(
        bytes32 offerHash,
        address lender,
        address currency,
        uint256 amount,
        uint256 duration
    ) public 
    {
        /// check if escrow already exists
        if (escrowFunds[offerHash].lender != address(0)) {
            revert EscrowAlreadyExists();
        }

        /// store escrow
        escrowFunds[offerHash] = EscrowFunds({
            lender: lender,
            currency: currency,
            amount: amount,
            authorizedAmount: amount,
            expiration: block.timestamp + duration
        });

        /// transfer funds to escrow
        SafeTransfer.transferERC20(
            currency,
            msg.sender,
            address(this),
            amount
        );

        emit EscrowCreated(offerHash);
    }

    /// @notice Update authorized amount for escrow
    /// needs signature verification from kettle signer
    /// @param offerHash Hash of offer for which funds are usable
    /// @param amount Amount of funds to authorize
    /// @param auth Authorization struct
    /// @param signature Signature of auth struct
    function updateAuthorizedAmount(
        bytes32 offerHash,
        uint256 amount,
        UpdateEscrowAuth calldata auth,
        bytes calldata signature
    ) public 
    {
        EscrowFunds memory escrow = escrowFunds[offerHash];
        if (escrow.lender == address(0)) {
            revert EscrowNotFound();
        }

        if (msg.sender != escrow.lender) {
            revert Unauthorized();
        }

        // check auth is for lender
        if (auth.lender != escrow.lender) {
            revert UnauthorizedUpdate();
        }

        // check authorization to amount for update escrow
        if (auth.amount != amount) {
            revert UnauthorizedUpdate();
        }

        // check that authorization is not expired
        if (auth.expiration < block.timestamp) {
            revert AuthorizationExpired();
        }

        // check that authorization is signed by auth signer
        bytes32 authHash = _hashUpdateEscrowAuth(auth);
        _verifyAuthorization(authHash, _authSigner, signature);

        if (escrow.expiration < block.timestamp) {
            revert EscrowExpired();
        }

        if (amount > escrow.amount) {
            revert InsufficientFunds();
        }

        escrowFunds[offerHash].authorizedAmount = amount;

        emit EscrowUpdated(offerHash, amount);
    }

    /// @notice Use escrow for loan initiation
    /// @param offerHash Hash of offer for which funds are usable
    /// @param amount Amount of funds to use
    function useEscrow(
        bytes32 offerHash, 
        uint256 amount
    ) public 
      requiresRole(ESCROW_ROUTER_ROLE) 
    {
        EscrowFunds memory escrow = escrowFunds[offerHash];
        if (escrow.lender == address(0)) {
            revert EscrowNotFound();
        }

        if (escrow.expiration < block.timestamp) {
            revert EscrowExpired();
        }

        if (amount > escrow.authorizedAmount) {
            revert InsufficientFunds();
        }

        // send funds to caller from escrow
        IERC20(escrow.currency).transfer(
            msg.sender,
            amount
        );

        // return rest of funds to lender
        if (amount < escrow.amount) {
            IERC20(escrow.currency).transfer(
                msg.sender,
                escrow.amount - amount
            );
        }

        delete escrowFunds[offerHash];

        emit EscrowUsed(offerHash, amount);
    }

    /// @notice Return escrow to lender
    /// callable only by escrow withdrawer role
    /// @param offerHash identifier of escrow to return
    function returnEscrow(bytes32 offerHash, uint256 rebate) public requiresRole(ESCROW_WITHDRAWER_ROLE) {
        EscrowFunds memory escrow = escrowFunds[offerHash];

        // send funds to lender from escrow
        IERC20(escrow.currency).transfer(
            escrow.lender,
            escrow.amount
        );

        // if rebate, send rebate amount from rebateFunder
        if (rebate > 0) {
            SafeTransfer.transferERC20(
                _rebateCurrency, 
                _rebateFunder, 
                escrow.lender, 
                rebate
            );
        }

        delete escrowFunds[offerHash];

        emit EscrowDestroyed(offerHash);
    }

    /// @notice Withdraw escrow to lender
    /// callable only by lender
    /// @param offerHash identifier of escrow to withdraw
    function withdrawEscrow(bytes32 offerHash) public {
        EscrowFunds memory escrow = escrowFunds[offerHash];

        if (msg.sender != escrow.lender) {
            revert Unauthorized();
        }

        if (escrow.expiration > block.timestamp) {
            revert EscrowNotExpired();
        }

        // send funds to lender from escrow
        IERC20(escrow.currency).transfer(
            escrow.lender,
            escrow.amount
        );
        
        delete escrowFunds[offerHash];

        emit EscrowDestroyed(offerHash);
    }

    modifier requiresRole(uint256 role) {
        require(_roles[role][msg.sender] == 1, "AccessControl");
        _;
    }
}
