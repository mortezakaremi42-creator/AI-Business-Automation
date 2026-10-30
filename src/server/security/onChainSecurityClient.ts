import {
  CapitalShieldSettings,
  TokenChainNetwork,
  TokenSecurityReport,
} from '../../shared/types.js';
import {
  createDefaultCapitalShieldSettings,
  evaluateTokenSecurity,
  looksLikePrivateKeyOrSeedPhrase,
  RawTokenSecurityTelemetry,
} from '../../core/antiRugEngine.js';

const FETCH_TIMEOUT_MS = 5_500;

async function fetchJsonWithTimeout(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function detectContractNetwork(
  address: string,
  preferredChain?: 'SOLANA_SPL' | 'ETHEREUM_EVM' | 'BSC_EVM'
): TokenChainNetwork {
  if (preferredChain) return preferredChain;
  const trimmed = address.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return 'ETHEREUM_EVM';
  }
  return 'SOLANA_SPL';
}

/**
 * Queries real, keyless, read-only public token security APIs:
 * - DexScreener (/latest/dex/tokens/{address}) for pool liquidity, volume & tx buy/sell counts
 * - GoPlus Security v1 (/api/v1/token_security/{chainId} or /solana/token_security)
 * - RugCheck.xyz v1 (/v1/tokens/{mint}/report/summary) for Solana Mint/Freeze/Rug risks
 * - Honeypot.is v2 (/v2/IsHoneypot) for EVM sell simulation & buy/sell tax
 *
 * Strictly FAIL-CLOSED: if APIs are unreachable or return incomplete security data,
 * returns score = 0 and blocks buying rather than assuming safety.
 */
