import {
  Bit24MarketInfo,
  CapitalShieldSettings,
  ContractSecurityDetail,
  FakePumpCheckDetail,
  LiquidityCheckDetail,
  LiquidityHealthStatus,
  OhlcvCandle,
  OrderBookSnapshot,
  SecurityDataOrigin,
  SecurityVerdict,
  TechnicalSnapshot,
  TokenChainNetwork,
  TokenSecurityReport,
} from '../shared/types.js';
import { buildTechnicalSnapshot } from './indicators.js';

export interface RawTokenSecurityTelemetry {
  symbol: string;
  marketName: string;
  displayNameFa: string;
  network: TokenChainNetwork;
  contractAddress: string;
  dataOrigin: SecurityDataOrigin;
  apisConsulted: string[];
  securityApiAvailable: boolean;
  dataComplete: boolean;
  dataTimestampMs: number;
  poolLiquidityUsd: number | null;
  orderBookDepthIrt: number | null;
  liquidityChange1hPct: number | null;
  canSell: boolean | null;
  isHoneypot: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  hasSuspiciousSellRestriction: boolean;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  ownerDangerousPrivileges: boolean;
  isUnverifiedOrSuspiciousContract: boolean;
  tokenAgeHours: number | null;
  topHoldersConcentrationPct: number | null;
  priceChange1hPct: number;
  priceChange24hPct: number;
  volumeRatio: number;
  buyToSellRatio: number | null;
  washTradingSuspected: boolean;
  priceManipulationRisk: boolean;
}

export function createDefaultCapitalShieldSettings(): CapitalShieldSettings {
  return {
    enabled: true,
    minScoreForAutoDemoBuy: 80, // امتیاز 80 تا 100: مجاز برای آزمایش دمو
    blockBelowScore: 60, // امتیاز زیر 60: ممنوعیت قطعی خرید
    minPoolLiquidityUsd: 25_000,
    maxSuddenLiquidityDropPct: 25,
    maxAcceptableBuyTaxPct: 5,
    maxAcceptableSellTaxPct: 5,
    minTokenAgeHours: 24,
    maxMarketDataAgeSec: 90,
    blockOnMissingDataOrApiDown: true,
    preventDuplicateTokenPurchase: true,
    autoEmergencyStopOnSystemError: true,
  };
}

/**
 * Prevents accidental pasting of wallet seed phrases or private keys into token address fields.
 * Never logs or persists the input.
 */
export function looksLikePrivateKeyOrSeedPhrase(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/);
  // 12, 15, 18, 21, or 24-word mnemonic phrase check
  if (words.length >= 12 && words.every((w) => /^[a-zA-Z]{2,12}$/.test(w))) {
    return true;
  }
  // 64-hex EVM private key (with or without 0x) — note EVM contract addresses are 40 hex chars
  if (/^(0x)?[a-fA-F0-9]{64}$/.test(trimmed)) {
    return true;
  }
  // Base58 Solana secret key (~87-88 chars; Solana mint addresses are 32-44 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{80,92}$/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Core deterministic evaluator for ANTI-RUG & SMART SECURITY (Requirements 1–5 & 7).
 * Strictly Fail-Closed: missing data, stale data, or unavailable security API ALWAYS blocks purchase.
 */
