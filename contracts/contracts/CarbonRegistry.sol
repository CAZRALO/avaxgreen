// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721URIStorage} from '@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol';
import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {MessageHashUtils} from '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import {Base64} from '@openzeppelin/contracts/utils/Base64.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {GreenCarbonToken} from './GreenCarbonToken.sol';
contract CarbonRegistry is ERC721URIStorage, Ownable, ReentrancyGuard {
    GreenCarbonToken public immutable token;
    address public oracleSigner;
    uint256 public totalMintedCO2;
    uint256 public totalRetiredCO2;
    uint256 public totalCertificates;
    mapping(bytes32 => bool) public usedProofHashes;
    event CreditsMinted(address indexed producer,uint256 amount,bytes32 indexed proofHash);
    event CreditsPurchased(address indexed buyer,uint256 amount,uint256 paid);
    event CreditsRetired(address indexed company,uint256 amount,uint256 indexed certificateId);
    constructor(address carbonToken,address signer,address admin) ERC721('AvaxGreen ESG Retirement','GREEN-ESG') Ownable(admin) {
        require(carbonToken != address(0) && signer != address(0), 'Zero address');
        token = GreenCarbonToken(carbonToken); oracleSigner = signer;
    }
    function setOracleSigner(address signer) external onlyOwner { require(signer != address(0),'Zero signer'); oracleSigner=signer; }
    function verificationDigest(address producer,uint256 amount,bytes32 proofHash) public view returns(bytes32) {
        return keccak256(abi.encode(block.chainid,address(this),producer,amount,proofHash));
    }
    function mintVerifiedCredits(uint256 amount,bytes32 proofHash,bytes calldata signature) external nonReentrant {
        require(amount>0,'Zero amount'); require(!usedProofHashes[proofHash],'Proof already used');
        bytes32 digest=MessageHashUtils.toEthSignedMessageHash(verificationDigest(msg.sender,amount,proofHash));
        require(ECDSA.recover(digest,signature)==oracleSigner,'Invalid oracle');
        usedProofHashes[proofHash]=true; totalMintedCO2+=amount;
        token.mint(msg.sender,amount); emit CreditsMinted(msg.sender,amount,proofHash);
    }
    function fundTreasury(uint256 amount,bytes32 proofHash,bytes calldata signature) external nonReentrant {
        require(amount>0 && !usedProofHashes[proofHash],'Invalid proof');
        bytes32 digest=MessageHashUtils.toEthSignedMessageHash(verificationDigest(address(this),amount,proofHash));
        require(ECDSA.recover(digest,signature)==oracleSigner,'Invalid oracle');
        usedProofHashes[proofHash]=true; totalMintedCO2+=amount;token.mint(address(this),amount);
        emit CreditsMinted(address(this),amount,proofHash);
    }
    function buyCredits() external payable nonReentrant {
        require(msg.value>0 && msg.value%1e14==0,'Use multiples of 0.0001 AVAX');
        uint256 amount=msg.value*10000;
        require(token.balanceOf(address(this))>=amount,'Insufficient verified inventory');
        require(token.transfer(msg.sender,amount),'Transfer failed');emit CreditsPurchased(msg.sender,amount,msg.value);
    }
    function retireCredits(uint256 amount,string calldata companyName,string calldata reason) external nonReentrant {
        require(amount>0,'Zero amount');_validateText(companyName,80);_validateText(reason,200);
        uint256 id=++totalCertificates;totalRetiredCO2+=amount;
        token.burnFrom(msg.sender,amount);
        _safeMint(msg.sender,id);_setTokenURI(id,_metadata(id,amount,companyName,reason));
        emit CreditsRetired(msg.sender,amount,id);
    }
    function withdraw(address payable recipient) external onlyOwner nonReentrant {
        require(recipient!=address(0),'Zero recipient');(bool ok,)=recipient.call{value:address(this).balance}('');require(ok,'Withdrawal failed');
    }
    function _validateText(string calldata text,uint256 maxLength) private pure {
        bytes memory b=bytes(text);require(b.length>0 && b.length<=maxLength,'Text length');
        for(uint256 i;i<b.length;i++){bytes1 c=b[i];require(uint8(c)>=32 && c!='"' && c!='\\' && c!='<' && c!='>' && c!='&','Unsafe metadata character');}
    }
    function _metadata(uint256 id,uint256 amount,string memory company,string memory reason) private view returns(string memory) {
        string memory kg=string.concat(Strings.toString(amount/1e18),'.',_fraction(amount));
        string memory svg=string.concat('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#13251a"/><rect x="20" y="20" width="760" height="460" rx="12" fill="none" stroke="#b8ec88"/><g fill="#b8ec88" font-family="sans-serif" text-anchor="middle"><text x="400" y="90" font-size="22">AVAXGREEN | PROOF OF RETIREMENT</text><text x="400" y="180" font-size="28">',company,'</text><text x="400" y="260" font-size="38">',kg,' kg CO2</text><text x="400" y="330" font-size="17">Permanently retired on Avalanche</text><text x="400" y="410" font-size="15">Certificate #',Strings.toString(id),' | Timestamp ',Strings.toString(block.timestamp),'</text></g></svg>');
        string memory json=string.concat('{"name":"AvaxGreen Retirement #',Strings.toString(id),'","description":"',reason,'","company":"',company,'","amountWei":"',Strings.toString(amount),'","retiredAt":',Strings.toString(block.timestamp),',"image":"data:image/svg+xml;base64,',Base64.encode(bytes(svg)),'"}');
        return string.concat('data:application/json;base64,',Base64.encode(bytes(json)));
    }
    function _fraction(uint256 amount) private pure returns(string memory){
        string memory padded=Strings.toString(1e18+amount%1e18);bytes memory b=bytes(padded);bytes memory f=new bytes(18);for(uint256 i;i<18;i++)f[i]=b[i+1];return string(f);
    }
}
