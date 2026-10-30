import {
  ClosedTradeRecord,
  ManagedPosition,
  ModuleId,
  ModuleRiskSettings,
  PlatformSettings,
  QuoteCurrency,
} from '../shared/types.js';
import { createDefaultCapitalShieldSettings } from './antiRugEngine.js';
import { smartRoundMarketPrice } from './marketSimulator.js';

export function createDefaultPlatformSettings(): PlatformSettings {
  return {
    environmentMode: 'PAPER',
    liveTradingConfirmedThisSession: false, // ALWAYS false on boot/restart per security rule!
    pauseNewTrades: false,
    dailyMaxLossPct: 2.0, // Stage 5: توقف معاملات جدید پس از رسیدن زیان روزانه به ۲ درصد
    maxTotalOpenRiskPct: 2.0, // Stage 5: حداکثر ریسک مجموع موقعیت‌های باز: ۲ درصد سرمایه تخصیص‌یافته
    maxTotalOpenPositions: 3, // Stage 5: حداکثر سه موقعیت باز هم‌زمان
    bit24VipFeePct: 0.2, // Official Bit24 VIP-0 Maker/Taker fee = 0.2%
    maxAllowedSpreadPct: 0.45,
    minNetRiskReward: 1.75,
    usdtIrtReference: 88_500,
    antiRugConfig: createDefaultCapitalShieldSettings(),
    modules: {
      DIGITAL_GOLD: {
        enabled: true,
        risk: {
          allocatedCapitalIrt: 50_000_000, // ۵۰ میلیون تومان سرمایه مستقل طلا
          allocatedCapitalUsdt: 565,
          quotePreference: 'IRT',
          riskPerTradePct: 0.5, // Stage 5 default: حداکثر ۰٫۵ درصد سرمایه تخصیص‌یافته
          stopLossPct: 1.35,
          takeProfit1Pct: 1.9,
          takeProfit2Pct: 3.4,
          trailingStopPct: 0.85,
          useSteppedTakeProfit: true,
          useTrailingStop: true,
          earlyExitOnTrendWeakness: true,
          maxOpenPositions: 2,
          allowLossAveragingDca: false,
        },
      },
      SPOT_CRYPTO: {
        enabled: true,
        risk: {
          allocatedCapitalIrt: 50_000_000, // ۵۰ میلیون تومان سرمایه مستقل رمزارز اسپات
          allocatedCapitalUsdt: 565,
          quotePreference: 'IRT',
          riskPerTradePct: 0.5, // Stage 5 default: حداکثر ۰٫۵ درصد سرمایه تخصیص‌یافته
          stopLossPct: 1.9,
          takeProfit1Pct: 2.6,
          takeProfit2Pct: 4.8,
          trailingStopPct: 1.15,
          useSteppedTakeProfit: true,
          useTrailingStop: true,
          earlyExitOnTrendWeakness: true,
          maxOpenPositions: 2,
          allowLossAveragingDca: false,
        },
      },
      MEME_HUNTER: {
        enabled: true,
        risk: {
          allocatedCapitalIrt: 30_000_000, // ۳۰ میلیون تومان بودجه مجزای میم‌کوین اسپات
          allocatedCapitalUsdt: 340,
          quotePreference: 'IRT',
          riskPerTradePct: 0.5, // Stage 5 default: حداکثر ۰٫۵ درصد سرمایه تخصیص‌یافته
          stopLossPct: 2.6,
          takeProfit1Pct: 4.2,
          takeProfit2Pct: 8.8,
          trailingStopPct: 1.5,
          useSteppedTakeProfit: true,
          useTrailingStop: true,
          earlyExitOnTrendWeakness: true,
          maxOpenPositions: 1,
          allowLossAveragingDca: false,
        },
      },
      LEVERAGE_MARGIN: {
        enabled: false, // Stage 5: عدم استفاده از اهرم و فیوچرز در نسخه اول (پیش‌فرض خاموش)
        userAcknowledgedLeverageRisk: false,
        risk: {
          allocatedCapitalIrt: 25_000_000,
          allocatedCapitalUsdt: 280,
          quotePreference: 'IRT',
          riskPerTradePct: 0.5,
          stopLossPct: 1.4,
          takeProfit1Pct: 2.2,
          takeProfit2Pct: 3.8,
          trailingStopPct: 0.9,
          useSteppedTakeProfit: true,
          useTrailingStop: true,
          earlyExitOnTrendWeakness: true,
          maxOpenPositions: 1,
          allowLossAveragingDca: false,
          maxLeverage: 2,
        },
      },
    },
  };
}

