'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Award,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  Globe2,
  Info,
  LayoutDashboard,
  Leaf,
  LoaderCircle,
  MapPin,
  Menu,
  Mountain,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Sun,
  TreePine,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import {parseEther, type Address, type Hex} from 'viem';
import {
  CHAIN_ID,
  EXPLORER_BASE,
  IS_DEPLOYED,
  NETWORK_LABEL,
  ORACLE_SIGNER_ADDRESS,
  REGISTRY_ABI,
  REGISTRY_ADDRESS,
  TOKEN_ABI,
  TOKEN_ADDRESS,
  addressUrl,
  ensureFujiNetwork,
  getWalletClient,
  nftUrl,
  publicClient,
  txUrl,
  type Eip1193Provider,
} from '../lib/contracts';
import {
  fetchDashboardStats,
  fetchOnChainActivity,
  fetchUserCertificates,
  type DashboardStats,
  type OnChainActivityItem,
  type OnChainCertificate,
} from '../lib/onchain';
import {
  formatAvaxError,
  sanitizeOnChainText,
  utf8ByteLength,
  validateOnChainText,
} from '../lib/sanitize';

type Tab = 'overview' | 'verify' | 'market' | 'certificates';

interface VerifyApiResponse {
  mode: 'oracle-signed' | 'estimate-only';
  aiMode: 'gemini' | 'sample-deterministic' | 'deterministic-demo';
  solarMode: 'nasa-climatology' | 'sample';
  detected: boolean;
  evidenceType: 'rooftop-pv' | 'electricity-bill' | 'unknown';
  confidence: number | null;
  fraudScore: number | null;
  trustScore: number | null;
  fraudRisk: 'low' | 'medium' | 'high' | 'unknown';
  fraudFlags: string[];
  summary: string;
  panelCount: number | null;
  capacityKw: number;
  inputCapacityKw: number;
  irradiance: number;
  kwh: number;
  co2Kg: number;
  amountWei: string;
  imageHash: string;
  proofHash: Hex;
  signature: Hex | null;
  oracleSigner: Address | null;
  alreadyUsedOnChain: boolean;
  chainId: number;
  registryAddress: Address | null;
  warnings: string[];
  disclaimer: string;
}

interface SystemStatus {
  hasGeminiKey: boolean;
  hasOracleKey: boolean;
  oracleAddress: Address | null;
  chainId: number;
  registryAddress: Address | null;
  tokenAddress: Address | null;
  isDeployed: boolean;
}

const EMPTY_STATS: DashboardStats = {
  totalMintedKg: 0,
  totalRetiredKg: 0,
  totalCertificates: 0,
  treasuryStockKg: 0,
  userBalanceKg: 0,
  userBalanceWei: 0n,
  userAvax: 0,
  userAllowanceWei: 0n,
};

const fmt = (n: number, maxDecimals = 2) =>
  n.toLocaleString('en-US', {maximumFractionDigits: maxDecimals});

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

function formatRelativeTime(unixSec: number): string {
  if (!unixSec) return 'Trên chuỗi';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return 'Vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return new Date(unixSec * 1000).toLocaleDateString('vi-VN');
}

