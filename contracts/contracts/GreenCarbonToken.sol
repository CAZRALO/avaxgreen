// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {ERC20Burnable} from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
contract GreenCarbonToken is ERC20, ERC20Burnable, Ownable {
    address public registry;
    constructor(address admin) ERC20('AvaxGreen Carbon Credit', 'GCARB') Ownable(admin) {}
    function setRegistry(address target) external onlyOwner {
        require(registry == address(0) && target != address(0), 'Registry already set or zero');
        registry = target;
    }
    function mint(address recipient, uint256 amount) external {
        require(msg.sender == registry, 'Only registry');
        _mint(recipient, amount);
    }
}
