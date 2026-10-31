import {
  ActivePosition,
  Bit24TickerMarket,
  CapitalRiskConfig,
  ExitStrategyConfig,
  OrderBookDepth,
  TradeRejectionLog,
} from '../shared/contracts.js';
import { roundIrtPrice } from './bit24Catalog.js';

export const DEFAULT_CAPITAL_RISK_CONFIG: CapitalRiskConfig = {
  initialDemoBalanceIrt: 100_000_000, // ۱۰۰ میلیون تومان موجودی آزمایشی پیش‌فرض قابل تغییر
  riskPerTradePct: 1, // ۱٪ ریسک کل سرمایه در هر معامله
  maxCapitalPerTradePct: 10, // حداکثر ۱۰٪ سرمایه در هر معامله
  maxConcurrentTrades: 3, // حداکثر ۳ معامله هم‌زمان
  maxDailyLossPct: 3, // حداکثر ۳٪ ضرر روزانه
  autoStopOnDailyLoss: true,
  neverUseFullCapitalInSingleTrade: true,
};

export const DEFAULT_EXIT_STRATEGY_CONFIG: ExitStrategyConfig = {
  initialStopLossPct: 5, // حد ضرر اولیه: ۵٪
  trailingActivationProfitPct: 8, // فعال‌سازی Trailing Stop پس از ۸٪ سود
  trailingDistanceFromPeakPct: 3, // فاصله ۳٪ از بالاترین قیمت ثبت‌شده
  tpStage1ProfitPct: 10,
  tpStage1SellRatioPct: 30, // فروش ۳۰٪ در +۱۰٪ سود
  tpStage2ProfitPct: 20,
  tpStage2SellRatioPct: 30, // فروش ۳۰٪ در +۲۰٪ سود
  tpStage3ProfitPct: 35,
  tpStage3SellRatioPct: 40, // فروش ۴۰٪ باقی‌مانده در +۳۵٪ سود
};

export function sanitizeCapitalRiskConfig(
  incoming: Partial<CapitalRiskConfig>,
  current: CapitalRiskConfig = DEFAULT_CAPITAL_RISK_CONFIG
): CapitalRiskConfig {
  const merged = { ...current, ...incoming };
  return {
    initialDemoBalanceIrt: Math.max(5_000_000, Math.round(Number(merged.initialDemoBalanceIrt) || 100_000_000)),
    riskPerTradePct: Math.min(5, Math.max(0.2, Number(merged.riskPerTradePct) || 1)),
    // Hard invariant: NEVER allow 100% of capital in one trade (clamped strictly <= 35%)
    maxCapitalPerTradePct: Math.min(35, Math.max(1, Number(merged.maxCapitalPerTradePct) || 10)),
    maxConcurrentTrades: Math.min(10, Math.max(1, Math.round(Number(merged.maxConcurrentTrades) || 3))),
    maxDailyLossPct: Math.min(15, Math.max(0.5, Number(merged.maxDailyLossPct) || 3)),
    autoStopOnDailyLoss: Boolean(merged.autoStopOnDailyLoss),
    neverUseFullCapitalInSingleTrade: true,
  };
}

export function sanitizeExitStrategyConfig(
  incoming: Partial<ExitStrategyConfig>,
  current: ExitStrategyConfig = DEFAULT_EXIT_STRATEGY_CONFIG
): ExitStrategyConfig {
  const merged = { ...current, ...incoming };
  const s1Ratio = Math.min(60, Math.max(10, Math.round(Number(merged.tpStage1SellRatioPct) || 30)));
  const s2Ratio = Math.min(60, Math.max(10, Math.round(Number(merged.tpStage2SellRatioPct) || 30)));
  const s3Ratio = Math.max(10, 100 - s1Ratio - s2Ratio);

  return {
    initialStopLossPct: Math.min(15, Math.max(1, Number(merged.initialStopLossPct) || 5)),
    trailingActivationProfitPct: Math.min(
      30,
      Math.max(2, Number(merged.trailingActivationProfitPct) || 8)
    ),
    trailingDistanceFromPeakPct: Math.min(
      12,
      Math.max(0.8, Number(merged.trailingDistanceFromPeakPct) || 3)
    ),
    tpStage1ProfitPct: Math.min(50, Math.max(2, Number(merged.tpStage1ProfitPct) || 10)),
    tpStage1SellRatioPct: s1Ratio,
    tpStage2ProfitPct: Math.min(80, Math.max(4, Number(merged.tpStage2ProfitPct) || 20)),
    tpStage2SellRatioPct: s2Ratio,
    tpStage3ProfitPct: Math.min(150, Math.max(8, Number(merged.tpStage3ProfitPct) || 35)),
    tpStage3SellRatioPct: s3Ratio,
  };
}

