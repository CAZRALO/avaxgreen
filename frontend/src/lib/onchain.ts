import {formatUnits, parseAbiItem, type Address, type Hex} from 'viem';
import {
  DEPLOY_BLOCK,
  IS_DEPLOYED,
  REGISTRY_ABI,
  REGISTRY_ADDRESS,
  TOKEN_ABI,
  TOKEN_ADDRESS,
  publicClient,
} from './contracts';

export interface DashboardStats {
  totalMintedKg: number;
  totalRetiredKg: number;
  totalCertificates: number;
  treasuryStockKg: number;
  userBalanceKg: number;
  userBalanceWei: bigint;
  userAvax: number;
  userAllowanceWei: bigint;
}

export interface OnChainActivityItem {
  id: string;
  type: 'Minted' | 'Purchased' | 'Retired';
  actor: Address;
  amountKg: number;
  detail: string;
  certificateId?: number;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp: number;
}

export interface OnChainAttribute {
  trait_type: string;
  value: string | number;
}

export interface OnChainCertificate {
  id: number;
  company: string;
  reason: string;
  amountKg: number;
  amountWei: string;
  retiredAt: number;
  imageDataUri: string;
  svgMarkup: string;
  attributes: OnChainAttribute[];
  rawJson: string;
  rawTokenUri: string;
  txHash?: Hex;
}

const CREDITS_MINTED_EVENT = parseAbiItem(
  'event CreditsMinted(address indexed producer, uint256 amount, bytes32 indexed proofHash)'
);
const CREDITS_PURCHASED_EVENT = parseAbiItem(
  'event CreditsPurchased(address indexed buyer, uint256 amount, uint256 paid)'
);
const CREDITS_RETIRED_EVENT = parseAbiItem(
  'event CreditsRetired(address indexed company, uint256 amount, uint256 indexed certificateId)'
);

export function decodeBase64Utf8(b64: string): string {
  const clean = b64.trim();
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function weiToNumber(wei: bigint): number {
  return Number(formatUnits(wei, 18));
}

export async function fetchDashboardStats(wallet?: Address | null): Promise<DashboardStats> {
  if (!IS_DEPLOYED || !REGISTRY_ADDRESS || !TOKEN_ADDRESS) {
    return {
      totalMintedKg: 0,
      totalRetiredKg: 0,
      totalCertificates: 0,
      treasuryStockKg: 0,
      userBalanceKg: 0,
      userBalanceWei: 0n,
      userAvax: 0,
      userAllowanceWei: 0n,
    };
  }

  const baseCalls = [
    publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'totalMintedCO2',
    }),
    publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'totalRetiredCO2',
    }),
    publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'totalCertificates',
    }),
    publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: TOKEN_ABI,
      functionName: 'balanceOf',
      args: [REGISTRY_ADDRESS],
    }),
  ] as const;

  const [mintedWei, retiredWei, totalCerts, treasuryWei] = (await Promise.all(baseCalls)) as [
    bigint,
    bigint,
    bigint,
    bigint,
  ];

  let userBalanceWei = 0n;
  let userAvaxWei = 0n;
  let userAllowanceWei = 0n;

  if (wallet) {
    const [bal, avax, allowance] = (await Promise.all([
      publicClient.readContract({
        address: TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: 'balanceOf',
        args: [wallet],
      }),
      publicClient.getBalance({address: wallet}),
      publicClient.readContract({
        address: TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: 'allowance',
        args: [wallet, REGISTRY_ADDRESS],
      }),
    ])) as [bigint, bigint, bigint];
    userBalanceWei = bal;
    userAvaxWei = avax;
    userAllowanceWei = allowance;
  }

  return {
    totalMintedKg: weiToNumber(mintedWei),
    totalRetiredKg: weiToNumber(retiredWei),
    totalCertificates: Number(totalCerts),
    treasuryStockKg: weiToNumber(treasuryWei),
    userBalanceKg: weiToNumber(userBalanceWei),
    userBalanceWei,
    userAvax: weiToNumber(userAvaxWei),
    userAllowanceWei,
  };
}