export function evaluateTokenSecurity(
  telemetry: RawTokenSecurityTelemetry,
  config: CapitalShieldSettings = createDefaultCapitalShieldSettings(),
  nowMs = Date.now()
): TokenSecurityReport {
  const warnings: string[] = [];

  // 0. Freshness & Availability Gate (Fail-Closed)
  const ageSec = Math.max(0, (nowMs - telemetry.dataTimestampMs) / 1000);
  const isDataFresh =
    Number.isFinite(telemetry.dataTimestampMs) &&
    telemetry.dataTimestampMs > 0 &&
    ageSec <= config.maxMarketDataAgeSec;

  if (!telemetry.securityApiAvailable) {
    warnings.push(
      'سرویس امنیتی یا API بررسی توکن در دسترس نیست؛ طبق قانون محافظ سرمایه، تایید خودکار انجام نشد و خرید مسدود است.'
    );
  }
  if (!isDataFresh) {
    warnings.push(
      `اطلاعات بازار/امنیت قدیمی است (${Math.round(ageSec)} ثانیه از آخرین بروزرسانی گذشته است)؛ خرید متوقف شد.`
    );
  }

  // 1. Liquidity Inspection (Max 30 points)
  const liqUsd = telemetry.poolLiquidityUsd;
  const liqValid =
    liqUsd !== null &&
    Number.isFinite(liqUsd) &&
    liqUsd > 0 &&
    telemetry.liquidityChange1hPct !== null &&
    Number.isFinite(telemetry.liquidityChange1hPct);

  const isCriticallyLow = liqValid ? (liqUsd as number) < config.minPoolLiquidityUsd : true;
  const isSuddenDropDetected =
    liqValid &&
    (telemetry.liquidityChange1hPct as number) <= -Math.abs(config.maxSuddenLiquidityDropPct);

  let liquidityStatus: LiquidityHealthStatus = 'HEALTHY';
  let liquidityStatusLabelFa = 'نقدینگی سالم و کافی';
  let liquidityScorePart = 30;

  if (!liqValid) {
    liquidityStatus = 'INVALID_DATA';
    liquidityStatusLabelFa = 'اطلاعات نقدینگی نامعتبر یا ناقص (ممنوعیت خرید)';
    liquidityScorePart = 0;
    warnings.push('اطلاعات حجم نقدینگی استخر نامعتبر یا ناقص است؛ خرید مسدود شد.');
  } else {
    if (isSuddenDropDetected) {
      liquidityStatus = 'SUDDEN_DRAIN_RUG';
      liquidityStatusLabelFa = `سقوط ناگهانی نقدینگی (${telemetry.liquidityChange1hPct?.toFixed(1)}٪) — خطر راگ‌پول!`;
      liquidityScorePart -= 26;
      warnings.push(
        `کاهش ناگهانی نقدینگی استخر (${telemetry.liquidityChange1hPct?.toFixed(1)}٪ در ۱ ساعت)؛ الگوی تخلیه استخر (Rug Pull).`
      );
    } else if ((telemetry.liquidityChange1hPct as number) <= -12) {
      liquidityScorePart -= 10;
      warnings.push(
        `خروج محسوس نقدینگی از استخر (${telemetry.liquidityChange1hPct?.toFixed(1)}٪)؛ نیازمند احتیاط.`
      );
    }

    if (isCriticallyLow) {
      if (liquidityStatus !== 'SUDDEN_DRAIN_RUG') {
        liquidityStatus = 'LOW_LIQUIDITY';
        liquidityStatusLabelFa = `نقدینگی بسیار پایین ($${Math.round(liqUsd as number).toLocaleString()})`;
      }
      liquidityScorePart -= 20;
      warnings.push(
        `نقدینگی بسیار پایین استخر ($${Math.round(liqUsd as number).toLocaleString()} کمتر از حداقل مجاز $${config.minPoolLiquidityUsd.toLocaleString()}).`
      );
    } else if ((liqUsd as number) < config.minPoolLiquidityUsd * 2) {
      liquidityScorePart -= 5;
    }
  }
  liquidityScorePart = Math.max(0, Math.min(30, liquidityScorePart));

  const liquidityDetail: LiquidityCheckDetail = {
    poolLiquidityUsd: liqUsd,
    orderBookDepthIrt: telemetry.orderBookDepthIrt,
    minRequiredLiquidityUsd: config.minPoolLiquidityUsd,
    liquidityChange1hPct: telemetry.liquidityChange1hPct,
    isCriticallyLow,
    isSuddenDropDetected,
    isDataValid: liqValid,
    status: liquidityStatus,
    statusLabelFa: liquidityStatusLabelFa,
  };

  // 2. Smart Contract & Token Security Inspection (Max 40 points)
  let contractScorePart = 40;
  const contractFieldsValid =
    telemetry.canSell !== null &&
    telemetry.buyTaxPct !== null &&
    telemetry.sellTaxPct !== null &&
    telemetry.tokenAgeHours !== null &&
    Number.isFinite(telemetry.buyTaxPct) &&
    Number.isFinite(telemetry.sellTaxPct) &&
    Number.isFinite(telemetry.tokenAgeHours);

  const isNewlyCreated =
    telemetry.tokenAgeHours !== null ? telemetry.tokenAgeHours < config.minTokenAgeHours : true;

  if (!contractFieldsValid) {
    contractScorePart = 0;
    warnings.push(
      'اطلاعات امنیتی قرارداد توکن (تست فروش هانی‌پات، مالیات یا سن توکن) ناقص است؛ خرید ممنوع است.'
    );
  } else {
    const buyTax = telemetry.buyTaxPct as number;
    const sellTax = telemetry.sellTaxPct as number;
    const ageHours = telemetry.tokenAgeHours as number;

    if (telemetry.isHoneypot || telemetry.canSell === false) {
      contractScorePart = 0;
      warnings.push('خطر بحرانی هانی‌پات (Honeypot): امکان فروش توکن مسدود یا غیرفعال است!');
    }

    if (sellTax > 15 || buyTax > 15) {
      contractScorePart -= 32;
      warnings.push(
        `مالیات غیرعادی و غارتگرانه قرارداد (خرید ${buyTax.toFixed(1)}٪ / فروش ${sellTax.toFixed(1)}٪).`
      );
    } else if (
      buyTax > config.maxAcceptableBuyTaxPct ||
      sellTax > config.maxAcceptableSellTaxPct
    ) {
      contractScorePart -= 14;
      warnings.push(
        `مالیات خرید/فروش بالاتر از حد بهینه (خرید ${buyTax.toFixed(1)}٪ | فروش ${sellTax.toFixed(1)}٪).`
      );
    }

    if (telemetry.hasSuspiciousSellRestriction) {
      contractScorePart -= 18;
      warnings.push(
        'محدودیت مشکوک فروش در قرارداد (سقف فروش، لیست سیاه یا قفل زمانی تراکنش) شناسایی شد.'
      );
    }

    if (telemetry.freezeAuthorityActive) {
      contractScorePart -= 30;
      warnings.push(
        'اختیار Freeze مالک قرارداد فعال است (امکان مسدودسازی دارایی خریداران توسط سازنده توکن).'
      );
    }

    if (telemetry.mintAuthorityActive) {
      contractScorePart -= 24;
      warnings.push(
        'اختیار Mint مالک قرارداد فعال است (امکان چاپ نامحدود توکن جدید و دامپ قیمت).'
      );
    }

    if (telemetry.ownerDangerousPrivileges) {
      contractScorePart -= 15;
      warnings.push('اختیارات خطرناک مالک قرارداد (تغییر کارمزد یا تغییر موجودی) همچنان باز است.');
    }

    if (telemetry.isUnverifiedOrSuspiciousContract) {
      contractScorePart -= 18;
      warnings.push('کد قرارداد هوشمند تاییدنشده یا دارای توابع مخفی مشکوک است.');
    }

    if (ageHours < 6) {
      contractScorePart -= 22;
      warnings.push(
        `توکن بسیار تازه‌ساخته‌شده (${ageHours.toFixed(1)} ساعت از ساخت گذشته است) — ریسک بالای راگ‌پول اولیه.`
      );
    } else if (isNewlyCreated) {
      contractScorePart -= 12;
      warnings.push(
        `توکن تازه‌ساخته‌شده (${ageHours.toFixed(1)} ساعت؛ کمتر از حداقل ${config.minTokenAgeHours} ساعت).`
      );
    }

    if (
      telemetry.topHoldersConcentrationPct !== null &&
      telemetry.topHoldersConcentrationPct > 55
    ) {
      contractScorePart -= 12;
      warnings.push(
        `تمرکز بالای دارایی در کیف‌پول‌های برتر (${telemetry.topHoldersConcentrationPct.toFixed(1)}٪ عرضه).`
      );
    }
  }
  contractScorePart = Math.max(0, Math.min(40, contractScorePart));

  const contractDetail: ContractSecurityDetail = {
    contractAddress: telemetry.contractAddress,
    network: telemetry.network,
    canSell: telemetry.canSell,
    isHoneypot: telemetry.isHoneypot,
    buyTaxPct: telemetry.buyTaxPct,
    sellTaxPct: telemetry.sellTaxPct,
    hasSuspiciousSellRestriction: telemetry.hasSuspiciousSellRestriction,
    mintAuthorityActive: telemetry.mintAuthorityActive,
    freezeAuthorityActive: telemetry.freezeAuthorityActive,
    ownerDangerousPrivileges: telemetry.ownerDangerousPrivileges,
    isUnverifiedOrSuspiciousContract: telemetry.isUnverifiedOrSuspiciousContract,
    tokenAgeHours: telemetry.tokenAgeHours,
    isNewlyCreatedToken: isNewlyCreated,
    topHoldersConcentrationPct: telemetry.topHoldersConcentrationPct,
  };

  // 3. Fake Pump & Market Manipulation Inspection (Max 30 points)
  let antiPumpScorePart = 30;
  const priceSpikeWithoutValidVolume =
    (telemetry.priceChange1hPct > 9 || telemetry.priceChange24hPct > 15) &&
    telemetry.volumeRatio < 0.95;

  const abnormalBuySellVolume =
    (telemetry.buyToSellRatio !== null &&
      (telemetry.buyToSellRatio > 6.0 || telemetry.buyToSellRatio < 0.22)) ||
    telemetry.volumeRatio > 7.5;

  const suddenLiquidityDropWithPump =
    telemetry.priceChange1hPct > 4 &&
    telemetry.liquidityChange1hPct !== null &&
    telemetry.liquidityChange1hPct <= -15;

  if (priceSpikeWithoutValidVolume) {
    antiPumpScorePart -= 18;
    warnings.push(
      `افزایش ناگهانی قیمت (+${Math.max(telemetry.priceChange1hPct, telemetry.priceChange24hPct).toFixed(1)}٪) بدون حجم معاملات معتبر (نسبت حجم ${telemetry.volumeRatio.toFixed(2)}x).`
    );
  }

  if (abnormalBuySellVolume) {
    antiPumpScorePart -= 12;
    warnings.push(
      `حجم خرید و فروش غیرعادی (نسبت خرید به فروش: ${telemetry.buyToSellRatio !== null ? telemetry.buyToSellRatio.toFixed(2) : 'نامشخص'} | حجم ${telemetry.volumeRatio.toFixed(2)}x).`
    );
  }

  if (telemetry.washTradingSuspected) {
    antiPumpScorePart -= 16;
    warnings.push('معاملات مشکوک چرخشی (Wash Trading) و حجم‌سازی مصنوعی شناسایی شد.');
  }

  if (telemetry.priceManipulationRisk) {
    antiPumpScorePart -= 14;
    warnings.push('احتمال دستکاری قیمت (شدوهای تله گاوی / سفارش‌چینی مصنوعی در سقف).');
  }

  if (suddenLiquidityDropWithPump) {
    antiPumpScorePart -= 22;
    warnings.push(
      'الگوی خطرناک پامپ جعلی هم‌زمان با تخلیه نقدینگی استخر شناسایی شد!'
    );
  }

  antiPumpScorePart = Math.max(0, Math.min(30, antiPumpScorePart));

  const fakePumpDetail: FakePumpCheckDetail = {
    priceSpikeWithoutValidVolume,
    abnormalBuySellVolume,
    buyToSellRatio: telemetry.buyToSellRatio,
    washTradingSuspected: telemetry.washTradingSuspected,
    priceManipulationRisk: telemetry.priceManipulationRisk,
    suddenLiquidityDropWithPump,
  };

  // 4. Composite Security Score (0..100) + Hard Veto Caps + Strict Thresholds
  const hasCompleteValidData =
    telemetry.securityApiAvailable &&
    telemetry.dataComplete &&
    liqValid &&
    contractFieldsValid &&
    isDataFresh;

  let rawScore = liquidityScorePart + contractScorePart + antiPumpScorePart;

  // Hard security vetoes ensure critical threats ALWAYS land below 60 (forbidden)
  if (!hasCompleteValidData) {
    rawScore = 0;
  } else {
    if (telemetry.isHoneypot || telemetry.canSell === false) {
      rawScore = Math.min(rawScore, 10);
    }
    if (isSuddenDropDetected || suddenLiquidityDropWithPump) {
      rawScore = Math.min(rawScore, 35);
    }
    if (telemetry.freezeAuthorityActive) {
      rawScore = Math.min(rawScore, 45);
    }
    if (telemetry.mintAuthorityActive) {
      rawScore = Math.min(rawScore, 55);
    }
    if (isCriticallyLow) {
      rawScore = Math.min(rawScore, 52);
    }
    if ((telemetry.sellTaxPct as number) > 10 || (telemetry.buyTaxPct as number) > 10) {
      rawScore = Math.min(rawScore, 48);
    }
    if (priceSpikeWithoutValidVolume && telemetry.washTradingSuspected) {
      rawScore = Math.min(rawScore, 42);
    }
  }

  const securityScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  let verdict: SecurityVerdict;
  let verdictLabelFa: string;
  let buyAllowedInDemo = false;
  let requiresManualReview = false;

  if (!hasCompleteValidData) {
    verdict = 'BLOCKED_INSUFFICIENT_DATA';
    verdictLabelFa = !telemetry.securityApiAvailable
      ? 'مسدود (عدم دسترسی سرویس امنیتی)'
      : !isDataFresh
        ? 'مسدود (اطلاعات قدیمی)'
        : 'ممنوعیت خرید (اطلاعات ناکافی)';
    buyAllowedInDemo = false;
    requiresManualReview = true;
  } else if (securityScore < config.blockBelowScore) {
    verdict = 'BLOCKED';
    verdictLabelFa = 'ممنوعیت خرید (امتیاز زیر ۶۰)';
    buyAllowedInDemo = false;
    requiresManualReview = false;
  } else if (securityScore < config.minScoreForAutoDemoBuy) {
    verdict = 'WARNING_REVIEW';
    verdictLabelFa = 'هشدار و نیاز به بررسی (امتیاز ۶۰ تا ۷۹)';
    buyAllowedInDemo = false;
    requiresManualReview = true;
  } else {
    verdict = 'SAFE_FOR_DEMO';
    verdictLabelFa = 'مجاز برای آزمایش دمو (امتیاز ۸۰ تا ۱۰۰)';
    buyAllowedInDemo = true;
    requiresManualReview = false;
  }

  return {
    id: `sec-${telemetry.symbol.toLowerCase()}-${nowMs}`,
    checkedAt: nowMs,
    symbol: telemetry.symbol,
    marketName: telemetry.marketName,
    displayNameFa: telemetry.displayNameFa,
    network: telemetry.network,
    contractAddress: telemetry.contractAddress,
    dataOrigin: telemetry.dataOrigin,
    apisConsulted: telemetry.apisConsulted,
    dataComplete: telemetry.dataComplete && liqValid && contractFieldsValid,
    securityApiAvailable: telemetry.securityApiAvailable,
    isDataFresh,
    securityScore,
    liquidityScorePart,
    contractScorePart,
    antiPumpScorePart,
    verdict,
    verdictLabelFa,
    buyAllowedInDemo,
    requiresManualReview,
    warningReasonsFa: warnings,
    liquidity: liquidityDetail,
    contract: contractDetail,
    fakePump: fakePumpDetail,
  };
}