export async function inspectTokenContractLive(params: {
  contractAddress: string;
  network?: 'SOLANA_SPL' | 'ETHEREUM_EVM' | 'BSC_EVM';
  config?: CapitalShieldSettings;
}): Promise<TokenSecurityReport> {
  const rawAddress = (params.contractAddress || '').trim();
  if (looksLikePrivateKeyOrSeedPhrase(rawAddress)) {
    throw new Error(
      'مسدودسازی امنیتی: هرگز کلید خصوصی یا عبارت بازیابی کیف‌پول (Seed Phrase) وارد نکنید! فقط آدرس عمومی قرارداد توکن مجاز است.'
    );
  }
  if (rawAddress.length < 26 || rawAddress.length > 68) {
    throw new Error(
      'آدرس قرارداد توکن معتبر نیست (آدرس EVM با 0x و ۴۲ کاراکتر یا آدرس Mint سولانا وارد نمایید).'
    );
  }

  const network = detectContractNetwork(rawAddress, params.network);
  const config = params.config || createDefaultCapitalShieldSettings();
  const apisConsulted: string[] = [];

  // 1. DexScreener Liquidity & Trading Activity
  const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(rawAddress)}`;
  const dexPromise = fetchJsonWithTimeout(dexUrl);

  // 2. Chain-specific Security APIs
  const isEvm = network === 'ETHEREUM_EVM' || network === 'BSC_EVM';
  const chainId = network === 'BSC_EVM' ? '56' : '1';

  const goPlusUrl = isEvm
    ? `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${encodeURIComponent(rawAddress.toLowerCase())}`
    : `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(rawAddress)}`;

  const secondaryUrl = isEvm
    ? `https://api.honeypot.is/v2/IsHoneypot?address=${encodeURIComponent(rawAddress)}`
    : `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(rawAddress)}/report/summary`;

  const [dexJson, goPlusJson, secondaryJson] = await Promise.all([
    dexPromise,
    fetchJsonWithTimeout(goPlusUrl),
    fetchJsonWithTimeout(secondaryUrl),
  ]);

  if (dexJson) apisConsulted.push('DexScreener API v1');
  if (goPlusJson) apisConsulted.push('GoPlus Security API v1');
  if (secondaryJson) {
    apisConsulted.push(isEvm ? 'Honeypot.is API v2' : 'RugCheck.xyz Solana API v1');
  }

  // FAIL-CLOSED when no external security API could be reached
  if (apisConsulted.length === 0) {
    const offlineTelemetry: RawTokenSecurityTelemetry = {
      symbol: rawAddress.slice(0, 6).toUpperCase(),
      marketName: `${rawAddress.slice(0, 6).toUpperCase()}/${network === 'SOLANA_SPL' ? 'SOL' : 'USDT'}`,
      displayNameFa: `توکن بررسی‌شده (${rawAddress.slice(0, 8)}…)`,
      network,
      contractAddress: rawAddress,
      dataOrigin: 'FAIL_CLOSED_OFFLINE',
      apisConsulted: [],
      securityApiAvailable: false,
      dataComplete: false,
      dataTimestampMs: Date.now(),
      poolLiquidityUsd: null,
      orderBookDepthIrt: null,
      liquidityChange1hPct: null,
      canSell: null,
      isHoneypot: false,
      buyTaxPct: null,
      sellTaxPct: null,
      hasSuspiciousSellRestriction: false,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      ownerDangerousPrivileges: false,
      isUnverifiedOrSuspiciousContract: false,
      tokenAgeHours: null,
      topHoldersConcentrationPct: null,
      priceChange1hPct: 0,
      priceChange24hPct: 0,
      volumeRatio: 0,
      buyToSellRatio: null,
      washTradingSuspected: false,
      priceManipulationRisk: false,
    };
    return evaluateTokenSecurity(offlineTelemetry, config);
  }

  // Parse best DexScreener pair
  const pairs: any[] = Array.isArray(dexJson?.pairs) ? dexJson.pairs : [];
  pairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  const bestPair = pairs[0] || null;

  const symbol = String(bestPair?.baseToken?.symbol || rawAddress.slice(0, 6)).toUpperCase();
  const tokenName = String(bestPair?.baseToken?.name || symbol);
  const quoteSym = String(bestPair?.quoteToken?.symbol || (isEvm ? 'USDT' : 'SOL')).toUpperCase();
  const poolLiquidityUsd =
    bestPair?.liquidity?.usd !== undefined ? Number(bestPair.liquidity.usd) : null;
  const priceChange1hPct = Number(bestPair?.priceChange?.h1 || 0);
  const priceChange24hPct = Number(bestPair?.priceChange?.h24 || 0);
  const buys24h = Number(bestPair?.txns?.h24?.buys || 0);
  const sells24h = Number(bestPair?.txns?.h24?.sells || 0);
  const buyToSellRatio =
    buys24h + sells24h > 0 ? Number((buys24h / Math.max(1, sells24h)).toFixed(2)) : null;
  const vol24hUsd = Number(bestPair?.volume?.h24 || 0);
  const volumeRatio =
    poolLiquidityUsd && poolLiquidityUsd > 0
      ? Number(Math.min(12, vol24hUsd / poolLiquidityUsd).toFixed(2))
      : 1.0;

  const tokenAgeHours =
    bestPair?.pairCreatedAt && Number(bestPair.pairCreatedAt) > 0
      ? Number(((Date.now() - Number(bestPair.pairCreatedAt)) / 3_600_000).toFixed(1))
      : null;

  // Parse GoPlus & Secondary (Honeypot.is / RugCheck)
  let canSell: boolean | null = null;
  let isHoneypot = false;
  let buyTaxPct: number | null = null;
  let sellTaxPct: number | null = null;
  let hasSuspiciousSellRestriction = false;
  let mintAuthorityActive = false;
  let freezeAuthorityActive = false;
  let ownerDangerousPrivileges = false;
  let isUnverifiedOrSuspiciousContract = false;
  let topHoldersPct: number | null = null;

  if (isEvm) {
    const gpMap = goPlusJson?.result || {};
    const gpEntry = gpMap[rawAddress.toLowerCase()] || gpMap[rawAddress] || null;
    if (gpEntry) {
      isHoneypot = gpEntry.is_honeypot === '1';
      canSell = !isHoneypot && gpEntry.cannot_sell_all !== '1';
      buyTaxPct = gpEntry.buy_tax !== undefined ? Number(gpEntry.buy_tax) * 100 : 0;
      sellTaxPct = gpEntry.sell_tax !== undefined ? Number(gpEntry.sell_tax) * 100 : 0;
      hasSuspiciousSellRestriction =
        gpEntry.cannot_sell_all === '1' ||
        gpEntry.transfer_pausable === '1' ||
        gpEntry.trading_cooldown === '1' ||
        gpEntry.is_blacklisted === '1';
      mintAuthorityActive = gpEntry.is_mintable === '1';
      freezeAuthorityActive = gpEntry.transfer_pausable === '1' || gpEntry.is_blacklisted === '1';
      ownerDangerousPrivileges =
        gpEntry.owner_change_balance === '1' ||
        gpEntry.can_take_back_ownership === '1' ||
        gpEntry.slippage_modifiable === '1';
      isUnverifiedOrSuspiciousContract =
        gpEntry.is_open_source === '0' || gpEntry.hidden_owner === '1';
      if (Array.isArray(gpEntry.holders)) {
        topHoldersPct = Number(
          gpEntry.holders
            .slice(0, 10)
            .reduce((acc: number, h: any) => acc + Number(h?.percent || 0) * 100, 0)
            .toFixed(1)
        );
      }
    }

    if (secondaryJson?.honeypotResult) {
      if (secondaryJson.honeypotResult.isHoneypot) {
        isHoneypot = true;
        canSell = false;
      } else if (canSell === null) {
        canSell = true;
      }
      if (secondaryJson.simulationResult) {
        buyTaxPct = Number(secondaryJson.simulationResult.buyTax ?? buyTaxPct ?? 0);
        sellTaxPct = Number(secondaryJson.simulationResult.sellTax ?? sellTaxPct ?? 0);
      }
    }
  } else {
    // Solana SPL parsing (GoPlus Solana + RugCheck)
    const gpMap = goPlusJson?.result || {};
    const gpSol = gpMap[rawAddress] || null;
    if (gpSol) {
      mintAuthorityActive = gpSol.mintable?.status === '1';
      freezeAuthorityActive =
        gpSol.closable?.status === '1' || gpSol.balance_mutable_authority?.status === '1';
      canSell = gpSol.non_transferable !== '1';
      buyTaxPct = 0;
      sellTaxPct =
        gpSol.transfer_fee?.current_fee_rate !== undefined
          ? Number(gpSol.transfer_fee.current_fee_rate) * 100
          : 0;
    }

    if (secondaryJson) {
      if (secondaryJson.rugged === true) {
        isHoneypot = true;
        canSell = false;
      } else if (canSell === null) {
        canSell = true;
      }
      if (secondaryJson.mintAuthority) mintAuthorityActive = true;
      if (secondaryJson.freezeAuthority) freezeAuthorityActive = true;
      if (buyTaxPct === null) buyTaxPct = 0;
      if (sellTaxPct === null) sellTaxPct = Number(secondaryJson.transferFee?.pct || 0);
      const risks: any[] = Array.isArray(secondaryJson.risks) ? secondaryJson.risks : [];
      if (risks.some((r) => String(r?.level || '').toLowerCase() === 'danger')) {
        ownerDangerousPrivileges = true;
      }
    }
  }

  const dataComplete =
    poolLiquidityUsd !== null &&
    canSell !== null &&
    buyTaxPct !== null &&
    sellTaxPct !== null &&
    tokenAgeHours !== null;

  const liveTelemetry: RawTokenSecurityTelemetry = {
    symbol,
    marketName: `${symbol}/${quoteSym}`,
    displayNameFa: `${tokenName} (${symbol})`,
    network,
    contractAddress: rawAddress,
    dataOrigin: 'LIVE_PUBLIC_SECURITY_APIS',
    apisConsulted,
    securityApiAvailable: true,
    dataComplete,
    dataTimestampMs: Date.now(),
    poolLiquidityUsd,
    orderBookDepthIrt: null,
    liquidityChange1hPct: priceChange1hPct < -25 ? -30 : 0,
    canSell,
    isHoneypot,
    buyTaxPct,
    sellTaxPct,
    hasSuspiciousSellRestriction,
    mintAuthorityActive,
    freezeAuthorityActive,
    ownerDangerousPrivileges,
    isUnverifiedOrSuspiciousContract,
    tokenAgeHours,
    topHoldersConcentrationPct: topHoldersPct,
    priceChange1hPct,
    priceChange24hPct,
    volumeRatio,
    buyToSellRatio,
    washTradingSuspected: vol24hUsd > (poolLiquidityUsd || 1) * 15,
    priceManipulationRisk: Math.abs(priceChange1hPct) > 35 && (poolLiquidityUsd || 0) < 20_000,
  };

  return evaluateTokenSecurity(liveTelemetry, config);
}