export interface PositionSizingResult {
  allowed: boolean;
  reasonFa?: string;
  notionalQuote: number;
  collateralQuote: number;
  quantityBase: number;
  maxRiskQuote: number;
}

/**
 * Computes current worst-case open risk across all open positions (in IRT)
 * if every active position hits its current stopLoss (including exit fee).
 */
export function computeTotalOpenPositionsRiskIrt(
  openPositions: ManagedPosition[],
  feePctPerSide: number,
  usdtIrtRate: number
): number {
  const safeUsdt = Math.max(1000, usdtIrtRate);
  let sumIrt = 0;

  for (const pos of openPositions) {
    const isLong = pos.side === 'LONG';
    const rawStopLossPerUnit = isLong
      ? Math.max(0, pos.entryPrice - pos.stopLoss)
      : Math.max(0, pos.stopLoss - pos.entryPrice);
    const feeQuote = pos.quantity * pos.entryPrice * ((feePctPerSide * 2) / 100);
    const worstLossQuote = Math.max(
      0,
      pos.quantity * rawStopLossPerUnit + feeQuote - Math.max(0, pos.realizedPartPnlQuote)
    );
    sumIrt += pos.quoteSymbol === 'IRT' ? worstLossQuote : worstLossQuote * safeUsdt;
  }

  return Math.round(sumIrt);
}

/**
 * Calculates strict risk-based position size enforcing ALL Stage 5 constraints:
 * 1. Worst-case loss at Stop-Loss (including round-trip fee + slippage buffer) <= riskPerTradePct (default 0.5%)
 * 2. Cumulative open-position risk <= maxTotalOpenRiskPct (default 2.0% of allocated capital)
 * 3. Global concurrent open positions <= maxTotalOpenPositions (default 3)
 * 4. Module concurrent open positions <= riskSettings.maxOpenPositions
 * 5. Daily max loss circuit breaker (default 2.0%)
 * 6. Zero loss-averaging DCA on existing open symbols
 */
