import {
  Bit24MarketInfo,
  ModuleRiskSettings,
  OhlcvCandle,
  OrderBookSnapshot,
  SmartSignal,
} from '../shared/types.js';
import { buildTechnicalSnapshot, evaluateTradeEconomics } from './indicators.js';

export interface LeverageAnalysisInput {
  market: Bit24MarketInfo;
  candles: OhlcvCandle[];
  orderBook: OrderBookSnapshot;
  riskSettings: ModuleRiskSettings;
  feePctPerSide: number;
  maxAllowedSpreadPct: number;
  minNetRiskReward: number;
}

/**
 * Computes approximate Bit24 isolated margin liquidation price (10% maintenance ratio rule on Bit24).
 */
export function computeBit24LiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: 'LONG' | 'SHORT',
  quote: 'IRT' | 'USDT'
): number {
  const safeLev = Math.max(1, leverage);
  // With 10% liquidation margin threshold on initial collateral, ~90% of 1/leverage move triggers liquidation
  const liqMoveFraction = (0.9 / safeLev);
  const raw =
    side === 'LONG'
      ? entryPrice * (1 - liqMoveFraction)
      : entryPrice * (1 + liqMoveFraction);
  return quote === 'IRT' ? Math.round(raw) : Number(raw.toFixed(2));
}

