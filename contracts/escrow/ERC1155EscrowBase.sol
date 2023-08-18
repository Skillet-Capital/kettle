// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract ERC1155EscrowBase is Ownable, ERC1155Holder {
    constructor(address conduit, address collection) Ownable() ERC1155Holder() {
        IERC1155(collection).setApprovalForAll(conduit, true);
    }
}