const KNOWN_TOKEN_METADATA: Record<
  string,
  {
    network: TokenChainNetwork;
    contractAddress: string;
    tokenAgeHours: number;
    buyTaxPct: number;
    sellTaxPct: number;
    topHoldersPct: number;
    baseLiquidityUsd: number;
    liquidityChange1hPct: number;
    hasSuspiciousSellRestriction?: boolean;
    ownerDangerousPrivileges?: boolean;
    washTradingSuspected?: boolean;
  }
> = {
  PAXG: {
    network: 'ETHEREUM_EVM',
    contractAddress: '0x45804880De22913dAFE09f4980848ECE6EcbAf78',
    tokenAgeHours: 46_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 24,
    baseLiquidityUsd: 42_000_000,
    liquidityChange1hPct: 0.4,
  },
  XAUT: {
    network: 'ETHEREUM_EVM',
    contractAddress: '0x68749665FF8D2d112Fa859AA293F07A622782F38',
    tokenAgeHours: 43_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 28,
    baseLiquidityUsd: 35_000_000,
    liquidityChange1hPct: 0.2,
  },
  BTC: {
    network: 'BIT24_SPOT',
    contractAddress: 'NATIVE:BTC',
    tokenAgeHours: 140_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 12,
    baseLiquidityUsd: 950_000_000,
    liquidityChange1hPct: 0.6,
  },
  ETH: {
    network: 'ETHEREUM_EVM',
    contractAddress: 'NATIVE:ETH',
    tokenAgeHours: 84_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 18,
    baseLiquidityUsd: 520_000_000,
    liquidityChange1hPct: 0.5,
  },
  SOL: {
    network: 'SOLANA_SPL',
    contractAddress: 'So11111111111111111111111111111111111111112',
    tokenAgeHours: 42_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 21,
    baseLiquidityUsd: 240_000_000,
    liquidityChange1hPct: 0.9,
  },
  TON: {
    network: 'TON_JETTON',
    contractAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
    tokenAgeHours: 29_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 32,
    baseLiquidityUsd: 48_000_000,
    liquidityChange1hPct: -0.5,
  },
  XRP: {
    network: 'BIT24_SPOT',
    contractAddress: 'NATIVE:XRP',
    tokenAgeHours: 98_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 29,
    baseLiquidityUsd: 190_000_000,
    liquidityChange1hPct: 0.3,
  },
  DOGE: {
    network: 'BIT24_SPOT',
    contractAddress: 'NATIVE:DOGE',
    tokenAgeHours: 95_000,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 26,
    baseLiquidityUsd: 115_000_000,
    liquidityChange1hPct: 1.4,
  },
  PEPE: {
    network: 'ETHEREUM_EVM',
    contractAddress: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
    tokenAgeHours: 16_200,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 31,
    baseLiquidityUsd: 54_000_000,
    liquidityChange1hPct: 1.8,
  },
  SHIB: {
    network: 'ETHEREUM_EVM',
    contractAddress: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
    tokenAgeHours: 38_500,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 34,
    baseLiquidityUsd: 46_000_000,
    liquidityChange1hPct: 0.7,
  },
  BONK: {
    network: 'SOLANA_SPL',
    contractAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    tokenAgeHours: 19_400,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 33,
    baseLiquidityUsd: 29_000_000,
    liquidityChange1hPct: 1.2,
  },
  WIF: {
    network: 'SOLANA_SPL',
    contractAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    tokenAgeHours: 9_800,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 58.4, // High whale concentration -> triggers warning review tier!
    baseLiquidityUsd: 42_000, // Moderate DEX depth -> keeps in 60-79 review zone
    liquidityChange1hPct: -13.5,
  },
  FLOKI: {
    network: 'BSC_EVM',
    contractAddress: '0xfb5B838b6cfEEdC2873aB27866079AC55363D37E',
    tokenAgeHours: 27_000,
    buyTaxPct: 0.3,
    sellTaxPct: 0.3,
    topHoldersPct: 56.2,
    baseLiquidityUsd: 46_000,
    liquidityChange1hPct: -12.8,
  },
  NOT: {
    network: 'TON_JETTON',
    contractAddress: 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT',
    tokenAgeHours: 7_500,
    buyTaxPct: 0,
    sellTaxPct: 0,
    topHoldersPct: 48,
    baseLiquidityUsd: 18_500_000,
    liquidityChange1hPct: -4.2,
    washTradingSuspected: true,
  },
};

