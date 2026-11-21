import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  zeroAddress,
  type Abi,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import {avalancheFuji, hardhat} from 'viem/chains';
import tokenAbiJson from '../contracts/GreenCarbonToken.json';
import registryAbiJson from '../contracts/CarbonRegistry.json';
import contractAddresses from '../contracts/addresses.json';

export interface Eip1193Provider {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

const rawAddresses = contractAddresses as {
  chainId?: number;
  network?: string;
  token?: string;
  registry?: string;
  oracleSigner?: string;
  deployBlock?: number;
};

const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || rawAddresses.chainId || 43113);
export const CHAIN_ID = Number.isFinite(envChainId) && envChainId > 0 ? envChainId : 43113;
export const IS_LOCAL_CHAIN = CHAIN_ID === 31337;

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL?.trim() ||
  (IS_LOCAL_CHAIN ? 'http://127.0.0.1:8545' : 'https://api.avax-test.network/ext/bc/C/rpc');

export const ACTIVE_CHAIN: Chain = IS_LOCAL_CHAIN
  ? {
      ...hardhat,
      rpcUrls: {default: {http: [RPC_URL]}},
    }
  : {
      ...avalancheFuji,
      rpcUrls: {default: {http: [RPC_URL]}},
    };

export const NETWORK_LABEL = IS_LOCAL_CHAIN ? 'Local Hardhat' : 'Avalanche Fuji';
export const EXPLORER_BASE = IS_LOCAL_CHAIN ? '' : 'https://testnet.snowtrace.io';

export const TOKEN_ABI = tokenAbiJson as Abi;
export const REGISTRY_ABI = registryAbiJson as Abi;

const rawToken = (rawAddresses.token || '').trim();
const rawRegistry = (rawAddresses.registry || '').trim();
const rawOracle = (rawAddresses.oracleSigner || '').trim();

export const TOKEN_ADDRESS: Address | null =
  isAddress(rawToken) && rawToken !== zeroAddress ? (rawToken as Address) : null;
export const REGISTRY_ADDRESS: Address | null =
  isAddress(rawRegistry) && rawRegistry !== zeroAddress ? (rawRegistry as Address) : null;
export const ORACLE_SIGNER_ADDRESS: Address | null =
  isAddress(rawOracle) && rawOracle !== zeroAddress ? (rawOracle as Address) : null;
export const DEPLOY_BLOCK = BigInt(Math.max(0, Number(rawAddresses.deployBlock || 0)));
export const IS_DEPLOYED = Boolean(TOKEN_ADDRESS && REGISTRY_ADDRESS);

export const publicClient = createPublicClient({
  chain: ACTIVE_CHAIN,
  transport: http(RPC_URL),
});

export function getWalletClient(ethereum: Eip1193Provider, account?: Address) {
  return createWalletClient({
    account,
    chain: ACTIVE_CHAIN,
    transport: custom(ethereum),
  });
}

export async function ensureFujiNetwork(ethereum: Eip1193Provider): Promise<number> {
  const targetHex = `0x${CHAIN_ID.toString(16)}` as Hex;
  const currentHex = (await ethereum.request({method: 'eth_chainId'})) as string;
  if (parseInt(currentHex, 16) === CHAIN_ID) {
    return CHAIN_ID;
  }

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{chainId: targetHex}],
    });
    return CHAIN_ID;
  } catch (err: unknown) {
    const errObj = err as {code?: number; data?: {originalError?: {code?: number}}};
    const code = errObj?.code ?? errObj?.data?.originalError?.code;
    if (code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          IS_LOCAL_CHAIN
            ? {
                chainId: targetHex,
                chainName: 'Hardhat Localhost 8545',
                nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
                rpcUrls: [RPC_URL],
              }
            : {
                chainId: targetHex,
                chainName: 'Avalanche Fuji C-Chain',
                nativeCurrency: {name: 'Avalanche', symbol: 'AVAX', decimals: 18},
                rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
                blockExplorerUrls: ['https://testnet.snowtrace.io/'],
              },
        ],
      });
      return CHAIN_ID;
    }
    throw err;
  }
}

export function txUrl(hash?: string | null): string | null {
  if (!hash || !EXPLORER_BASE) return null;
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function addressUrl(addr?: string | null): string | null {
  if (!addr || !EXPLORER_BASE) return null;
  return `${EXPLORER_BASE}/address/${addr}`;
}

export function nftUrl(tokenId: number | string): string | null {
  if (!REGISTRY_ADDRESS || !EXPLORER_BASE) return null;
  return `${EXPLORER_BASE}/nft/${REGISTRY_ADDRESS}/${tokenId}`;
}