export function analyzeLeverageMarket(input: LeverageAnalysisInput): SmartSignal {
  const {
    market,
    candles,
    orderBook,
    riskSettings,
    feePctPerSide,
    maxAllowedSpreadPct,
    minNetRiskReward,
  } = input;

  const tech = buildTechnicalSnapshot(candles);
  const price = market.eachPrice || candles[candles.length - 1]?.c || 1;
  const cappedLeverage = Math.max(
    1,
    Math.min(market.maxLeverage || 2, riskSettings.maxLeverage || 2, 3)
  );

  // Include 24h expected hourly rollover cost (HRL) in total friction
  const dailyRolloverCostPct = (market.hourlyRolloverFeePct || 0.008) * 24;
  const stopDistPct = Number(Math.min(riskSettings.stopLossPct, 1.8).toFixed(2));
  const target2Pct = Number(Math.max(riskSettings.takeProfit2Pct, stopDistPct * 2.3).toFixed(2));
  const target1Pct = Number((target2Pct * 0.55).toFixed(2));

  const costs = evaluateTradeEconomics({
    feePctPerSide: feePctPerSide + dailyRolloverCostPct / 2,
    spreadPct: orderBook.spreadPct,
    estimatedSlippagePct: orderBook.estimatedSlippagePct,
    grossTargetPct: target2Pct,
    stopDistancePct: stopDistPct,
    minNetRiskReward: Math.max(minNetRiskReward, 1.9),
  });

  const reasonsFa: string[] = [];
  const rejectionReasonsFa: string[] = [];

  if (!market.marginActive) {
    rejectionReasonsFa.push(`معاملات مارجین برای ${market.marketName} در بیت‌۲۴ فعال نیست.`);
  }
  if (orderBook.spreadPct > maxAllowedSpreadPct) {
    rejectionReasonsFa.push('اسپرد دفتر سفارشات برای معامله اهرم‌دار بیش از حد مجاز است.');
  }

  let side: 'LONG' | 'SHORT' = 'LONG';
  let score = 28;
  let setupTypeFa = 'عدم تایید ستاپ اهرم‌دار';

  if (
    tech.shortTermTrend === 'BULLISH' &&
    tech.mediumTermTrend === 'BULLISH' &&
    tech.breakoutState === 'CONFIRMED_BULLISH_BREAKOUT' &&
    tech.rsi14 >= 48 &&
    tech.rsi14 <= 64
  ) {
    side = 'LONG';
    score += 44;
    setupTypeFa = `لانگ (Long ${cappedLeverage}x) تاییدشده با سفارش Limit بیت‌۲۴`;
    reasonsFa.push('هم‌جهتی روند کوتاه‌مدت و میان‌مدت صعودی با شکست معتبر مقاومت.');
  } else if (
    tech.shortTermTrend === 'BEARISH' &&
    tech.mediumTermTrend === 'BEARISH' &&
    tech.macdHistogram < 0 &&
    tech.rsi14 <= 46 &&
    tech.rsi14 >= 32
  ) {
    side = 'SHORT';
    score += 42;
    setupTypeFa = `شورت (Short ${cappedLeverage}x) تاییدشده در روند نزولی`;
    reasonsFa.push('آرایش نزولی EMA 9 < EMA 21 < EMA 50 و مومنتوم منفی MACD.');
  } else {
    rejectionReasonsFa.push('شرایط سخت‌گیرانه ورود اهرم‌دار (Long/Short) احراز نشده است.');
  }

  const liqPrice = computeBit24LiquidationPrice(price, cappedLeverage, side, market.quoteSymbol);
  const liqDistancePct = (Math.abs(price - liqPrice) / price) * 100;

  if (liqDistancePct < stopDistPct * 4) {
    rejectionReasonsFa.push('فاصله قیمت لیکویید شدن تا حد ضرر به اندازه کافی ایمن نیست.');
  } else {
    score += 10;
    reasonsFa.push(
      `فاصله ایمن قیمت لیکویید شدن (${liqDistancePct.toFixed(1)}٪) نسبت به حد ضرر (${stopDistPct}٪).`
    );
  }

  if (!costs.isEconomical) {
    rejectionReasonsFa.push('با احتساب کارمزد ساعتی وام (HRL) و کارمزد بیت‌۲۴، معامله به‌صرفه نیست.');
  } else {
    score += 10;
  }

  const finalScore = Math.max(10, Math.min(94, Math.round(score - rejectionReasonsFa.length * 15)));
  const valid = rejectionReasonsFa.length === 0 && finalScore >= 72;

  const action: SmartSignal['action'] = !valid
    ? 'AVOID_UNFAVORABLE'
    : side === 'LONG'
      ? 'BUY_CONFIRMED'
      : 'SHORT_MARGIN_CONFIRMED';

  const stopLoss =
    side === 'LONG'
      ? roundPrice(price * (1 - stopDistPct / 100), market.quoteSymbol)
      : roundPrice(price * (1 + stopDistPct / 100), market.quoteSymbol);
  const takeProfit1 =
    side === 'LONG'
      ? roundPrice(price * (1 + target1Pct / 100), market.quoteSymbol)
      : roundPrice(price * (1 - target1Pct / 100), market.quoteSymbol);
  const takeProfit2 =
    side === 'LONG'
      ? roundPrice(price * (1 + target2Pct / 100), market.quoteSymbol)
      : roundPrice(price * (1 - target2Pct / 100), market.quoteSymbol);

  return {
    id: `sig-margin-${market.marketName}-${Date.now()}`,
    timestamp: Date.now(),
    module: 'LEVERAGE_MARGIN',
    marketName: market.marketName,
    baseSymbol: market.baseSymbol,
    baseFaName: market.baseFaName,
    quoteSymbol: market.quoteSymbol,
    currentPrice: price,
    change24hPct: market.change24hPct,
    action,
    confidenceScore: finalScore,
    setupTypeFa,
    summaryFa: valid
      ? `سیگنال مارجین ${setupTypeFa} در ${market.marketName} (بخش اهرم‌دار به‌طور پیش‌فرض غیرفعال است).`
      : rejectionReasonsFa[0] || 'عدم احراز شرایط ایمن مارجین.',
    reasonsFa,
    rejectionReasonsFa,
    suggestedEntry: price,
    stopLoss,
    takeProfit1,
    takeProfit2,
    trailingStopDeltaPct: riskSettings.trailingStopPct,
    leverage: cappedLeverage,
    liquidationPrice: liqPrice,
    technicals: tech,
    costs,
    executableOnBit24: market.marginActive,
  };
}

function roundPrice(price: number, quote: 'IRT' | 'USDT'): number {
  return quote === 'IRT' ? Math.round(price) : Number(price.toFixed(2));
}