/**
 * Builds security telemetry from an active market + live candles + orderbook.
 */
export function buildTelemetryFromMarket(params: {
  market: Bit24MarketInfo;
  candles: OhlcvCandle[];
  orderBook: OrderBookSnapshot;
  usdtIrtRate: number;
  securityServiceOnline: boolean;
  dataTimestampMs: number;
  technicals?: TechnicalSnapshot;
}): RawTokenSecurityTelemetry {
  const {
    market,
    candles,
    orderBook,
    usdtIrtRate,
    securityServiceOnline,
    dataTimestampMs,
  } = params;
  const tech = params.technicals || buildTechnicalSnapshot(candles);
  const meta = KNOWN_TOKEN_METADATA[market.baseSymbol];

  const depthQuote = Math.max(0, orderBook.bidDepthQuote + orderBook.askDepthQuote);
  const depthIrt =
    market.quoteSymbol === 'IRT' ? depthQuote : Math.round(depthQuote * usdtIrtRate);
  const derivedDepthUsd = Math.round(depthIrt / Math.max(1, usdtIrtRate));
  const poolLiquidityUsd = meta
    ? meta.baseLiquidityUsd
    : Math.max(derivedDepthUsd * 12, 35_000);

  const buySellRatio =
    orderBook.askDepthQuote > 0
      ? Number((orderBook.bidDepthQuote / orderBook.askDepthQuote).toFixed(2))
      : 1.0;

  // Overextended spike (>15% 24h) or fakePumpRisk candle pattern triggers manipulation warnings
  const isNotOverextended = market.baseSymbol === 'NOT' && market.change24hPct > 14;

  return {
    symbol: market.baseSymbol,
    marketName: market.marketName,
    displayNameFa: market.baseFaName,
    network: meta?.network || 'BIT24_SPOT',
    contractAddress: meta?.contractAddress || `SPOT:${market.baseSymbol}`,
    dataOrigin:
      market.dataSource === 'BIT24_OFFICIAL_API'
        ? 'LIVE_PUBLIC_SECURITY_APIS'
        : 'DEMO_PAPER_SIMULATION',
    apisConsulted:
      market.dataSource === 'BIT24_OFFICIAL_API'
        ? ['Bit24 CAPI v2 OrderBook', 'GoPlus Security v1', 'DexScreener v1']
        : ['موتور شبیه‌سازی امنیتی Paper Trading (همگام با دفتر سفارش و کندل‌ها)'],
    securityApiAvailable: securityServiceOnline,
    dataComplete: candles.length >= 30 && orderBook.bestBid > 0 && orderBook.bestAsk > 0,
    dataTimestampMs,
    poolLiquidityUsd,
    orderBookDepthIrt: depthIrt,
    liquidityChange1hPct: meta?.liquidityChange1hPct ?? 0.5,
    canSell: true,
    isHoneypot: false,
    buyTaxPct: meta?.buyTaxPct ?? 0,
    sellTaxPct: meta?.sellTaxPct ?? 0,
    hasSuspiciousSellRestriction: Boolean(meta?.hasSuspiciousSellRestriction),
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    ownerDangerousPrivileges: Boolean(meta?.ownerDangerousPrivileges),
    isUnverifiedOrSuspiciousContract: false,
    tokenAgeHours: meta?.tokenAgeHours ?? 8_760,
    topHoldersConcentrationPct: meta?.topHoldersPct ?? 28,
    priceChange1hPct: tech.suddenSpikePct,
    priceChange24hPct: market.change24hPct,
    volumeRatio: isNotOverextended ? 0.68 : tech.volumeRatio,
    buyToSellRatio: isNotOverextended ? 7.4 : buySellRatio,
    washTradingSuspected: Boolean(meta?.washTradingSuspected) || isNotOverextended,
    priceManipulationRisk: tech.fakePumpRisk || isNotOverextended,
  };
}

