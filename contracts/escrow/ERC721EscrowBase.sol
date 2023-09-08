// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ERC721Holder } from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract ERC721EscrowBase is Ownable, ERC721Holder {
    address public immutable conduit;
    address public immutable collection;
    
    constructor(address _conduit, address _collection) Ownable() ERC721Holder() {
        IERC721(_collection).setApprovalForAll(_conduit, true);
        conduit = _conduit;
        collection = _collection;
    }
}
