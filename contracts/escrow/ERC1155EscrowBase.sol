// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { ERC1155Holder } from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract ERC1155EscrowBase is Ownable, ERC1155Holder {
    address public immutable conduit;
    address public immutable collection;

    constructor(address _conduit, address _collection) Ownable() ERC1155Holder() {
        IERC1155(_collection).setApprovalForAll(_conduit, true);
        conduit = _conduit;
        collection = _collection;
    }
}