function getInjectedEthereum(): Eip1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as {ethereum?: Eip1193Provider}).ethereum;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('overview');
  const [mobile, setMobile] = useState(false);

  // Wallet & network state
  const [wallet, setWallet] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState('');

  // On-chain state
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [activity, setActivity] = useState<OnChainActivityItem[]>([]);
  const [certs, setCerts] = useState<OnChainCertificate[]>([]);
  const [syncingChain, setSyncingChain] = useState(false);
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<OnChainActivityItem | null>(null);

  // Verify & Mint state
  const [isSample, setIsSample] = useState(false);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [capacity, setCapacity] = useState(5);
  const [lat, setLat] = useState('10.8231');
  const [lng, setLng] = useState('106.6297');
  const [busy, setBusy] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyApiResponse | null>(null);
  const [mintTxHash, setMintTxHash] = useState<Hex | null>(null);

  // Market & Retire state
  const [buy, setBuy] = useState(10);
  const [buyTxHash, setBuyTxHash] = useState<Hex | null>(null);
  const [company, setCompany] = useState('');
  const [amount, setAmount] = useState(10);
  const [reason, setReason] = useState('Bù đắp khí thải xuất khẩu quý 4/2026');
  const [retireStep, setRetireStep] = useState<'idle' | 'approving' | 'retiring' | 'done'>('idle');
  const [approveTxHash, setApproveTxHash] = useState<Hex | null>(null);
  const [retireTxHash, setRetireTxHash] = useState<Hex | null>(null);

  // Certificates metadata modal
  const [inspectedCert, setInspectedCert] = useState<OnChainCertificate | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const wrongNetwork = Boolean(wallet && walletChainId !== null && walletChainId !== CHAIN_ID);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(t);
  }, [toast]);

  // Fetch server status once on mount
  useEffect(() => {
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSysStatus(data);
      })
      .catch(() => {});
  }, []);

  const refreshOnChainData = useCallback(
    async (targetWallet?: Address | null) => {
      const activeWallet = targetWallet === undefined ? wallet : targetWallet;
      if (!IS_DEPLOYED) return;
      setSyncingChain(true);
      try {
        const [nextStats, nextActivity] = await Promise.all([
          fetchDashboardStats(activeWallet),
          fetchOnChainActivity(),
        ]);
        setStats(nextStats);
        setActivity(nextActivity);
        if (activeWallet) {
          const nextCerts = await fetchUserCertificates(activeWallet, nextActivity);
          setCerts(nextCerts);
        } else {
          setCerts([]);
        }
      } catch (err) {
        console.error('Failed to sync on-chain state:', err);
      } finally {
        setSyncingChain(false);
      }
    },
    [wallet]
  );

  // Sync on-chain state on mount and when wallet changes
  useEffect(() => {
    refreshOnChainData(wallet);
  }, [wallet, refreshOnChainData]);

  // Listen to existing EVM wallet connection & account/chain events
  useEffect(() => {
    const eth = getInjectedEthereum();
    if (!eth) return;

    let cancelled = false;
    (async () => {
      try {
        const [accounts, chainHex] = (await Promise.all([
          eth.request({method: 'eth_accounts'}),
          eth.request({method: 'eth_chainId'}),
        ])) as [string[], string];
        if (cancelled) return;
        if (accounts?.[0]) {
          setWallet(accounts[0] as Address);
        }
        if (chainHex) {
          setWalletChainId(parseInt(chainHex, 16));
        }
      } catch {
        // Ignore silent probe failures
      }
    })();

    const onAccountsChanged = (accs: unknown) => {
      const list = Array.isArray(accs) ? (accs as string[]) : [];
      if (list[0]) {
        setWallet(list[0] as Address);
      } else {
        setWallet(null);
        setCerts([]);
      }
    };

    const onChainChanged = (chainHex: unknown) => {
      if (typeof chainHex === 'string') {
        setWalletChainId(parseInt(chainHex, 16));
      }
      refreshOnChainData();
    };

    eth.on?.('accountsChanged', onAccountsChanged);
    eth.on?.('chainChanged', onChainChanged);

    return () => {
      cancelled = true;
      eth.removeListener?.('accountsChanged', onAccountsChanged);
      eth.removeListener?.('chainChanged', onChainChanged);
    };
  }, [refreshOnChainData]);

  function navigate(nextTab: Tab) {
    setTab(nextTab);
    setMobile(false);
  }

  async function connectWallet() {
    const eth = getInjectedEthereum();
    if (!eth) {
      setToast('Không tìm thấy ví trình duyệt (MetaMask / Core Wallet).');
      return;
    }
    try {
      const accounts = (await eth.request({method: 'eth_requestAccounts'})) as string[];
      if (!accounts?.[0]) {
        setToast('Không có tài khoản nào được chọn.');
        return;
      }
      const connected = accounts[0] as Address;
      setWallet(connected);
      const switchedId = await ensureFujiNetwork(eth);
      setWalletChainId(switchedId);
      setModal(false);
      setToast(`Đã kết nối ${shortAddr(connected)} trên ${NETWORK_LABEL}`);
    } catch (err) {
      setToast(formatAvaxError(err));
    }
  }

  async function switchNetwork() {
    const eth = getInjectedEthereum();
    if (!eth) return;
    try {
      const switchedId = await ensureFujiNetwork(eth);
      setWalletChainId(switchedId);
      setToast(`Đã chuyển sang mạng ${NETWORK_LABEL}`);
    } catch (err) {
      setToast(formatAvaxError(err));
    }
  }

  function disconnectWallet() {
    setWallet(null);
    setCerts([]);
    setModal(false);
    setToast('Đã ngắt kết nối ví trên giao diện.');
  }

  async function loadSampleSolarData() {
    try {
      setBusy('sample');
      const res = await fetch('/sample-solar.jpg');
      if (!res.ok) throw new Error('Không tải được ảnh mẫu /sample-solar.jpg');
      const blob = await res.blob();
      const sampleFile = new File([blob], 'thu-duc-rooftop-solar.jpg', {type: 'image/jpeg'});
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(sampleFile));
      setSelectedFile(sampleFile);
      setFileName('thu-duc-rooftop-solar.jpg');
      setIsSample(true);
      setCapacity(5);
      setLat('10.8231');
      setLng('106.6297');
      setVerifyResult(null);
      setMintTxHash(null);
      setToast('Đã nạp ảnh mái nhà năng lượng mặt trời mẫu tại Thủ Đức (TP.HCM).');
    } catch (err) {
      setToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  function handleFileChange(f?: File) {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      setToast('Vui lòng chọn ảnh dưới 10 MB.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
      setToast('Chỉ hỗ trợ PNG, JPG và WEBP.');
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setSelectedFile(f);
    setFileName(f.name);
    setIsSample(false);
    setVerifyResult(null);
    setMintTxHash(null);
  }

  async function runVerification() {
    if (!selectedFile && !isSample) {
      setToast('Hãy tải ảnh mái nhà/hóa đơn hoặc bấm "Tải dữ liệu mẫu".');
      return;
    }
    setBusy('verify');
    setMintTxHash(null);
    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append('image', selectedFile);
      }
      if (wallet) {
        formData.append('userAddress', wallet);
      }
      formData.append('latitude', lat);
      formData.append('longitude', lng);
      formData.append('capacity', String(capacity));
      formData.append('isSample', String(isSample));
      if (isSample) {
        formData.append('sampleNonce', String(Date.now()));
      }

      const response = await fetch('/api/verify', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Kiểm định thất bại.');
      }

      setVerifyResult(payload as VerifyApiResponse);
      if (payload.signature) {
        setToast('AI + NASA POWER kiểm định xong & Oracle đã ký xác thực ECDSA!');
      } else {
        setToast('Đã hoàn tất phân tích AI & NASA POWER.');
      }
    } catch (err) {
      setToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function mintOnChain() {
    if (!IS_DEPLOYED || !REGISTRY_ADDRESS) {
      setToast('Smart Contract chưa được deploy lên Avalanche Fuji.');
      return;
    }
    if (!wallet) {
      setModal(true);
      setToast('Vui lòng kết nối ví trước khi Mint GCARB.');
      return;
    }
    if (!verifyResult?.signature || !verifyResult?.proofHash) {
      setToast('Chưa có chữ ký Oracle hợp lệ. Hãy bấm Xác minh lại sau khi kết nối ví.');
      return;
    }

    const eth = getInjectedEthereum();
    if (!eth) {
      setToast('Không tìm thấy ví trình duyệt.');
      return;
    }

    setBusy('mint');
    try {
      const switchedId = await ensureFujiNetwork(eth);
      setWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet);

      const hash = await walletClient.writeContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'mintVerifiedCredits',
        args: [BigInt(verifyResult.amountWei), verifyResult.proofHash, verifyResult.signature],
        account: wallet,
      });

      setToast('Đang xác nhận giao dịch Mint trên Avalanche Fuji…');
      await publicClient.waitForTransactionReceipt({hash});
      setMintTxHash(hash);
      setVerifyResult((prev) => (prev ? {...prev, alreadyUsedOnChain: true} : prev));
      setToast(`Mint thành công ${fmt(verifyResult.co2Kg, 3)} GCARB on-chain!`);
      await refreshOnChainData(wallet);
    } catch (err) {
      setToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function purchaseOnChain() {
    if (!IS_DEPLOYED || !REGISTRY_ADDRESS) {
      setToast('Smart Contract chưa được deploy.');
      return;
    }
    if (!wallet) {
      setModal(true);
      setToast('Vui lòng kết nối ví để mua GCARB bằng test AVAX.');
      return;
    }
    const wholeTokens = Math.floor(Number(buy));
    if (!Number.isFinite(wholeTokens) || wholeTokens < 1 || wholeTokens > 100000 || wholeTokens !== Number(buy)) {
      setToast('Vui lòng nhập số lượng GCARB nguyên dương (1 - 100,000).');
      return;
    }
    if (wholeTokens > stats.treasuryStockKg) {
      setToast(`Kho tín chỉ chỉ còn ${fmt(stats.treasuryStockKg)} GCARB.`);
      return;
    }

    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('buy');
    setBuyTxHash(null);
    try {
      const switchedId = await ensureFujiNetwork(eth);
      setWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet);

      // Contract rate: amount = msg.value * 10000 -> 1 GCARB = 0.0001 AVAX = 1e14 wei
      const costWei = BigInt(wholeTokens) * 100000000000000n;
      const hash = await walletClient.writeContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'buyCredits',
        value: costWei,
        account: wallet,
      });

      setToast('Đang xác nhận giao dịch mua GCARB trên Fuji…');
      await publicClient.waitForTransactionReceipt({hash});
      setBuyTxHash(hash);
      setToast(`Đã mua thành công ${fmt(wholeTokens, 0)} GCARB từ Smart Contract!`);
      await refreshOnChainData(wallet);
    } catch (err) {
      setToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  async function retireOnChain() {
    if (!IS_DEPLOYED || !REGISTRY_ADDRESS || !TOKEN_ADDRESS) {
      setToast('Smart Contract chưa được deploy.');
      return;
    }
    if (!wallet) {
      setModal(true);
      setToast('Vui lòng kết nối ví doanh nghiệp để thực hiện Retire.');
      return;
    }

    const cleanCompany = sanitizeOnChainText(company, 120);
    const cleanReason = sanitizeOnChainText(reason, 256);

    const companyErr = validateOnChainText(company, 120, 'Tên doanh nghiệp');
    if (companyErr) {
      setToast(companyErr);
      return;
    }
    const reasonErr = validateOnChainText(reason, 256, 'Lý do bù đắp carbon');
    if (reasonErr) {
      setToast(reasonErr);
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setToast('Số lượng kg CO₂ cần retire phải lớn hơn 0.');
      return;
    }

    const amountStr = (Math.floor(amount * 1000) / 1000).toFixed(3);
    const amountWei = parseEther(amountStr);
    if (amountWei <= 0n || amountWei > stats.userBalanceWei) {
      setToast(`Số dư GCARB trong ví (${fmt(stats.userBalanceKg, 3)}) không đủ.`);
      return;
    }

    const eth = getInjectedEthereum();
    if (!eth) return;

    setBusy('retire');
    setApproveTxHash(null);
    setRetireTxHash(null);

    try {
      const switchedId = await ensureFujiNetwork(eth);
      setWalletChainId(switchedId);
      const walletClient = getWalletClient(eth, wallet);

      // Step 1: Approve if current allowance is insufficient
      if (stats.userAllowanceWei < amountWei) {
        setRetireStep('approving');
        setToast('Bước 1/2: Cấp quyền (Approve) GCARB cho CarbonRegistry…');
        const appHash = await walletClient.writeContract({
          address: TOKEN_ADDRESS,
          abi: TOKEN_ABI,
          functionName: 'approve',
          args: [REGISTRY_ADDRESS, amountWei],
          account: wallet,
        });
        await publicClient.waitForTransactionReceipt({hash: appHash});
        setApproveTxHash(appHash);
      }

      // Step 2: Retire & Mint 100% On-Chain SVG NFT
      setRetireStep('retiring');
      setToast('Bước 2/2: Đốt GCARB vĩnh viễn & Đúc chứng nhận ESG NFT…');
      const retHash = await walletClient.writeContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: 'retireCredits',
        args: [amountWei, cleanCompany, cleanReason],
        account: wallet,
      });
      await publicClient.waitForTransactionReceipt({hash: retHash});
      setRetireTxHash(retHash);
      setRetireStep('done');
      setToast('Đã đốt tín chỉ & cấp Chứng nhận ESG NFT on-chain!');
      await refreshOnChainData(wallet);
      setTab('certificates');
    } catch (err) {
      setRetireStep('idle');
      setToast(formatAvaxError(err));
    } finally {
      setBusy('');
    }
  }

  function downloadSvg(cert: OnChainCertificate) {
    if (!cert.svgMarkup) return;
    const blob = new Blob([cert.svgMarkup], {type: 'image/svg+xml;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AvaxGreen-ESG-${cert.id}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadJson(cert: OnChainCertificate) {
    const blob = new Blob([cert.rawJson], {type: 'application/json;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AvaxGreen-ESG-${cert.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyText(value: string, label: string) {
    navigator.clipboard?.writeText(value);
    setToast(`Đã sao chép ${label}.`);
  }

  const retirementRatio = useMemo(() => {
    if (stats.totalMintedKg <= 0) return 0;
    return Math.min(100, Math.round((stats.totalRetiredKg / stats.totalMintedKg) * 1000) / 10);
  }, [stats.totalMintedKg, stats.totalRetiredKg]);

  const equivalentTrees = useMemo(() => Math.round(stats.totalRetiredKg / 21), [stats.totalRetiredKg]);

  const estimatedAvaxCost = useMemo(() => {
    const n = Math.floor(Number(buy));
    if (!Number.isFinite(n) || n <= 0) return '0.0000';
    return (n * 0.0001).toFixed(4);
  }, [buy]);

  const nav = [
    {id: 'overview' as Tab, label: 'Tổng quan', icon: LayoutDashboard},
    {id: 'verify' as Tab, label: 'Xác minh & Mint', icon: ScanLine},
    {id: 'market' as Tab, label: 'Thị trường carbon', icon: ShoppingBag},
    {id: 'certificates' as Tab, label: 'Chứng nhận của tôi', icon: Award},
  ];

  const companyBytes = utf8ByteLength(company.replace(/[\r\n\t]+/g, ' ').trim());
  const reasonBytes = utf8ByteLength(reason.replace(/[\r\n\t]+/g, ' ').trim());

  return (
    <div className="app">
      <aside className={mobile ? 'sidebar open' : 'sidebar'}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('overview');
          }}
        >
          <span className="brand-icon">
            <Leaf size={23} />
          </span>
          avax<span>green</span>
          <span className="brand-dot">®</span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>FUJI</span>
        </div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === 'certificates' && certs.length > 0 && <b>{certs.length}</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-line" />
        <div className="ecosystem-label">HỆ SINH THÁI</div>
        <a
          className="nav-item"
          href={EXPLORER_BASE ? `${EXPLORER_BASE}` : 'https://testnet.snowtrace.io'}
          target="_blank"
          rel="noreferrer"
        >
          <Mountain size={19} />
          Snowtrace Explorer
          <ExternalLink size={13} />
        </a>
        <button className="nav-item" onClick={() => setModal(true)}>
          <Globe2 size={19} />
          {NETWORK_LABEL}
          <span className={wrongNetwork ? 'network-dot warn' : 'network-dot'} />
        </button>

        <div className="sidebar-bottom">
          <div className="hackathon-card">
            <span className="tiny-badge">
              <FlaskConical size={13} /> BUILT FOR UNIHACK
            </span>
            <h3>
              Small rooftops.
              <br />
              Bigger impact.
            </h3>
            <p>
              Năng lượng sạch Việt Nam,
              <br />
              xác thực AI & on-chain Avalanche.
            </p>
            <div className="hackathon-logos">
              <span className="avax-mark">▲</span> Avalanche <span>×</span> Team1
            </div>
          </div>
          <div className="sidebar-footer">
            <span className="avatar">AG</span>
            <div>
              AvaxGreen Protocol
              <small>{IS_DEPLOYED ? 'On-chain RWA · Live' : 'Chưa deploy contract'}</small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header>
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span>{NETWORK_LABEL}</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === tab)?.label}</strong>
          </div>

          <div className="header-actions">
            {wrongNetwork ? (
              <button className="fuji-badge warn-pill" onClick={switchNetwork}>
                <span />
                Chuyển sang {NETWORK_LABEL}
              </button>
            ) : (
              <span className="fuji-badge">
                <span />
                {NETWORK_LABEL} ({CHAIN_ID})
              </span>
            )}
            <button className="wallet-button" onClick={() => setModal(true)}>
              <Wallet size={16} />
              {wallet ? shortAddr(wallet) : 'Kết nối ví'}
            </button>
          </div>
        </header>

        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> AVALANCHE RWA CARBON PROTOCOL
              </div>
              <h1>
                {tab === 'overview'
                  ? 'Tác động xanh, được chứng thực.'
                  : tab === 'verify'
                    ? 'Năng lượng sạch. Giá trị thật.'
                    : tab === 'market'
                      ? 'Đầu tư vào một tương lai xanh.'
                      : 'Mỗi chứng nhận, một cam kết.'}
              </h1>
              <p>
                {tab === 'overview'
                  ? 'Số liệu thực tế đọc trực tiếp từ Smart Contract trên Avalanche Fuji Testnet.'
                  : tab === 'verify'
                    ? 'Gemini Vision AI + NASA POWER API kiểm định mái nhà và Oracle ECDSA ký mint GCARB.'
                    : tab === 'market'
                      ? 'Mua GCARB bằng test AVAX, đốt vĩnh viễn và nhận chứng nhận ESG NFT on-chain.'
                      : 'Chứng nhận SVG 100% on-chain (ERC-721), lưu trữ vĩnh viễn trên chuỗi.'}
              </p>
            </div>

            <button
              className="demo-switch"
              onClick={() => {
                navigate('verify');
                loadSampleSolarData();
              }}
            >
              <FlaskConical size={16} />
              Load Sample Solar Data
              <ChevronRight size={15} />
            </button>
          </div>

          {!IS_DEPLOYED && (
            <div className="system-alert">
              <AlertTriangle size={20} />
              <div>
                <strong>Smart Contract chưa được triển khai lên Avalanche Fuji</strong>
                <p>
                  File <code>frontend/src/contracts/addresses.json</code> hiện chưa có địa chỉ{' '}
                  <code>GreenCarbonToken</code> và <code>CarbonRegistry</code>. Hãy cấu hình{' '}
                  <code>contracts/.env</code> và chạy <code>npm run deploy:fuji -w contracts</code> để
                  kích hoạt đọc/ghi on-chain thật.
                </p>
              </div>
            </div>
          )}

          {tab === 'overview' && (
            <>
              <section className="hero">
                <div className="hero-content">
                  <div className="hero-tag">
                    <Sparkles size={13} /> GEMINI VISION AI · NASA POWER · AVALANCHE FUJI
                  </div>
                  <h2>
                    Từ mái nhà của bạn.
                    <br />
                    Đến tương lai <em>xanh hơn.</em>
                  </h2>
                  <p>
                    Mỗi kWh sạch đều được kiểm định bằng AI & dữ liệu vệ tinh NASA.
                    <br />
                    Token hóa 1 GCARB = 1 kg CO₂ · Chứng nhận ESG SVG 100% on-chain.
                  </p>
                  <div className="hero-actions">
                    <button className="primary" onClick={() => navigate('verify')}>
                      <Plus size={17} />
                      Xác minh & Mint GCARB
                    </button>
                    <button className="text-button" onClick={() => navigate('market')}>
                      Mua & Retire tín chỉ <ChevronRight size={15} />
                    </button>
                  </div>
                  <div className="hero-trust">
                    <ShieldCheck size={14} /> Kiểm chứng trực tiếp từng giao dịch trên Snowtrace
                  </div>
                </div>
                <SolarScene />
                <div className="hero-float">
                  <span className="float-icon">
                    <Sun size={18} />
                  </span>
                  <div>
                    100% On-Chain RWA
                    <small>
                      <span /> Verified by Oracle ECDSA
                    </small>
                  </div>
                  <CheckCheck size={18} />
                </div>
                <div className="hero-coordinate">
                  10.8231° N · 106.6297° E <span>HO CHI MINH CITY</span>
                </div>
              </section>

              <div className="section-line">
                <h3>Tổng quan On-Chain ({NETWORK_LABEL})</h3>
                <div className="chain-links-row">
                  {REGISTRY_ADDRESS && addressUrl(REGISTRY_ADDRESS) && (
                    <a
                      className="explorer-pill"
                      href={addressUrl(REGISTRY_ADDRESS)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Registry: {shortAddr(REGISTRY_ADDRESS)} <ExternalLink size={12} />
                    </a>
                  )}
                  {TOKEN_ADDRESS && addressUrl(TOKEN_ADDRESS) && (
                    <a
                      className="explorer-pill"
                      href={addressUrl(TOKEN_ADDRESS)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      GCARB: {shortAddr(TOKEN_ADDRESS)} <ExternalLink size={12} />
                    </a>
                  )}
                  <button
                    className="refresh-pill"
                    onClick={() => refreshOnChainData()}
                    disabled={syncingChain || !IS_DEPLOYED}
                  >
                    <RefreshCw size={12} className={syncingChain ? 'spin' : ''} />
                    {syncingChain ? 'Đang đồng bộ…' : 'Làm mới chuỗi'}
                  </button>
                </div>
              </div>

              <div className="metrics">
                <Metric
                  label="CO₂ đã số hóa (On-chain)"
                  value={fmt(stats.totalMintedKg)}
                  unit="kg CO₂"
                  icon={Leaf}
                  note={IS_DEPLOYED ? 'Live RPC' : 'Chưa deploy'}
                  sub="Tổng GCARB đã phát hành"
                />
                <Metric
                  label="CO₂ đã bù đắp / đốt"
                  value={fmt(stats.totalRetiredKg)}
                  unit="kg CO₂"
                  icon={TreePine}
                  note={`${retirementRatio}%`}
                  sub="Tín chỉ đã đốt vĩnh viễn"
                />
                <Metric
                  label="Chứng nhận ESG NFT"
                  value={fmt(stats.totalCertificates, 0)}
                  unit="NFT"
                  icon={FileCheck2}
                  note="ERC-721"
                  sub="SVG metadata 100% on-chain"
                />
                <Metric
                  label="Số dư GCARB của bạn"
                  value={wallet ? fmt(stats.userBalanceKg) : '—'}
                  unit="GCARB"
                  icon={Wallet}
                  note={wallet ? `${stats.userAvax.toFixed(3)} AVAX` : 'Chưa kết nối'}
                  sub={wallet ? shortAddr(wallet) : 'Kết nối ví để đọc số dư'}
                />
              </div>

              <div className="dashboard-grid">
                <section className="panel chart-panel">
                  <div className="panel-title">
                    <div>
                      <h3>Biến động Carbon On-Chain</h3>
                      <p>Tích lũy từ sự kiện CreditsMinted & CreditsRetired thực tế trên chuỗi</p>
                    </div>
                    <span className="period">
                      Kho Market: {fmt(stats.treasuryStockKg, 0)} GCARB
                    </span>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i />
                      Tổng số hóa ({fmt(stats.totalMintedKg)} kg)
                    </span>
                    <span>
                      <i />
                      Tổng đã retire ({fmt(stats.totalRetiredKg)} kg)
                    </span>
                    <strong>
                      {retirementRatio}% <small>tỷ lệ retire</small>
                    </strong>
                  </div>
                  <OnChainChart
                    activity={activity}
                    totalMinted={stats.totalMintedKg}
                    totalRetired={stats.totalRetiredKg}
                  />
                </section>

                <section className="panel impact-panel">
                  <div className="panel-title">
                    <h3>Tác động thực tế</h3>
                    <span className="soft-icon">
                      <Globe2 size={18} />
                    </span>
                  </div>
                  <div className="impact-ring">
                    <svg viewBox="0 0 180 180">
                      <circle
                        cx="90"
                        cy="90"
                        r="72"
                        fill="none"
                        stroke="#23312c"
                        strokeWidth="11"
                      />
                      <circle
                        cx="90"
                        cy="90"
                        r="72"
                        fill="none"
                        stroke="#b4ed79"
                        strokeWidth="11"
                        strokeDasharray={`${Math.round((retirementRatio / 100) * 452)} 453`}
                        strokeLinecap="round"
                        transform="rotate(-90 90 90)"
                      />
                    </svg>
                    <div>
                      <TreePine size={24} />
                      <strong>{fmt(equivalentTrees, 0)}</strong>
                      <span>cây xanh tương đương</span>
                    </div>
                  </div>
                  <p className="impact-explainer">
                    Quy đổi từ {fmt(stats.totalRetiredKg)} kg CO₂ đã retire thật
                    <br />
                    (ước tính 21 kg CO₂ / cây / năm).
                  </p>
                  <div className="impact-bottom">
                    <span>Tồn kho Market: {fmt(stats.treasuryStockKg, 0)} GCARB</span>
                    <span>
                      On-chain <Leaf size={13} />
                    </span>
                  </div>
                </section>
              </div>

              <section className="panel activity-panel">
                <div className="panel-title">
                  <div>
                    <h3>Dòng chảy tác động (On-Chain Events)</h3>
                    <p>Mỗi giao dịch đều có mã Tx Hash kiểm chứng trực tiếp trên Snowtrace.</p>
                  </div>
                  <button
                    className="text-button small"
                    onClick={() => navigate('certificates')}
                  >
                    Xem chứng nhận
                    <ChevronRight size={14} />
                  </button>
                </div>

                {activity.length === 0 ? (
                  <div className="empty-table-note">
                    <Info size={17} />
                    <span>
                      {IS_DEPLOYED
                        ? 'Chưa ghi nhận giao dịch nào trong 10,000 block gần nhất. Hãy Mint hoặc Retire để tạo giao dịch đầu tiên!'
                        : 'Chưa kết nối contract. Hãy deploy lên Avalanche Fuji để xem giao dịch on-chain.'}
                    </span>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ĐỊA CHỈ / CHI TIẾT</th>
                          <th>HOẠT ĐỘNG</th>
                          <th>KHỐI LƯỢNG</th>
                          <th>THỜI GIAN</th>
                          <th>SNOWTRACE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activity.slice(0, 8).map((r) => {
                          const explorerHref = txUrl(r.txHash);
                          return (
                            <tr key={r.id}>
                              <td>
                                <div className="project-cell">
                                  <span
                                    className={
                                      r.type === 'Retired'
                                        ? 'project-icon retired'
                                        : 'project-icon'
                                    }
                                  >
                                    {r.type === 'Retired' ? (
                                      <TreePine size={17} />
                                    ) : r.type === 'Purchased' ? (
                                      <ShoppingBag size={17} />
                                    ) : (
                                      <Sun size={17} />
                                    )}
                                  </span>
                                  <div>
                                    {shortAddr(r.actor)}
                                    <small>{r.detail}</small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span
                                  className={r.type === 'Retired' ? 'status retired' : 'status'}
                                >
                                  <span />
                                  {r.type === 'Retired'
                                    ? 'Đã retire'
                                    : r.type === 'Purchased'
                                      ? 'Đã mua'
                                      : 'Đã mint'}
                                </span>
                              </td>
                              <td className="numeric">
                                {fmt(r.amountKg)} <span>kg CO₂</span>
                              </td>
                              <td className="muted">{formatRelativeTime(r.timestamp)}</td>
                              <td>
                                <div className="tx-actions">
                                  {explorerHref ? (
                                    <a
                                      className="snowtrace-link"
                                      href={explorerHref}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {r.txHash.slice(0, 8)}… <ExternalLink size={12} />
                                    </a>
                                  ) : (
                                    <span className="muted">{r.txHash.slice(0, 10)}…</span>
                                  )}
                                  <button
                                    className="icon-button"
                                    aria-label="Chi tiết giao dịch"
                                    onClick={() => setSelectedActivity(r)}
                                  >
                                    <ArrowUpRight size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {tab === 'verify' && (
            <>
              <div className="demo-banner">
                <FlaskConical size={19} />
                <div>
                  <strong>Test 1 chạm cho Ban Giám Khảo · AI Vision + NASA POWER + Oracle</strong>
                  <p>
                    Bấm tải ảnh mái nhà Thủ Đức thật, sau đó bấm Xác minh để chạy Gemini Vision +
                    NASA API + ký ECDSA và Mint lên Avalanche Fuji.
                  </p>
                </div>
                <button onClick={loadSampleSolarData} disabled={busy === 'sample'}>
                  {busy === 'sample' ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  Load Sample Solar Data
                </button>
              </div>

              <div className="flow-steps">
                {[
                  'Tải bằng chứng & tọa độ',
                  'Gemini Vision + NASA POWER',
                  'Oracle ký ECDSA',
                  'Mint GCARB On-Chain',
                ].map((label, i) => {
                  const done =
                    (i === 0 && Boolean(fileName)) ||
                    (i === 1 && Boolean(verifyResult)) ||
                    (i === 2 && Boolean(verifyResult?.signature)) ||
                    (i === 3 && Boolean(mintTxHash));
                  return (
                    <span key={label} className={done ? 'current' : ''}>
                      <b>{done ? <Check size={14} /> : i + 1}</b>
                      {label}
                    </span>
                  );
                })}
              </div>

              <div className="verify-grid">
                <section className="panel form-panel">
                  <div className="panel-title">
                    <div>
                      <h3>Dự án điện mặt trời của bạn</h3>
                      <p>Tải ảnh mái nhà lắp pin mặt trời hoặc hóa đơn điện</p>
                    </div>
                    <Sun size={21} />
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => handleFileChange(e.target.files?.[0])}
                  />

                  <button
                    className={`upload-zone ${fileName ? 'has-file' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {preview ? (
                      <img src={preview} alt="Ảnh dự án điện mặt trời" />
                    ) : (
                      <span className="upload-icon">
                        {fileName ? <Sun size={29} /> : <Upload size={27} />}
                      </span>
                    )}
                    <strong>{fileName || 'Chọn ảnh mái nhà hoặc hóa đơn điện'}</strong>
                    <span>
                      {fileName ? 'Bấm để thay đổi ảnh' : 'PNG, JPG, WEBP · Tối đa 10 MB'}
                    </span>
                    {isSample && (
                      <b className="sample-badge">SAMPLE SOLAR PROJECT · THỦ ĐỨC, TP.HCM</b>
                    )}
                  </button>

                  <div className="input-grid">
                    <label>
                      Công suất dự kiến (kWp)
                      <input
                        type="number"
                        min="0.1"
                        max="1000"
                        step="0.1"
                        value={capacity}
                        onChange={(e) => {
                          setCapacity(Math.max(0.1, Math.min(1000, Number(e.target.value) || 0.1)));
                          setVerifyResult(null);
                        }}
                      />
                    </label>
                    <label>
                      Chu kỳ ghi nhận
                      <input value="30 ngày (Ước tính vệ tinh NASA)" readOnly />
                    </label>
                    <label>
                      Vĩ độ (Latitude)
                      <input
                        value={lat}
                        onChange={(e) => {
                          setLat(e.target.value);
                          setVerifyResult(null);
                        }}
                      />
                    </label>
                    <label>
                      Kinh độ (Longitude)
                      <input
                        value={lng}
                        onChange={(e) => {
                          setLng(e.target.value);
                          setVerifyResult(null);
                        }}
                      />
                    </label>
                  </div>

                  <div className="field-note">
                    <MapPin size={14} />
                    Tọa độ mẫu: TP. Hồ Chí Minh (10.8231, 106.6297) · Ví nhận:{' '}
                    {wallet ? shortAddr(wallet) : 'Chưa kết nối ví'}
                  </div>

                  <button
                    className="primary full"
                    disabled={
                      !!busy ||
                      (!fileName && !isSample) ||
                      !Number.isFinite(Number(lat)) ||
                      Number(lat) < -90 ||
                      Number(lat) > 90 ||
                      !Number.isFinite(Number(lng)) ||
                      Number(lng) < -180 ||
                      Number(lng) > 180
                    }
                    onClick={runVerification}
                  >
                    {busy === 'verify' ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <ScanLine size={18} />
                    )}
                    {busy === 'verify'
                      ? 'Đang gọi Gemini Vision & NASA POWER…'
                      : 'Xác minh AI & Ký Oracle'}
                  </button>

                  <div className="server-status-row">
                    <span className={sysStatus?.hasGeminiKey ? 'dot-ok' : 'dot-warn'}>
                      Gemini AI: {sysStatus?.hasGeminiKey ? 'Sẵn sàng' : 'Chưa gắn key'}
                    </span>
                    <span className={sysStatus?.hasOracleKey ? 'dot-ok' : 'dot-warn'}>
                      Oracle Signer: {sysStatus?.hasOracleKey ? 'Sẵn sàng' : 'Chưa gắn key'}
                    </span>
                  </div>
                </section>

                <section className="panel evidence-panel">
                  <div className="panel-title">
                    <div>
                      <div className="eyebrow">AI + SATELLITE + ECDSA ORACLE</div>
                      <h3>Evidence Passport</h3>
                    </div>
                    <ShieldCheck size={24} />
                  </div>

                  {!verifyResult ? (
                    <div className="evidence-empty">
                      <div className="scan-visual">
                        <ScanLine size={52} />
                      </div>
                      <h3>
                        Mọi tác động đều bắt đầu
                        <br />
                        từ một bằng chứng.
                      </h3>
                      <p>
                        Hệ thống sẽ gọi Gemini Vision AI chấm điểm chống gian lận, lấy bức xạ mặt
                        trời thực tế từ NASA POWER và ký ECDSA để đúc token GCARB.
                      </p>
                      <div className="evidence-chips">
                        <span>Gemini Vision AI</span>
                        <span>NASA POWER API</span>
                        <span>ECDSA Signature</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className={
                          verifyResult.signature ? 'verified-banner' : 'verified-banner warn'
                        }
                      >
                        <CheckCheck size={18} />
                        {verifyResult.signature
                          ? 'Đã xác thực AI + NASA & Oracle ký ECDSA thành công'
                          : 'Đã tính toán ước tính (chưa có chữ ký Oracle)'}
                      </div>

                      <div className="evidence-number">
                        <span>TÍN CHỈ CARBON ĐƯỢC PHÉP MINT</span>
                        <strong>
                          {fmt(verifyResult.co2Kg, 3)}
                          <small>kg CO₂</small>
                        </strong>
                        <p>= {fmt(verifyResult.co2Kg, 3)} GCARB (ERC-20 · 1 GCARB = 1 kg CO₂)</p>
                      </div>

                      <div className="trust-card">
                        <div className="trust-head">
                          <span>Điểm tin cậy / Chống gian lận AI</span>
                          <strong
                            className={
                              verifyResult.fraudRisk === 'low'
                                ? 'risk-low'
                                : verifyResult.fraudRisk === 'medium'
                                  ? 'risk-med'
                                  : 'risk-high'
                            }
                          >
                            {verifyResult.trustScore !== null
                              ? `${verifyResult.trustScore}/100 (${verifyResult.fraudRisk.toUpperCase()})`
                              : 'Chưa đánh giá'}
                          </strong>
                        </div>
                        <div className="trust-bar">
                          <div
                            style={{width: `${verifyResult.trustScore ?? 0}%`}}
                            className={verifyResult.fraudRisk}
                          />
                        </div>
                        <p className="trust-summary">{verifyResult.summary}</p>
                        {verifyResult.fraudFlags.length > 0 && (
                          <ul className="fraud-flags">
                            {verifyResult.fraudFlags.map((flag, idx) => (
                              <li key={idx}>
                                <ShieldAlert size={13} /> {flag}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="evidence-row">
                        <span>Nguồn AI Vision</span>
                        <strong>
                          {verifyResult.aiMode === 'gemini'
                            ? `Gemini Vision (${Math.round((verifyResult.confidence ?? 0) * 100)}% tin cậy)`
                            : 'Sample / Fallback'}
                        </strong>
                      </div>
                      <div className="evidence-row">
                        <span>Công suất / Số tấm pin</span>
                        <strong>
                          {verifyResult.capacityKw} kWp
                          {verifyResult.panelCount ? ` · ~${verifyResult.panelCount} tấm` : ''}
                        </strong>
                      </div>
                      <div className="evidence-row">
                        <span>Bức xạ mặt trời (NASA POWER)</span>
                        <strong>
                          {verifyResult.irradiance} kWh/m²/ngày (
                          {verifyResult.solarMode === 'nasa-climatology' ? 'Live NASA' : 'Mẫu'})
                        </strong>
                      </div>
                      <div className="evidence-row">
                        <span>Sản lượng 30 ngày</span>
                        <strong>{fmt(verifyResult.kwh)} kWh</strong>
                      </div>
                      <div className="evidence-row">
                        <span>Proof Hash (Anti-replay)</span>
                        <strong className="mono">{shortAddr(verifyResult.proofHash)}</strong>
                      </div>
                      <div className="evidence-row">
                        <span>Chữ ký Oracle ECDSA</span>
                        <strong className="mono">
                          {verifyResult.signature
                            ? shortAddr(verifyResult.signature)
                            : 'Chưa có chữ ký'}
                        </strong>
                      </div>

                      {verifyResult.warnings.length > 0 && (
                        <div className="warnings-box">
                          {verifyResult.warnings.map((w, i) => (
                            <p key={i}>
                              <Info size={13} /> {w}
                            </p>
                          ))}
                        </div>
                      )}

                      {!wallet && (
                        <button className="secondary full" onClick={() => setModal(true)}>
                          <Wallet size={17} /> Kết nối ví EVM để Oracle ký cho địa chỉ của bạn
                        </button>
                      )}

                      <button
                        className="primary full"
                        disabled={
                          !!busy ||
                          !IS_DEPLOYED ||
                          !wallet ||
                          !verifyResult.signature ||
                          verifyResult.alreadyUsedOnChain ||
                          Boolean(mintTxHash)
                        }
                        onClick={mintOnChain}
                      >
                        {mintTxHash || verifyResult.alreadyUsedOnChain ? (
                          <Check size={18} />
                        ) : busy === 'mint' ? (
                          <LoaderCircle size={18} className="spin" />
                        ) : (
                          <Plus size={18} />
                        )}
                        {mintTxHash
                          ? 'Đã Mint GCARB lên chuỗi'
                          : verifyResult.alreadyUsedOnChain
                            ? 'Bằng chứng đã được Mint trước đó'
                            : `Mint ${fmt(verifyResult.co2Kg, 3)} GCARB On-Chain`}
                      </button>

                      {mintTxHash && (
                        <div className="tx-success-box">
                          <CheckCheck size={17} />
                          <div>
                            <strong>Giao dịch Mint đã xác nhận trên {NETWORK_LABEL}!</strong>
                            {txUrl(mintTxHash) ? (
                              <a href={txUrl(mintTxHash)!} target="_blank" rel="noreferrer">
                                Kiểm chứng trên Snowtrace ({shortAddr(mintTxHash)}){' '}
                                <ExternalLink size={13} />
                              </a>
                            ) : (
                              <span>Tx: {mintTxHash}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {mintTxHash && (
                        <button
                          className="text-button full"
                          onClick={() => navigate('market')}
                        >
                          Tiếp tục sang Thị trường & Retire <ChevronRight size={16} />
                        </button>
                      )}
                    </>
                  )}
                </section>
              </div>
            </>
          )}

          {tab === 'market' && (
            <>
              <div className="market-intro">
                <span>
                  <ShoppingBag size={18} /> AVALANCHE FUJI CARBON MARKETPLACE
                </span>
                <h2>
                  Một hành động nhỏ.
                  <br />
                  Một cam kết dài lâu.
                </h2>
                <p>
                  Mua GCARB bằng test AVAX trực tiếp từ Smart Contract, đốt vĩnh viễn và nhận
                  Chứng nhận ESG NFT on-chain.
                </p>
                <div className="market-balance-group">
                  <div className="market-balance">
                    <Wallet size={20} />
                    <div>
                      Số dư ví của bạn
                      <strong>
                        {wallet ? fmt(stats.userBalanceKg, 3) : '—'} <span>GCARB</span>
                      </strong>
                      <small>
                        {wallet ? `${stats.userAvax.toFixed(4)} AVAX` : 'Chưa kết nối ví'}
                      </small>
                    </div>
                  </div>
                  <div className="market-balance">
                    <ShieldCheck size={20} />
                    <div>
                      Tồn kho Market
                      <strong>
                        {fmt(stats.treasuryStockKg, 0)} <span>GCARB</span>
                      </strong>
                      <small>Sẵn sàng giao dịch on-chain</small>
                    </div>
                  </div>
                </div>
              </div>

              <div className="verify-grid">
                <section className="panel form-panel">
                  <div className="panel-title">
                    <h3>Mua tín chỉ carbon</h3>
                    <span className="status">
                      <span />
                      ON-CHAIN
                    </span>
                  </div>
                  <div className="asset-card">
                    <span className="brand-icon">
                      <Leaf size={26} />
                    </span>
                    <div>
                      Green Carbon Credit
                      <small>GCARB (ERC-20) · 1 GCARB = 1 kg CO₂</small>
                    </div>
                    <ShieldCheck size={21} />
                  </div>

                  <label>
                    Số lượng GCARB muốn mua (số nguyên)
                    <input
                      type="number"
                      value={buy}
                      min="1"
                      step="1"
                      max="100000"
                      onChange={(e) => setBuy(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    />
                  </label>

                  <div className="quick-amounts">
                    {[10, 50, 100, 250, 500].map((n) => (
                      <button
                        key={n}
                        className={buy === n ? 'selected' : ''}
                        onClick={() => setBuy(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>

                  <div className="evidence-row">
                    <span>Tỷ giá Smart Contract</span>
                    <strong>1 GCARB = 0.0001 AVAX</strong>
                  </div>
                  <div className="evidence-row">
                    <span>Tổng thanh toán</span>
                    <strong>{estimatedAvaxCost} AVAX</strong>
                  </div>

                  <button
                    className="primary full"
                    onClick={purchaseOnChain}
                    disabled={!!busy || !IS_DEPLOYED || stats.treasuryStockKg <= 0}
                  >
                    {busy === 'buy' ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <ShoppingBag size={18} />
                    )}
                    {busy === 'buy' ? 'Đang mua trên Fuji…' : `Mua ${buy} GCARB bằng test AVAX`}
                  </button>

                  {buyTxHash && (
                    <div className="tx-success-box">
                      <CheckCheck size={17} />
                      <div>
                        <strong>Đã mua GCARB thành công!</strong>
                        {txUrl(buyTxHash) && (
                          <a href={txUrl(buyTxHash)!} target="_blank" rel="noreferrer">
                            Xem trên Snowtrace ({shortAddr(buyTxHash)}) <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  <p className="fine-print">
                    Tín chỉ được chuyển trực tiếp từ kho tín chỉ đã xác minh của{' '}
                    <code>CarbonRegistry</code>. Không phát hành khống.
                  </p>
                </section>

                <section className="panel form-panel">
                  <div className="panel-title">
                    <h3>Retire & Cấp chứng nhận ESG NFT</h3>
                    <TreePine size={22} />
                  </div>

                  <label>
                    Tên doanh nghiệp ({companyBytes}/120 bytes)
                    <input
                      placeholder="Ví dụ: Công ty Xuất khẩu Xanh Việt Nam"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                    />
                  </label>

                  <label>
                    Số lượng retire (kg CO₂)
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                    />
                  </label>

                  <label>
                    Lý do bù đắp carbon ({reasonBytes}/256 bytes)
                    <textarea
                      placeholder="Ví dụ: Bù đắp khí thải xuất khẩu quý 4/2026"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>

                  <div className="retire-stepper">
                    <div
                      className={
                        retireStep === 'approving'
                          ? 'active'
                          : approveTxHash || retireStep === 'retiring' || retireStep === 'done'
                            ? 'done'
                            : ''
                      }
                    >
                      <b>1</b>
                      <span>Approve GCARB</span>
                    </div>
                    <div
                      className={
                        retireStep === 'retiring' ? 'active' : retireStep === 'done' ? 'done' : ''
                      }
                    >
                      <b>2</b>
                      <span>Burn & Mint ESG NFT</span>
                    </div>
                  </div>

                  <div className="retire-note">
                    <ShieldCheck size={19} />
                    <p>
                      Smart Contract sẽ đốt vĩnh viễn số GCARB này (chống bán trùng 2 lần) và đúc
                      ngay 1 ERC-721 NFT chứa ảnh SVG 100% on-chain về ví của bạn.
                    </p>
                  </div>

                  <button
                    className="primary full"
                    onClick={retireOnChain}
                    disabled={!!busy || !IS_DEPLOYED}
                  >
                    {busy === 'retire' ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Award size={18} />
                    )}
                    {retireStep === 'approving'
                      ? 'Đang Approve GCARB (1/2)…'
                      : retireStep === 'retiring'
                        ? 'Đang Retire & Đúc NFT (2/2)…'
                        : 'Retire & Cấp chứng nhận NFT'}
                  </button>

                  {retireTxHash && (
                    <div className="tx-success-box">
                      <CheckCheck size={17} />
                      <div>
                        <strong>Đã đốt GCARB & đúc chứng nhận NFT!</strong>
                        {txUrl(retireTxHash) && (
                          <a href={txUrl(retireTxHash)!} target="_blank" rel="noreferrer">
                            Xem trên Snowtrace ({shortAddr(retireTxHash)}){' '}
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}

          {tab === 'certificates' && (
            <>
              <div className="section-line">
                <h3>
                  Bộ sưu tập Chứng nhận ESG NFT <span className="count-badge">{certs.length}</span>
                </h3>
                <span>
                  <ShieldCheck size={15} />
                  100% On-Chain SVG Metadata · ERC-721 trên {NETWORK_LABEL}
                </span>
              </div>

              {!wallet ? (
                <section className="panel empty-gallery">
                  <div className="certificate-illustration">
                    <Award size={62} />
                    <Leaf size={25} />
                  </div>
                  <span className="eyebrow">WALLET REQUIRED</span>
                  <h2>Kết nối ví để xem ESG Certificate NFT.</h2>
                  <p>
                    Toàn bộ chứng nhận NFT thuộc sở hữu của ví bạn sẽ được đọc trực tiếp từ
                    Smart Contract trên Avalanche Fuji.
                  </p>
                  <button className="primary" onClick={() => setModal(true)}>
                    <Wallet size={18} />
                    Kết nối ví EVM
                  </button>
                </section>
              ) : certs.length === 0 ? (
                <section className="panel empty-gallery">
                  <div className="certificate-illustration">
                    <Award size={62} />
                    <Leaf size={25} />
                  </div>
                  <span className="eyebrow">ON-CHAIN ESG GALLERY</span>
                  <h2>Chứng nhận đầu tiên đang chờ bạn.</h2>
                  <p>
                    Mua hoặc mint GCARB rồi thực hiện Retire để tạo Chứng nhận xanh NFT
                    <br />
                    với SVG lưu trữ vĩnh viễn trên blockchain Avalanche.
                  </p>
                  <button className="primary" onClick={() => navigate('market')}>
                    <TreePine size={18} />
                    Đi tới Thị trường & Retire
                  </button>
                </section>
              ) : (
                <div className="certificate-grid">
                  {certs.map((c) => {
                    const explorerNft = nftUrl(c.id);
                    const explorerTx = txUrl(c.txHash);
                    return (
                      <article className="panel certificate" key={c.id}>
                        <div className="cert-svg-wrap">
                          <span className="onchain-badge">100% On-Chain SVG · ERC-721</span>
                          {c.imageDataUri ? (
                            <img
                              src={c.imageDataUri}
                              alt={`Chứng nhận ESG #${c.id} - ${c.company}`}
                            />
                          ) : (
                            <div className="cert-art">
                              <h3>{c.company}</h3>
                              <strong>{fmt(c.amountKg, 3)} kg CO₂</strong>
                            </div>
                          )}
                        </div>
                        <div className="cert-info">
                          <div className="cert-head">
                            <h3>
                              #{c.id} · {c.company}
                            </h3>
                            <strong>{fmt(c.amountKg, 3)} kg CO₂</strong>
                          </div>
                          <p>{c.reason}</p>
                          <div className="cert-footer">
                            <span>
                              {c.retiredAt
                                ? new Date(c.retiredAt * 1000).toLocaleString('vi-VN')
                                : 'On-chain'}
                            </span>
                            <div className="cert-actions">
                              {explorerTx && (
                                <a
                                  className="explorer-pill"
                                  href={explorerTx}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Xem giao dịch Retire trên Snowtrace"
                                >
                                  Tx <ExternalLink size={11} />
                                </a>
                              )}
                              {explorerNft && (
                                <a
                                  className="explorer-pill"
                                  href={explorerNft}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Xem NFT trên Snowtrace"
                                >
                                  NFT <ExternalLink size={11} />
                                </a>
                              )}
                              <button
                                className="icon-button"
                                title="Kiểm tra On-Chain Metadata & SVG Code"
                                onClick={() => setInspectedCert(c)}
                              >
                                <Code2 size={17} />
                              </button>
                              <button
                                className="icon-button"
                                title="Tải file ảnh SVG"
                                onClick={() => downloadSvg(c)}
                              >
                                <Download size={17} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <footer>
            <div>
              <span className="avax-mark">▲</span>Built on <strong>Avalanche</strong>
              <span className="footer-divider" />
              AI-Verified RWA Carbon Credits & On-Chain ESG Certificates.
            </div>
            <span>
              {NETWORK_LABEL} <span className="footer-dot">·</span> UniHack 2026
            </span>
          </footer>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={19} />
          <span>{toast}</span>
          <button className="icon-button" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Quản lý ví EVM"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close icon-button" onClick={() => setModal(false)}>
              <X size={21} />
            </button>
            <div className="brand-icon">
              <Wallet size={26} />
            </div>
            <h2>{wallet ? 'Ví Avalanche Fuji của bạn' : 'Kết nối ví Web3'}</h2>
            <p>
              {wallet
                ? 'Ví đang sẵn sàng ký giao dịch Mint, Mua GCARB và Retire lấy chứng nhận ESG NFT.'
                : 'Kết nối MetaMask hoặc Core Wallet. Hệ thống sẽ tự động thêm và chuyển sang mạng Avalanche Fuji Testnet (43113).'}
            </p>

            {wallet ? (
              <>
                <div className="wallet-info-box">
                  <div className="evidence-row">
                    <span>Địa chỉ ví</span>
                    <strong className="mono">
                      {shortAddr(wallet)}
                      <button
                        className="icon-button inline-copy"
                        onClick={() => copyText(wallet, 'địa chỉ ví')}
                      >
                        <Copy size={13} />
                      </button>
                    </strong>
                  </div>
                  <div className="evidence-row">
                    <span>Mạng lưới</span>
                    <strong>
                      {walletChainId === CHAIN_ID
                        ? `${NETWORK_LABEL} (${CHAIN_ID})`
                        : `Sai mạng (${walletChainId ?? '?'})`}
                    </strong>
                  </div>
                  <div className="evidence-row">
                    <span>Số dư test AVAX</span>
                    <strong>{stats.userAvax.toFixed(4)} AVAX</strong>
                  </div>
                  <div className="evidence-row">
                    <span>Số dư GCARB</span>
                    <strong>{fmt(stats.userBalanceKg, 3)} GCARB</strong>
                  </div>
                </div>

                {wrongNetwork && (
                  <button className="primary full" onClick={switchNetwork}>
                    Chuyển sang {NETWORK_LABEL} ({CHAIN_ID})
                  </button>
                )}

                {addressUrl(wallet) && (
                  <a href={addressUrl(wallet)!} target="_blank" rel="noreferrer">
                    Xem ví trên Snowtrace <ExternalLink size={14} />
                  </a>
                )}

                <button className="secondary full" onClick={disconnectWallet}>
                  Ngắt kết nối
                </button>
              </>
            ) : (
              <button className="primary full" onClick={connectWallet}>
                <Wallet size={18} />
                Kết nối MetaMask / Core Wallet
              </button>
            )}

            <a
              href="https://core.app/tools/testnet-faucet/?subnet=c&token=c"
              target="_blank"
              rel="noreferrer"
            >
              Nhận test AVAX miễn phí (Fuji Faucet) <ExternalLink size={14} />
            </a>
          </section>
        </div>
      )}

      {selectedActivity && (
        <div className="modal-backdrop" onClick={() => setSelectedActivity(null)}>
          <section
            className="panel modal"
            role="dialog"
            aria-modal="true"
            aria-label="Chi tiết giao dịch On-Chain"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setSelectedActivity(null)}
            >
              <X size={20} />
            </button>
            <ShieldCheck size={34} className="lime" />
            <h2>Chi tiết giao dịch On-Chain</h2>
            <p>{selectedActivity.detail}</p>
            <div className="evidence-row">
              <span>Loại giao dịch</span>
              <strong>{selectedActivity.type}</strong>
            </div>
            <div className="evidence-row">
              <span>Địa chỉ thực hiện</span>
              <strong className="mono">{shortAddr(selectedActivity.actor)}</strong>
            </div>
            <div className="evidence-row">
              <span>Khối lượng</span>
              <strong>{fmt(selectedActivity.amountKg, 3)} kg CO₂</strong>
            </div>
            <div className="evidence-row">
              <span>Block</span>
              <strong>#{selectedActivity.blockNumber.toString()}</strong>
            </div>
            <div className="evidence-row">
              <span>Tx Hash</span>
              <strong className="mono">{shortAddr(selectedActivity.txHash)}</strong>
            </div>
            {txUrl(selectedActivity.txHash) && (
              <a
                className="primary full"
                href={txUrl(selectedActivity.txHash)!}
                target="_blank"
                rel="noreferrer"
              >
                Kiểm chứng trên Snowtrace <ExternalLink size={16} />
              </a>
            )}
          </section>
        </div>
      )}

      {inspectedCert && (
        <div className="modal-backdrop" onClick={() => setInspectedCert(null)}>
          <section
            className="panel modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-label="On-Chain Metadata Inspector"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setInspectedCert(null)}
            >
              <X size={20} />
            </button>
            <Code2 size={28} className="lime" />
            <h2>On-Chain Metadata Inspector · NFT #{inspectedCert.id}</h2>
            <p>
              Toàn bộ JSON và đồ họa SVG dưới đây được đọc trực tiếp từ hàm{' '}
              <code>tokenURI({inspectedCert.id})</code> trên Smart Contract CarbonRegistry (không
              dùng server ngoài hay IPFS).
            </p>

            <div className="inspector-block">
              <div className="inspector-head">
                <span>Decoded ERC-721 JSON</span>
                <button
                  className="icon-button"
                  onClick={() => copyText(inspectedCert.rawJson, 'JSON metadata')}
                >
                  <Copy size={14} />
                </button>
              </div>
              <pre>{JSON.stringify(JSON.parse(inspectedCert.rawJson), null, 2)}</pre>
            </div>

            <div className="inspector-block">
              <div className="inspector-head">
                <span>Decoded On-Chain SVG Markup</span>
                <button
                  className="icon-button"
                  onClick={() => copyText(inspectedCert.svgMarkup, 'mã SVG')}
                >
                  <Copy size={14} />
                </button>
              </div>
              <pre>{inspectedCert.svgMarkup}</pre>
            </div>

            <div className="inspector-actions">
              <button className="secondary" onClick={() => downloadJson(inspectedCert)}>
                <Download size={15} /> Tải JSON
              </button>
              <button className="primary" onClick={() => downloadSvg(inspectedCert)}>
                <Download size={15} /> Tải SVG
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  icon: Icon,
  note,
  sub,
}: {
  label: string;
  value: string;
  unit: string;
  icon: typeof Leaf;
  note: string;
  sub: string;
}) {
  return (
    <section className="metric">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>
        <span>{note}</span>
        {sub}
      </p>
    </section>
  );
}

function OnChainChart({
  activity,
  totalMinted,
  totalRetired,
}: {
  activity: OnChainActivityItem[];
  totalMinted: number;
  totalRetired: number;
}) {
  const points = useMemo(() => {
    const asc = [...activity].reverse();
    let cumMinted = 0;
    let cumRetired = 0;
    const series: Array<{label: string; minted: number; retired: number}> = [
      {label: 'Khởi tạo', minted: 0, retired: 0},
    ];

    for (const item of asc) {
      if (item.type === 'Minted') cumMinted += item.amountKg;
      if (item.type === 'Retired') cumRetired += item.amountKg;
      if (item.type === 'Minted' || item.type === 'Retired') {
        series.push({
          label: item.timestamp
            ? new Date(item.timestamp * 1000).toLocaleTimeString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : `#${item.blockNumber.toString().slice(-4)}`,
          minted: cumMinted,
          retired: cumRetired,
        });
      }
    }

    if (series.length === 1 && (totalMinted > 0 || totalRetired > 0)) {
      series.push({label: 'Hiện tại', minted: totalMinted, retired: totalRetired});
    } else if (series.length === 1) {
      series.push({label: 'Hiện tại', minted: 0, retired: 0});
    }
    return series.slice(-10);
  }, [activity, totalMinted, totalRetired]);

  const maxVal = Math.max(
    100,
    totalMinted,
    totalRetired,
    ...points.map((p) => Math.max(p.minted, p.retired))
  );
  const ceil = Math.ceil(maxVal * 1.15);

  const toCoords = (key: 'minted' | 'retired') =>
    points.map((p, idx) => {
      const x = points.length === 1 ? 620 : Math.round((idx / (points.length - 1)) * 620);
      const y = Math.round(162 - (p[key] / ceil) * 148);
      return `${x} ${y}`;
    });

  const mintedCoords = toCoords('minted');
  const retiredCoords = toCoords('retired');
  const mintedPath = `M${mintedCoords.join(' L')}`;
  const areaPath = `${mintedPath} L620 175 L0 175 Z`;
  const retiredPath = `M${retiredCoords.join(' L')}`;
  const lastMintedY = mintedCoords[mintedCoords.length - 1]?.split(' ')[1] || '162';

  return (
    <div className="chart">
      <div className="chart-y">
        <span>{fmt(ceil, 0)}</span>
        <span>{fmt(Math.round((ceil * 2) / 3), 0)}</span>
        <span>{fmt(Math.round(ceil / 3), 0)}</span>
        <span>0</span>
      </div>
      <div className="chart-plot">
        <svg
          viewBox="0 0 620 175"
          preserveAspectRatio="none"
          role="img"
          aria-label="Biểu đồ sản lượng CO2 on-chain"
        >
          <defs>
            <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#a7df77" stopOpacity=".21" />
              <stop offset="100%" stopColor="#a7df77" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[14, 63, 112, 162].map((y) => (
            <line
              key={y}
              x1="0"
              x2="620"
              y1={y}
              y2={y}
              stroke="#26322e"
              strokeDasharray="3 5"
            />
          ))}
          <path d={areaPath} fill="url(#chartFill)" />
          <path d={mintedPath} fill="none" stroke="#b8ed88" strokeWidth="2.5" />
          <path
            d={retiredPath}
            fill="none"
            stroke="#4b9685"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
          <circle cx="620" cy={lastMintedY} r="4" fill="#c3f79a" />
        </svg>
        <div className="chart-x">
          {points.map((p, i) => (
            <span key={i}>{p.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SolarScene() {
  return (
    <div className="solar-scene" aria-hidden="true">
      <svg viewBox="0 0 650 390">
        <defs>
          <radialGradient id="halo">
            <stop offset="0" stopColor="#b7d684" stopOpacity=".19" />
            <stop offset="1" stopColor="#7eac62" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="roof" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#63816c" />
            <stop offset="1" stopColor="#2b493c" />
          </linearGradient>
          <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#608b94" />
            <stop offset=".5" stopColor="#294e61" />
            <stop offset="1" stopColor="#193b4c" />
          </linearGradient>
          <linearGradient id="wall">
            <stop stopColor="#a9b3a0" />
            <stop offset="1" stopColor="#647c69" />
          </linearGradient>
          <filter id="shadow">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>
        <circle cx="340" cy="180" r="210" fill="url(#halo)" />
        <g stroke="#60825f" fill="none" opacity=".25">
          <ellipse cx="345" cy="265" rx="260" ry="106" />
          <ellipse cx="345" cy="265" rx="210" ry="84" />
          <path d="M120 340 L565 150 M145 130 L575 330" strokeDasharray="3 7" />
        </g>
        <ellipse cx="355" cy="300" rx="185" ry="45" fill="#000" opacity=".4" filter="url(#shadow)" />
        <path d="M142 252 L350 157 L567 259 L358 365 Z" fill="#203c2b" stroke="#4b6a44" />
        <path d="M142 252 L358 354 L567 259 L567 274 L358 374 L142 268Z" fill="#182c24" />
        <path d="M224 215 L371 151 L480 214 L335 281 Z" fill="#c9d0b3" />
        <path d="M224 215 L335 274 L335 327 L224 267 Z" fill="url(#wall)" />
        <path d="M335 274 L480 208 L480 267 L335 327Z" fill="#748a75" />
        <path d="M205 214 L351 133 L497 207 L335 285Z" fill="url(#roof)" stroke="#99aa82" />
        <path d="M205 214 L335 279 L497 207 L497 214 L335 291 L205 221Z" fill="#3e5c4a" />
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3].map((col) => {
            const x = 237 + col * 32 + row * 27;
            const y = 208 - col * 17 + row * 14;
            return (
              <g key={`${row}${col}`}>
                <path
                  d={`M${x} ${y} l28 -15 25 13 -28 15Z`}
                  fill="url(#panel)"
                  stroke="#8aaeb1"
                  strokeWidth="1.2"
                />
                <path
                  d={`M${x + 9} ${y - 5} l25 13 m-16 -18 l25 13 m-31 -3 l28 -15`}
                  stroke="#8cb4bb"
                  strokeWidth=".45"
                  opacity=".8"
                />
              </g>
            );
          })
        )}
        <path d="M248 252 l22 12 v29 l-22 -12Z" fill="#344c40" stroke="#80947d" />
        <path d="M286 273 l21 11 v18 l-21 -11Z" fill="#749ea0" stroke="#c0c9af" />
        <path
          d="M353 281 l25 -12 v25 l-25 12Z M404 257 l25 -12 v25 l-25 12Z M446 237 l20 -10 v25 l-20 10Z"
          fill="#35535a"
          stroke="#b0bda5"
        />
        {[
          [178, 233],
          [513, 263],
          [467, 304],
        ].map(([x, y], i) => (
          <g key={i}>
            <path d={`M${x} ${y + 12} v-43`} stroke="#8d9a61" strokeWidth="5" />
            <path d={`M${x - 19} ${y - 19} l19 -48 20 48Z`} fill="#5b8150" />
            <path d={`M${x - 24} ${y - 3} l24 -48 25 48Z`} fill="#759455" />
            <path d={`M${x - 27} ${y + 9} l27 -42 28 42Z`} fill="#507044" />
          </g>
        ))}
        <g stroke="#c7e396" strokeWidth="1.3" fill="none">
          <circle cx="489" cy="99" r="19" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M489 70 v-7" transform={`rotate(${a} 489 99)`} />
          ))}
        </g>
        <path
          d="M474 128 L442 160 M489 138 L464 169"
          stroke="#bdd98c"
          opacity=".4"
          strokeDasharray="4 5"
        />
      </svg>
    </div>
  );
}