export async function fetchOnChainActivity(): Promise<OnChainActivityItem[]> {
  if (!IS_DEPLOYED || !REGISTRY_ADDRESS) return [];
  const registryAddress = REGISTRY_ADDRESS;

  const latestBlock = await publicClient.getBlockNumber();
  const minFloor = DEPLOY_BLOCK > 0n ? DEPLOY_BLOCK : latestBlock > 10000n ? latestBlock - 10000n : 0n;
  const CHUNK_SIZE = 2000n;
  const MAX_CHUNKS = 5;

  const ranges: Array<{fromBlock: bigint; toBlock: bigint}> = [];
  let cursor = latestBlock;
  for (let i = 0; i < MAX_CHUNKS && cursor >= minFloor; i++) {
    const from = cursor >= CHUNK_SIZE - 1n ? cursor - (CHUNK_SIZE - 1n) : 0n;
    const clampedFrom = from < minFloor ? minFloor : from;
    ranges.push({fromBlock: clampedFrom, toBlock: cursor});
    if (clampedFrom === 0n || clampedFrom <= minFloor) break;
    cursor = clampedFrom - 1n;
  }

  const chunkLogs = await Promise.all(
    ranges.map(async ({fromBlock, toBlock}) => {
      const [minted, purchased, retired] = await Promise.all([
        publicClient.getLogs({
          address: registryAddress,
          event: CREDITS_MINTED_EVENT,
          fromBlock,
          toBlock,
        }),
        publicClient.getLogs({
          address: registryAddress,
          event: CREDITS_PURCHASED_EVENT,
          fromBlock,
          toBlock,
        }),
        publicClient.getLogs({
          address: registryAddress,
          event: CREDITS_RETIRED_EVENT,
          fromBlock,
          toBlock,
        }),
      ]);
      return {minted, purchased, retired};
    })
  );

  const uniqueBlocks = new Set<bigint>();
  for (const chunk of chunkLogs) {
    for (const l of [...chunk.minted, ...chunk.purchased, ...chunk.retired]) {
      if (l.blockNumber !== null) uniqueBlocks.add(l.blockNumber);
    }
  }

  const blockTimestamps = new Map<bigint, number>();
  await Promise.all(
    Array.from(uniqueBlocks).map(async (bn) => {
      try {
        const blk = await publicClient.getBlock({blockNumber: bn});
        blockTimestamps.set(bn, Number(blk.timestamp));
      } catch {
        blockTimestamps.set(bn, Math.floor(Date.now() / 1000));
      }
    })
  );

  const items: OnChainActivityItem[] = [];

  for (const chunk of chunkLogs) {
    for (const log of chunk.minted) {
      const producer = log.args.producer!;
      const amount = log.args.amount!;
      const proofHash = log.args.proofHash!;
      const isTreasury = producer.toLowerCase() === REGISTRY_ADDRESS.toLowerCase();
      items.push({
        id: `${log.transactionHash}-${log.logIndex}`,
        type: 'Minted',
        actor: producer,
        amountKg: weiToNumber(amount),
        detail: isTreasury ? 'Treasury Inventory Seed' : `Proof ${proofHash.slice(0, 10)}…`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber ?? 0n,
        logIndex: log.logIndex ?? 0,
        timestamp: blockTimestamps.get(log.blockNumber ?? 0n) ?? 0,
      });
    }
    for (const log of chunk.purchased) {
      const buyer = log.args.buyer!;
      const amount = log.args.amount!;
      const paid = log.args.paid!;
      items.push({
        id: `${log.transactionHash}-${log.logIndex}`,
        type: 'Purchased',
        actor: buyer,
        amountKg: weiToNumber(amount),
        detail: `Thanh toán ${weiToNumber(paid).toFixed(4)} AVAX`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber ?? 0n,
        logIndex: log.logIndex ?? 0,
        timestamp: blockTimestamps.get(log.blockNumber ?? 0n) ?? 0,
      });
    }
    for (const log of chunk.retired) {
      const company = log.args.company!;
      const amount = log.args.amount!;
      const certId = Number(log.args.certificateId!);
      items.push({
        id: `${log.transactionHash}-${log.logIndex}`,
        type: 'Retired',
        actor: company,
        amountKg: weiToNumber(amount),
        detail: `ESG Certificate #${certId}`,
        certificateId: certId,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber ?? 0n,
        logIndex: log.logIndex ?? 0,
        timestamp: blockTimestamps.get(log.blockNumber ?? 0n) ?? 0,
      });
    }
  }

  items.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
    return b.logIndex - a.logIndex;
  });

  return items;
}

export async function fetchUserCertificates(
  wallet: Address,
  activity: OnChainActivityItem[] = []
): Promise<OnChainCertificate[]> {
  if (!IS_DEPLOYED || !REGISTRY_ADDRESS) return [];
  const registryAddress = REGISTRY_ADDRESS;

  const tokenIds = (await publicClient.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'certificatesOf',
    args: [wallet],
  })) as bigint[];

  if (!tokenIds || tokenIds.length === 0) return [];

  const txByCertId = new Map<number, Hex>();
  for (const act of activity) {
    if (act.type === 'Retired' && act.certificateId !== undefined) {
      txByCertId.set(act.certificateId, act.txHash);
    }
  }

  const certs = await Promise.all(
    tokenIds.map(async (rawId) => {
      const id = Number(rawId);
      const rawTokenUri = (await publicClient.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'tokenURI',
        args: [rawId],
      })) as string;

      const jsonBase64 = rawTokenUri.split(',')[1] || '';
      const rawJson = decodeBase64Utf8(jsonBase64);
      const parsed = JSON.parse(rawJson) as {
        name?: string;
        description?: string;
        company?: string;
        amountWei?: string;
        retiredAt?: number;
        attributes?: OnChainAttribute[];
        image?: string;
      };

      const imageDataUri = parsed.image || '';
      const svgBase64 = imageDataUri.split(',')[1] || '';
      const svgMarkup = svgBase64 ? decodeBase64Utf8(svgBase64) : '';
      const amountWei = parsed.amountWei || '0';

      return {
        id,
        company: parsed.company || `Certificate #${id}`,
        reason: parsed.description || '',
        amountKg: weiToNumber(BigInt(amountWei)),
        amountWei,
        retiredAt: Number(parsed.retiredAt || 0),
        imageDataUri,
        svgMarkup,
        attributes: Array.isArray(parsed.attributes) ? parsed.attributes : [],
        rawJson,
        rawTokenUri,
        txHash: txByCertId.get(id),
      } satisfies OnChainCertificate;
    })
  );

  certs.sort((a, b) => b.id - a.id);
  return certs;
}