export function calculateSafePositionSize(params: {
  module: ModuleId;
  marketName: string;
  quoteSymbol: QuoteCurrency;
  entryPrice: number;
  stopLossPrice: number;
  leverage?: number;
  minOrderQuote: number;
  feePctPerSide: number;
  riskSettings: ModuleRiskSettings;
  openModulePositions: ManagedPosition[];
  allOpenPositions?: ManagedPosition[];
  maxTotalOpenPositions?: number;
  maxTotalOpenRiskPct?: number;
  engagedModuleCapitalIrt: number;
  usdtIrtRate: number;
  dailyTotalPnlIrt: number;
  totalAllocatedIrt: number;
  dailyMaxLossPct: number;
}): PositionSizingResult {
  const {
    marketName,
    quoteSymbol,
    entryPrice,
    stopLossPrice,
    leverage = 1,
    minOrderQuote,
    feePctPerSide,
    riskSettings,
    openModulePositions,
    allOpenPositions = openModulePositions,
    maxTotalOpenPositions = 3,
    maxTotalOpenRiskPct = 2.0,
    engagedModuleCapitalIrt,
    usdtIrtRate,
    dailyTotalPnlIrt,
    totalAllocatedIrt,
    dailyMaxLossPct,
  } = params;

  // 1. Daily Max Loss Circuit Breaker (2%)
  if (isDailyLossLimitReached(dailyTotalPnlIrt, totalAllocatedIrt, dailyMaxLossPct)) {
    return {
      allowed: false,
      reasonFa: `قفل سقف زیان روزانه (${dailyMaxLossPct}٪) فعال شده است؛ ثبت معامله جدید تا ریست روزانه متوقف شد.`,
      notionalQuote: 0,
      collateralQuote: 0,
      quantityBase: 0,
      maxRiskQuote: 0,
    };
  }

  // 2. Global concurrent open positions cap (Stage 5: max 3 positions simultaneously)
  if (allOpenPositions.length >= maxTotalOpenPositions) {
    return {
      allowed: false,
      reasonFa: `حداکثر تعداد کل موقعیت‌های باز هم‌زمان سیستم (${maxTotalOpenPositions} معامله) تکمیل است.`,
      notionalQuote: 0,
      collateralQuote: 0,
      quantityBase: 0,
      maxRiskQuote: 0,
    };
  }

  // 3. Ban on unlimited DCA / loss-averaging on an already open symbol
  const existingSameMarket = allOpenPositions.find((p) => p.marketName === marketName);
  if (existingSameMarket) {
    return {
      allowed: false,
      reasonFa: `موقعیت باز روی ${marketName} وجود دارد؛ طبق قانون مدیریت ریسک، خرید پله‌ای جبران ضرر (Martingale/DCA) ممنوع است.`,
      notionalQuote: 0,
      collateralQuote: 0,
      quantityBase: 0,
      maxRiskQuote: 0,
    };
  }

  // 4. Max concurrent open positions in this module
  if (openModulePositions.length >= riskSettings.maxOpenPositions) {
    return {
      allowed: false,
      reasonFa: `حداکثر تعداد معاملات باز هم‌زمان این بخش (${riskSettings.maxOpenPositions}) تکمیل است.`,
      notionalQuote: 0,
      collateralQuote: 0,
      quantityBase: 0,
      maxRiskQuote: 0,
    };
  }

  // 5. Clamp riskPerTradePct strictly between 0.15% and 1.5% (default 0.5%)
  const clampedRiskPct = Math.max(0.15, Math.min(1.5, riskSettings.riskPerTradePct));
  const safeUsdtRate = Math.max(1000, usdtIrtRate);

  const moduleCapitalQuote =
    quoteSymbol === 'IRT'
      ? riskSettings.allocatedCapitalIrt
      : riskSettings.allocatedCapitalIrt / safeUsdtRate;

  const engagedQuote =
    quoteSymbol === 'IRT'
      ? engagedModuleCapitalIrt
      : engagedModuleCapitalIrt / safeUsdtRate;

  const freeCapitalQuote = Math.max(0, moduleCapitalQuote - engagedQuote);
  const maxRiskQuote = moduleCapitalQuote * (clampedRiskPct / 100);

  // 6. Total Open Portfolio Risk Cap (Stage 5: <= 2.0% of totalAllocatedIrt)
  const existingOpenRiskIrt = computeTotalOpenPositionsRiskIrt(
    allOpenPositions,
    feePctPerSide,
    safeUsdtRate
  );
  const candidateRiskIrt =
    quoteSymbol === 'IRT' ? maxRiskQuote : maxRiskQuote * safeUsdtRate;
  const maxTotalRiskBudgetIrt =
    totalAllocatedIrt * (Math.max(0.5, maxTotalOpenRiskPct) / 100);

  if (existingOpenRiskIrt + candidateRiskIrt > maxTotalRiskBudgetIrt * 1.02) {
    return {
      allowed: false,
      reasonFa: `حداکثر ریسک مجموع موقعیت‌های باز (${maxTotalOpenRiskPct}٪ کل سرمایه) پر شده است؛ تا کاهش ریسک معاملات فعلی، ورود جدید متوقف است.`,
      notionalQuote: 0,
      collateralQuote: 0,
      quantityBase: 0,
      maxRiskQuote,
    };
  }

  const stopDistanceFraction = Math.max(
    0.004,
    Math.abs(entryPrice - stopLossPrice) / Math.max(entryPrice, 1e-8)
  );
  const roundTripFeeAndSlippageFraction = (feePctPerSide * 2 + 0.08) / 100;
  const totalUnitLossFraction = stopDistanceFraction + roundTripFeeAndSlippageFraction;

  const riskBasedNotional = maxRiskQuote / totalUnitLossFraction;

  // Never allocate more than 45% of module capital collateral in a single trade
  const safeLeverage = Math.max(1, Math.min(3, leverage));
  const maxCollateralAllowed = Math.min(freeCapitalQuote, moduleCapitalQuote * 0.45);
  const maxNotionalByCapital = maxCollateralAllowed * safeLeverage;

  const finalNotionalQuote = Math.min(riskBasedNotional, maxNotionalByCapital);
  const collateralQuote = finalNotionalQuote / safeLeverage;

  if (finalNotionalQuote < minOrderQuote || entryPrice <= 0) {
    return {
      allowed: false,
      reasonFa: `حجم مجاز بر اساس ریسک ${clampedRiskPct}٪ کمتر از حداقل سفارش بازار بیت‌۲۴ (${minOrderQuote.toLocaleString('fa-IR')}) است.`,
      notionalQuote: 0,
      collateralQuote: 0,
      quantityBase: 0,
      maxRiskQuote,
    };
  }

  const quantityBase = Number((finalNotionalQuote / entryPrice).toFixed(6));

  return {
    allowed: true,
    notionalQuote:
      quoteSymbol === 'IRT'
        ? Math.round(finalNotionalQuote)
        : Number(finalNotionalQuote.toFixed(2)),
    collateralQuote:
      quoteSymbol === 'IRT'
        ? Math.round(collateralQuote)
        : Number(collateralQuote.toFixed(2)),
    quantityBase,
    maxRiskQuote:
      quoteSymbol === 'IRT' ? Math.round(maxRiskQuote) : Number(maxRiskQuote.toFixed(2)),
  };
}

