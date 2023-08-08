// SPDX-License-Identifier: Skillet
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ERC721EscrowBase is Ownable, ERC721Holder {

  constructor(address conduit, address collection) Ownable() ERC721Holder() { 
    IERC721(collection).setApprovalForAll(conduit, true);
  }

}