/**
 * Calculates safe position capital in IRT obeying BOTH:
 * 1) Risk-based cap: totalEquity * (riskPerTradePct / 100) / (stopLossPct / 100)
 * 2) Allocation cap: totalEquity * (maxCapitalPerTradePct / 100)
 * 3) Available cash reserve (never 100% of available balance)
 */
export function calculateSafePositionCapitalIrt(params: {
  totalEquityIrt: number;
  availableCashIrt: number;
  stopLossPct: number;
  capitalConfig: CapitalRiskConfig;
}): number {
  const { totalEquityIrt, availableCashIrt, stopLossPct, capitalConfig } = params;
  if (totalEquityIrt <= 0 || availableCashIrt <= 0) return 0;

  const maxRiskBudgetIrt = totalEquityIrt * (capitalConfig.riskPerTradePct / 100);
  const stopFraction = Math.max(0.01, stopLossPct / 100);
  const riskBasedNotionalIrt = maxRiskBudgetIrt / stopFraction;

  // Hard cap: maxCapitalPerTradePct (default 10%), strictly < 100%
  const hardCapFraction = Math.min(0.35, capitalConfig.maxCapitalPerTradePct / 100);
  const allocationCapIrt = totalEquityIrt * hardCapFraction;

  // Never consume 100% of cash even when cash is small (keep >= 5% cash buffer)
  const cashSafetyCapIrt = availableCashIrt * 0.92;

  return Math.floor(Math.min(riskBasedNotionalIrt, allocationCapIrt, cashSafetyCapIrt));
}

export interface SecurityCheckInput {
  nowMs: number;
  symbol: string;
  mode: 'DEMO' | 'LIVE';
  market: Bit24TickerMarket;
  orderBook: OrderBookDepth;
  openPositions: ActivePosition[];
  inFlightSymbols: Set<string>;
  dailyLossPctSoFar: number;
  capitalConfig: CapitalRiskConfig;
  emergencyStopped: boolean;
  apiDisconnectedFault: boolean;
  consecutiveTradeErrors: number;
  pumpAndDumpRisk: boolean;
  alreadyOverPumped: boolean;
  atrPct: number;
}

export interface SecurityCheckResult {
  allowed: boolean;
  rejection?: TradeRejectionLog;
}