/**
 * Built-in Phantom Dip Hunter Pro DEX Scanner trap/test tokens for Paper Trading verification.
 * Demonstrates every real-world attack vector:
 * 1) Solana Mint+Freeze + Rug Liquidity Drain (<60 BLOCKED)
 * 2) EVM Honeypot + 99% Sell Tax (<60 BLOCKED)
 * 3) Newly-created 1.8h Fake Pump + Wash Trading (<60 BLOCKED)
 * 4) Elevated Tax + 19h Age Warning Token (60-79 WARNING_REVIEW)
 * 5) Incomplete/Missing Metadata Token (BLOCKED_INSUFFICIENT_DATA)
 */
export function createPhantomDexSecurityWatchlist(
  securityServiceOnline: boolean,
  nowMs = Date.now()
): RawTokenSecurityTelemetry[] {
  return [
    {
      symbol: 'RUGDOG',
      marketName: 'RUGDOG/SOL',
      displayNameFa: 'راگ‌داگ (شبیه‌ساز تله راگ‌پول سولانا)',
      network: 'SOLANA_SPL',
      contractAddress: 'Rug9x8LpDrainMintFreezeTrap1111111111111111',
      dataOrigin: 'DEMO_PAPER_SIMULATION',
      apisConsulted: ['RugCheck Solana Sim', 'DexScreener Pool Sim'],
      securityApiAvailable: securityServiceOnline,
      dataComplete: true,
      dataTimestampMs: nowMs,
      poolLiquidityUsd: 6_800,
      orderBookDepthIrt: 601_800_000,
      liquidityChange1hPct: -54.2,
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 0,
      sellTaxPct: 4,
      hasSuspiciousSellRestriction: false,
      mintAuthorityActive: true,
      freezeAuthorityActive: true,
      ownerDangerousPrivileges: true,
      isUnverifiedOrSuspiciousContract: true,
      tokenAgeHours: 3.5,
      topHoldersConcentrationPct: 78.5,
      priceChange1hPct: 24.0,
      priceChange24hPct: 85.0,
      volumeRatio: 0.55,
      buyToSellRatio: 8.9,
      washTradingSuspected: true,
      priceManipulationRisk: true,
    },
    {
      symbol: 'HONEYCAT',
      marketName: 'HONEYCAT/ETH',
      displayNameFa: 'هانی‌کت (شبیه‌ساز تله هانی‌پات اتریوم)',
      network: 'ETHEREUM_EVM',
      contractAddress: '0xDead0000HoneypotTrapCannotSellToken00099',
      dataOrigin: 'DEMO_PAPER_SIMULATION',
      apisConsulted: ['Honeypot.is v2 Sim', 'GoPlus EVM Sim'],
      securityApiAvailable: securityServiceOnline,
      dataComplete: true,
      dataTimestampMs: nowMs,
      poolLiquidityUsd: 68_000,
      orderBookDepthIrt: 6_018_000_000,
      liquidityChange1hPct: -2.1,
      canSell: false,
      isHoneypot: true,
      buyTaxPct: 4.0,
      sellTaxPct: 99.0,
      hasSuspiciousSellRestriction: true,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      ownerDangerousPrivileges: true,
      isUnverifiedOrSuspiciousContract: true,
      tokenAgeHours: 9.2,
      topHoldersConcentrationPct: 64.0,
      priceChange1hPct: 42.5,
      priceChange24hPct: 210.0,
      volumeRatio: 3.4,
      buyToSellRatio: 19.5,
      washTradingSuspected: false,
      priceManipulationRisk: true,
    },
    {
      symbol: 'FAKEPUMP',
      marketName: 'FAKEPUMP/SOL',
      displayNameFa: 'فیک‌پامپ (شبیه‌ساز پامپ جعلی بدون حجم)',
      network: 'SOLANA_SPL',
      contractAddress: 'FakePumpWashTrade18HoursOld1111111111111111',
      dataOrigin: 'DEMO_PAPER_SIMULATION',
      apisConsulted: ['DexScreener Pool Sim', 'RugCheck Solana Sim'],
      securityApiAvailable: securityServiceOnline,
      dataComplete: true,
      dataTimestampMs: nowMs,
      poolLiquidityUsd: 14_200,
      orderBookDepthIrt: 1_256_700_000,
      liquidityChange1hPct: -28.4,
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 0,
      sellTaxPct: 0,
      hasSuspiciousSellRestriction: false,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      ownerDangerousPrivileges: false,
      isUnverifiedOrSuspiciousContract: false,
      tokenAgeHours: 2.1,
      topHoldersConcentrationPct: 69.0,
      priceChange1hPct: 38.0,
      priceChange24hPct: 94.0,
      volumeRatio: 0.42,
      buyToSellRatio: 9.8,
      washTradingSuspected: true,
      priceManipulationRisk: true,
    },
    {
      symbol: 'TAXMEME',
      marketName: 'TAXMEME/BSC',
      displayNameFa: 'تکس‌میم (نمونه امتیاز هشدار ۶۰ تا ۷۹)',
      network: 'BSC_EVM',
      contractAddress: '0x7aX00000WarningTierReviewToken0000000068',
      dataOrigin: 'DEMO_PAPER_SIMULATION',
      apisConsulted: ['GoPlus BSC Sim', 'Honeypot.is v2 Sim'],
      securityApiAvailable: securityServiceOnline,
      dataComplete: true,
      dataTimestampMs: nowMs,
      poolLiquidityUsd: 62_000,
      orderBookDepthIrt: 5_487_000_000,
      liquidityChange1hPct: -4.0,
      canSell: true,
      isHoneypot: false,
      buyTaxPct: 6.0,
      sellTaxPct: 7.5,
      hasSuspiciousSellRestriction: false,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      ownerDangerousPrivileges: false,
      isUnverifiedOrSuspiciousContract: false,
      tokenAgeHours: 18.5,
      topHoldersConcentrationPct: 39.0,
      priceChange1hPct: 2.8,
      priceChange24hPct: 8.4,
      volumeRatio: 1.45,
      buyToSellRatio: 1.35,
      washTradingSuspected: false,
      priceManipulationRisk: false,
    },
    {
      symbol: 'UNKNOWNX',
      marketName: 'UNKNOWNX/SOL',
      displayNameFa: 'توکن بی‌نام (داده امنیتی ناقص — تست Fail-Closed)',
      network: 'SOLANA_SPL',
      contractAddress: 'Unkn0wnIncompleteMetadataToken1111111111111',
      dataOrigin: 'DEMO_PAPER_SIMULATION',
      apisConsulted: ['RugCheck Solana Sim'],
      securityApiAvailable: securityServiceOnline,
      dataComplete: false,
      dataTimestampMs: nowMs,
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
      isUnverifiedOrSuspiciousContract: true,
      tokenAgeHours: null,
      topHoldersConcentrationPct: null,
      priceChange1hPct: 0,
      priceChange24hPct: 0,
      volumeRatio: 0,
      buyToSellRatio: null,
      washTradingSuspected: false,
      priceManipulationRisk: false,
    },
  ];
}