export function isDailyLossLimitReached(
  dailyTotalPnlIrt: number,
  totalAllocatedIrt: number,
  dailyMaxLossPct: number
): boolean {
  if (totalAllocatedIrt <= 0) return false;
  const maxAllowedLossIrt = totalAllocatedIrt * (Math.max(0.5, dailyMaxLossPct) / 100);
  return dailyTotalPnlIrt <= -maxAllowedLossIrt;
}

/**
 * Updates an open position with new market price:
 * - Simulates realistic spread/slippage on Paper stop-loss execution (never assumes zero-slippage magic fill!)
 * - Evaluates Stepped Take-Profit 1 (50% partial exit + move SL to break-even + fee buffer)
 * - Updates Trailing Stop
 * - Triggers full exit on TP2, Trailing Stop, or Stop-Loss
 */
export function stepPositionLifecycle(params: {
  position: ManagedPosition;
  newPrice: number;
  feePctPerSide: number;
  useSteppedTakeProfit: boolean;
  useTrailingStop: boolean;
}): {
  updated: ManagedPosition;
  closedRecord: ClosedTradeRecord | null;
  partialRealizedEventFa: string | null;
} {
  const { position, newPrice, feePctPerSide, useSteppedTakeProfit, useTrailingStop } = params;
  const pos: ManagedPosition = { ...position, currentPrice: newPrice };
  let partialRealizedEventFa: string | null = null;

  const isLong = pos.side === 'LONG';
  if (newPrice > pos.highestPrice) pos.highestPrice = newPrice;
  if (newPrice < pos.lowestPrice) pos.lowestPrice = newPrice;

  // 1. Stepped Take-Profit 1 (50% partial exit + move SL to break-even)
  const hitTp1 = isLong ? newPrice >= pos.takeProfit1 : newPrice <= pos.takeProfit1;
  if (useSteppedTakeProfit && !pos.tp1Hit && hitTp1 && pos.quantity > 0) {
    const sellQty = Number((pos.quantity * 0.5).toFixed(6));
    const grossPartProceeds = sellQty * newPrice;
    const partCost = sellQty * pos.entryPrice;
    const exitFee = grossPartProceeds * (feePctPerSide / 100);
    const partNetPnl =
      (isLong ? grossPartProceeds - partCost : partCost - grossPartProceeds) - exitFee;

    pos.quantity = Number((pos.quantity - sellQty).toFixed(6));
    pos.notionalQuote = pos.quantity * pos.entryPrice;
    pos.collateralQuote = pos.notionalQuote / Math.max(1, pos.leverage);
    pos.paidFeesQuote += exitFee;
    pos.realizedPartPnlQuote += partNetPnl;
    pos.tp1Hit = true;
    pos.trailingActive = useTrailingStop;

    const feeBuffer = (feePctPerSide * 2.2) / 100;
    pos.stopLoss = isLong
      ? roundByQuote(pos.entryPrice * (1 + feeBuffer), pos.quoteSymbol)
      : roundByQuote(pos.entryPrice * (1 - feeBuffer), pos.quoteSymbol);

    partialRealizedEventFa = `پله اول سود (TP1) در ${pos.marketName} فعال شد: ۵۰٪ حجم با سود تسویه و حد ضرر به نقطه سربه‌سر منتقل شد.`;
  }

  // 2. Trailing Stop Ratchet
  if (useTrailingStop && (pos.tp1Hit || pos.trailingActive)) {
    const delta = Math.max(0.35, pos.trailingDeltaPct) / 100;
    if (isLong) {
      const candidateSl = roundByQuote(pos.highestPrice * (1 - delta), pos.quoteSymbol);
      if (candidateSl > pos.stopLoss) {
        pos.stopLoss = candidateSl;
        pos.trailingActive = true;
      }
    } else {
      const candidateSl = roundByQuote(pos.lowestPrice * (1 + delta), pos.quoteSymbol);
      if (candidateSl < pos.stopLoss) {
        pos.stopLoss = candidateSl;
        pos.trailingActive = true;
      }
    }
  }

  // Compute live unrealized PnL on remaining quantity
  const remEntryValue = pos.quantity * pos.entryPrice;
  const remCurrentValue = pos.quantity * newPrice;
  const estimatedExitFee = remCurrentValue * (feePctPerSide / 100);
  const rawDiff = isLong ? remCurrentValue - remEntryValue : remEntryValue - remCurrentValue;
  pos.unrealizedPnlQuote = Number((rawDiff - estimatedExitFee).toFixed(2));
  const initialBasis = Math.max(
    1,
    (pos.initialQuantity * pos.entryPrice) / Math.max(1, pos.leverage)
  );
  pos.unrealizedPnlPct = Number(
    (((pos.realizedPartPnlQuote + pos.unrealizedPnlQuote) / initialBasis) * 100).toFixed(2)
  );

  // 3. Check Full Exit Conditions: TP2 or Stop-Loss / Trailing-Stop
  const hitTp2 = isLong ? newPrice >= pos.takeProfit2 : newPrice <= pos.takeProfit2;
  const hitStop = isLong ? newPrice <= pos.stopLoss : newPrice >= pos.stopLoss;

  if (hitTp2 || hitStop) {
    // Stage 5 & 7: Stop-Loss does not guarantee exact price; apply realistic 0.08% adverse slippage on Paper stop fills
    const slSlippageFactor =
      hitStop && pos.mode === 'PAPER' ? (isLong ? 0.9992 : 1.0008) : 1;
    const effectiveExitPrice = roundByQuote(newPrice * slSlippageFactor, pos.quoteSymbol);
    const remExitValue = pos.quantity * effectiveExitPrice;
    const exitFee = remExitValue * (feePctPerSide / 100);
    const exitRawDiff = isLong ? remExitValue - remEntryValue : remEntryValue - remExitValue;
    const totalFees = pos.paidFeesQuote + exitFee;
    const totalNetPnl = pos.realizedPartPnlQuote + (exitRawDiff - exitFee);
    const netPnlPct = Number(((totalNetPnl / initialBasis) * 100).toFixed(2));

    let exitReason: ClosedTradeRecord['exitReason'] = 'STOP_LOSS';
    let exitReasonFa = 'خروج خودکار با فعال شدن حد ضرر (با احتساب اسلیپیج واقعی بازار)';

    if (hitTp2) {
      exitReason = 'TP2_TARGET';
      exitReasonFa = 'رسیدن به هدف سود نهایی (TP2) و تسویه کامل';
    } else if (pos.trailingActive || pos.tp1Hit) {
      exitReason = 'TRAILING_STOP';
      exitReasonFa = 'قفل سود با فعال شدن حد ضرر متحرک (Trailing Stop)';
    }

    const closedRecord: ClosedTradeRecord = {
      id: `closed-${pos.id}-${Date.now()}`,
      bit24OrderId: pos.bit24OrderId,
      isConfirmedLiveFill: pos.mode === 'LIVE' && Boolean(pos.bit24OrderId),
      module: pos.module,
      mode: pos.mode,
      marketName: pos.marketName,
      baseSymbol: pos.baseSymbol,
      quoteSymbol: pos.quoteSymbol,
      side: pos.side,
      leverage: pos.leverage,
      entryPrice: pos.entryPrice,
      exitPrice: effectiveExitPrice,
      quantity: pos.initialQuantity,
      notionalQuote: pos.initialQuantity * pos.entryPrice,
      feesPaidQuote: roundByQuote(totalFees, pos.quoteSymbol),
      netPnlQuote: roundByQuote(totalNetPnl, pos.quoteSymbol),
      netPnlPct,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
      exitReason,
      exitReasonFa,
    };

    return { updated: pos, closedRecord, partialRealizedEventFa };
  }

  return { updated: pos, closedRecord: null, partialRealizedEventFa };
}

function roundByQuote(value: number, quote: QuoteCurrency): number {
  return smartRoundMarketPrice(value, quote);
}