export function runSmartSecurityGate(input: SecurityCheckInput): SecurityCheckResult {
  const fail = (
    code: TradeRejectionLog['code'],
    reasonFa: string,
    reasonEn: string
  ): SecurityCheckResult => ({
    allowed: false,
    rejection: {
      id: `rej-${input.nowMs}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: input.nowMs,
      symbol: input.symbol,
      code,
      reasonFa,
      reasonEn,
    },
  });

  if (input.emergencyStopped) {
    return fail(
      'EMERGENCY_STOP_ACTIVE',
      'توقف اضطراری (EMERGENCY STOP) فعال است؛ کلیه خریدها مسدود شده‌اند.',
      'EMERGENCY STOP is active; all new buy orders are blocked.'
    );
  }

  if (input.apiDisconnectedFault) {
    return fail(
      'API_DISCONNECTED',
      'ارتباط با شبکه / API صرافی Bit24 قطع است؛ توقف ایمن معاملات تا پایداری اتصال.',
      'Network / Bit24 API connection interrupted; trading halted safely.'
    );
  }

  if (input.consecutiveTradeErrors >= 3) {
    return fail(
      'ABNORMAL_MARKET',
      `مدارشکن خطای سفارش فعال شد (${input.consecutiveTradeErrors} خطای متوالی صرافی).`,
      `Order error circuit breaker tripped (${input.consecutiveTradeErrors} consecutive API errors).`
    );
  }

  // Prevent trading on stale market data (> 90 seconds old)
  const dataAgeMs = input.nowMs - input.market.updatedAt;
  if (dataAgeMs > 90_000) {
    return fail(
      'STALE_DATA',
      `داده قیمت نماد ${input.symbol} قدیمی است (${Math.round(dataAgeMs / 1000)} ثانیه تأخیر)؛ جلوگیر از معامله با قیمت کهنه.`,
      `Stale price feed for ${input.symbol} (${Math.round(dataAgeMs / 1000)}s old); order blocked.`
    );
  }

  // Prevent duplicate orders (either in-flight or already open)
  if (
    input.inFlightSymbols.has(input.symbol) ||
    input.openPositions.some((p) => p.symbol === input.symbol)
  ) {
    return fail(
      'DUPLICATE_ORDER',
      `جلوگیری از سفارش تکراری: معامله باز یا سفارش در حال ارسال روی ${input.symbol} وجود دارد.`,
      `Duplicate order blocked: ${input.symbol} already has an active position or pending order.`
    );
  }

  // Daily Loss Limit check
  if (
    input.capitalConfig.autoStopOnDailyLoss &&
    input.dailyLossPctSoFar <= -Math.abs(input.capitalConfig.maxDailyLossPct)
  ) {
    return fail(
      'DAILY_LOSS_LIMIT',
      `رسیدن به سقف ضرر روزانه مجاز (${input.dailyLossPctSoFar.toFixed(2)}% از سقف -${input.capitalConfig.maxDailyLossPct}%)؛ توقف خودکار فعال شد.`,
      `Max daily loss limit reached (${input.dailyLossPctSoFar.toFixed(2)}% vs -${input.capitalConfig.maxDailyLossPct}% limit); auto-halt engaged.`
    );
  }

  // Max Concurrent Trades check
  const segmentPositions = input.openPositions.filter(
    (p) => p.segment === input.market.segment
  );
  if (segmentPositions.length >= input.capitalConfig.maxConcurrentTrades) {
    return fail(
      'MAX_CONCURRENT_REACHED',
      `ظرفیت معاملات هم‌زمان تکمیل است (${segmentPositions.length}/${input.capitalConfig.maxConcurrentTrades}).`,
      `Maximum concurrent trades reached (${segmentPositions.length}/${input.capitalConfig.maxConcurrentTrades}).`
    );
  }

  // Fake Pump & Over-pumped Filter
  if (input.pumpAndDumpRisk || input.alreadyOverPumped) {
    return fail(
      'FAKE_PUMP_RISK',
      `شناسایی ریسک پامپ ساختگی یا رشد بیش‌ازحد قبلی روی ${input.symbol}؛ رد هوشمند خرید.`,
      `Fake pump / over-pumped exhaustion detected on ${input.symbol}; order rejected.`
    );
  }

  // Liquidity & 24h Volume Check
  if (input.market.volume24hIrt < 8_000_000_000 || input.orderBook.askDepthIrt < 60_000_000) {
    return fail(
      'LOW_LIQUIDITY',
      `نقدشوندگی یا عمق بازار ناکافی در ${input.symbol} برای خروج ایمن.`,
      `Insufficient 24h volume or orderbook depth on ${input.symbol} for safe exit.`
    );
  }

  // Bid-Ask Spread Check
  if (input.orderBook.spreadPct > 0.7) {
    return fail(
      'HIGH_SPREAD',
      `اختلاف قیمت خرید و فروش (Spread=${input.orderBook.spreadPct}%) بیش از حد مجاز امنیتی (0.70%) است.`,
      `Bid-ask spread (${input.orderBook.spreadPct}%) exceeds safe limit (0.70%).`
    );
  }

  // Abnormal Market Volatility Check
  if (input.atrPct > 5.0) {
    return fail(
      'ABNORMAL_MARKET',
      `نوسان غیرعادی بازار (ATR=${input.atrPct}%)؛ تعلیق موقت خرید روی ${input.symbol}.`,
      `Abnormal market volatility (ATR=${input.atrPct}%); buy suspended on ${input.symbol}.`
    );
  }

  return { allowed: true };
}

export interface ExitDecision {
  sellQuantity: number;
  closeEntirePosition: boolean;
  stageTriggered?: 1 | 2 | 3;
  sellReasonFa: string;
  sellReasonEn: string;
}

/**
 * Updates position highestPriceIrt, activates/ratchets Trailing Stop (+8% activation, 3% distance),
 * and checks Initial Stop-Loss (-5%), Trailing Stop, or 3-Stage Stepped Take-Profit
 * (30% @ +10%, 30% @ +20%, 40% @ +35%).
 */
export function evaluatePositionStepExit(
  pos: ActivePosition,
  currentPriceIrt: number,
  barLowIrt: number,
  barHighIrt: number,
  exitConfig: ExitStrategyConfig
): ExitDecision | null {
  pos.currentPriceIrt = currentPriceIrt;

  // Update peak price for Trailing Stop tracking
  if (barHighIrt > pos.highestPriceIrt) {
    pos.highestPriceIrt = barHighIrt;
  }

  const peakProfitPct =
    ((pos.highestPriceIrt - pos.entryPriceIrt) / pos.entryPriceIrt) * 100;

  // Activate & ratchet Trailing Stop once peak profit reaches +8% (default)
  if (peakProfitPct >= exitConfig.trailingActivationProfitPct) {
    pos.trailingStopActive = true;
    const candidateTrail = roundIrtPrice(
      pos.highestPriceIrt * (1 - exitConfig.trailingDistanceFromPeakPct / 100)
    );
    if (
      pos.trailingStopPriceIrt === null ||
      candidateTrail > pos.trailingStopPriceIrt
    ) {
      pos.trailingStopPriceIrt = candidateTrail;
    }
    if (pos.trailingStopPriceIrt > pos.activeStopLossIrt) {
      pos.activeStopLossIrt = pos.trailingStopPriceIrt;
    }
  }

  // 1. Check Stop-Loss / Trailing Stop first (capital preservation priority)
  if (barLowIrt <= pos.activeStopLossIrt) {
    if (pos.trailingStopActive && pos.trailingStopPriceIrt !== null) {
      return {
        sellQuantity: pos.remainingQuantity,
        closeEntirePosition: true,
        sellReasonFa: `برخورد به حد ضرر متحرک (Trailing Stop در فاصله ${exitConfig.trailingDistanceFromPeakPct}% از سقف ${pos.highestPriceIrt.toLocaleString()} تومان)`,
        sellReasonEn: `Trailing Stop triggered (${exitConfig.trailingDistanceFromPeakPct}% below peak ${pos.highestPriceIrt.toLocaleString()} IRT)`,
      };
    }
    return {
      sellQuantity: pos.remainingQuantity,
      closeEntirePosition: true,
      sellReasonFa: `برخورد به حد ضرر محافظ سرمایه (${exitConfig.initialStopLossPct}%-)`,
      sellReasonEn: `Initial Stop-Loss triggered (-${exitConfig.initialStopLossPct}%)`,
    };
  }

  // 2. Check Stepped Take-Profit Stages (30% @ +10%, 30% @ +20%, 40% @ +35%)
  const highProfitPct = ((barHighIrt - pos.entryPriceIrt) / pos.entryPriceIrt) * 100;

  if (!pos.tpStage1Filled && highProfitPct >= exitConfig.tpStage1ProfitPct) {
    const qty = Math.min(
      pos.remainingQuantity,
      pos.initialQuantity * (exitConfig.tpStage1SellRatioPct / 100)
    );
    return {
      sellQuantity: qty,
      closeEntirePosition: qty >= pos.remainingQuantity * 0.999,
      stageTriggered: 1,
      sellReasonFa: `حد سود پله اول (+${exitConfig.tpStage1ProfitPct}%): فروش ${exitConfig.tpStage1SellRatioPct}% حجم معامله`,
      sellReasonEn: `Stepped Take-Profit Stage 1 (+${exitConfig.tpStage1ProfitPct}%): sold ${exitConfig.tpStage1SellRatioPct}%`,
    };
  }

  if (!pos.tpStage2Filled && highProfitPct >= exitConfig.tpStage2ProfitPct) {
    const qty = Math.min(
      pos.remainingQuantity,
      pos.initialQuantity * (exitConfig.tpStage2SellRatioPct / 100)
    );
    return {
      sellQuantity: qty,
      closeEntirePosition: qty >= pos.remainingQuantity * 0.999,
      stageTriggered: 2,
      sellReasonFa: `حد سود پله دوم (+${exitConfig.tpStage2ProfitPct}%): فروش ${exitConfig.tpStage2SellRatioPct}% حجم معامله`,
      sellReasonEn: `Stepped Take-Profit Stage 2 (+${exitConfig.tpStage2ProfitPct}%): sold ${exitConfig.tpStage2SellRatioPct}%`,
    };
  }

  if (!pos.tpStage3Filled && highProfitPct >= exitConfig.tpStage3ProfitPct) {
    return {
      sellQuantity: pos.remainingQuantity,
      closeEntirePosition: true,
      stageTriggered: 3,
      sellReasonFa: `حد سود نهایی پله سوم (+${exitConfig.tpStage3ProfitPct}%): تسویه کامل ${exitConfig.tpStage3SellRatioPct}% باقی‌مانده`,
      sellReasonEn: `Stepped Take-Profit Stage 3 (+${exitConfig.tpStage3ProfitPct}%): closed remaining ${exitConfig.tpStage3SellRatioPct}%`,
    };
  }

  // Update unrealized PnL snapshot
  const grossValue = pos.remainingQuantity * currentPriceIrt;
  const estExitFee = grossValue * 0.002;
  pos.unrealizedPnlIrt = Math.round(
    grossValue - estExitFee - pos.remainingCapitalIrt
  );
  pos.unrealizedPnlPct =
    pos.remainingCapitalIrt > 0
      ? Number(((pos.unrealizedPnlIrt / pos.remainingCapitalIrt) * 100).toFixed(2))
      : 0;

  return null;
}
