import {
  Bit24MarketInfo,
  ManagedPosition,
  MemePumpMetrics,
  MemePumpStage,
  ModuleRiskSettings,
  OhlcvCandle,
  OrderBookSnapshot,
  SmartSignal,
} from '../shared/types.js';
import { buildTechnicalSnapshot, evaluateTradeEconomics } from './indicators.js';

export const BIT24_MEME_SYMBOLS = new Set([
  'DOGE',
  'SHIB',
  'PEPE',
  'BONK',
  'WIF',
  'FLOKI',
  'NOT',
  'DOGS',
  'MEME',
  'BABYDOGE',
  'TURBO',
  'BOME',
  'NEIRO',
  'PNUT',
  'TRUMP',
  'HMSTR',
  'CATI',
]);

export function isMemeCoinSymbol(symbol: string): boolean {
  return BIT24_MEME_SYMBOLS.has(symbol.toUpperCase());
}

export interface MemeAnalysisInput {
  market: Bit24MarketInfo;
  candles: OhlcvCandle[];
  orderBook: OrderBookSnapshot;
  riskSettings: ModuleRiskSettings;
  feePctPerSide: number;
  maxAllowedSpreadPct: number;
  minNetRiskReward: number;
}

export function analyzeMemePumpMarket(input: MemeAnalysisInput): SmartSignal {
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
  const lastCandle = candles[candles.length - 1];
  const prev3Close = candles[Math.max(0, candles.length - 4)]?.c || price;

  // Measure distance from recent 36-candle high (is it coming off a bottom/dip, or already overextended?)
  const lookbackSlice = candles.slice(-36);
  const recentHigh = lookbackSlice.reduce((mx, c) => Math.max(mx, c.h), price);
  const drawdownFromRecentHighPct =
    recentHigh > 0 ? Math.max(0, ((recentHigh - price) / recentHigh) * 100) : 0;
  const bounceFromSupportPct = Math.max(0, tech.distanceToSupportPct);
  const pumpVelocityPct = prev3Close > 0 ? ((price - prev3Close) / prev3Close) * 100 : 0;
  const extensionAboveEma21Pct =
    tech.ema21 > 0 ? ((price - tech.ema21) / tech.ema21) * 100 : 0;

  // Meme coins move wider than gold/BTC: calibrate stop & stepped profit targets
  const dynamicStopPct = Number(
    Math.max(
      1.6,
      Math.min(
        riskSettings.stopLossPct,
        Math.max(tech.atrPct * 1.85, Math.min(3.2, bounceFromSupportPct + 0.65))
      )
    ).toFixed(2)
  );
  const grossTarget2Pct = Number(
    Math.max(
      riskSettings.takeProfit2Pct,
      Math.min(riskSettings.takeProfit2Pct * 1.45, Math.max(tech.distanceToResistancePct * 1.2, dynamicStopPct * 2.5))
    ).toFixed(2)
  );
  const grossTarget1Pct = Number(
    Math.max(riskSettings.takeProfit1Pct, grossTarget2Pct * 0.5).toFixed(2)
  );

  // Allow slightly wider spread tolerance on meme coins (up to 1.35x global spread setting), but strictly enforce net R:R
  const memeSpreadLimit = Math.max(0.55, maxAllowedSpreadPct * 1.35);

  const costs = evaluateTradeEconomics({
    feePctPerSide,
    spreadPct: orderBook.spreadPct,
    estimatedSlippagePct: orderBook.estimatedSlippagePct,
    grossTargetPct: grossTarget2Pct,
    stopDistancePct: dynamicStopPct,
    minNetRiskReward,
  });

  const reasonsFa: string[] = [];
  const rejectionReasonsFa: string[] = [];

  if (!market.spotActive) {
    rejectionReasonsFa.push(`بازار اسپات ${market.marketName} در بیت‌۲۴ غیرفعال است.`);
  }
  if (orderBook.spreadPct > memeSpreadLimit) {
    rejectionReasonsFa.push(
      `اسپرد خریدوفروش (${orderBook.spreadPct.toFixed(2)}٪) در دفتر سفارشات بیت‌۲۴ بالاست؛ خطر لغزش قیمت هنگام فروش.`
    );
  }

  const bullishLastBar = Boolean(lastCandle && lastCandle.c >= lastCandle.o);
  const overextendedTop = tech.rsi14 > 70 || extensionAboveEma21Pct > 9.5;

  let pumpStage: MemePumpStage = 'QUIET_WATCH';
  let pumpStageFa = 'رصد کف و حجم معاملات';
  let setupTypeFa = 'در انتظار ورود حجم در کف حمایتی';
  let score = 30;

  if (overextendedTop) {
    pumpStage = 'LATE_PUMP_FOMO_TRAP';
    pumpStageFa = 'اشباع پامپ در سقف (تله FOMO)';
    rejectionReasonsFa.push(
      `میم‌کوین قبلاً رشد تند داشته (RSI: ${tech.rsi14.toFixed(1)} | فاصله از میانگین: +${extensionAboveEma21Pct.toFixed(1)}٪)؛ خودداری از خرید در قله پامپ.`
    );
  } else if (tech.breakoutState === 'BREAKDOWN_RISK' && !bullishLastBar) {
    pumpStage = 'FALLING_KNIFE_RISK';
    pumpStageFa = 'ریزش بدون حمایت (چاقوی در حال سقوط)';
    rejectionReasonsFa.push(
      'حمایت کف هنوز تثبیت نشده و کندل بازگشتی تاییدشده دیده نمی‌شود؛ پرهیز از ورود زودهنگام.'
    );
  } else if (
    drawdownFromRecentHighPct >= 2.2 &&
    bounceFromSupportPct <= 3.4 &&
    bullishLastBar &&
    tech.rsi14 >= 33 &&
    tech.rsi14 <= 61 &&
    (tech.macdHistogram > 0 || tech.breakoutState === 'SUPPORT_REVERSAL_CONFIRMED') &&
    tech.volumeRatio >= 1.12
  ) {
    pumpStage = 'BOTTOM_ACCUMULATION_TURN';
    pumpStageFa = 'چرخش تاییدشده از کف اصلاحی + ورود پول';
    setupTypeFa = 'خرید در چرخش کف حمایتی پیش از اوج‌گیری پامپ';
    score += 36;
    reasonsFa.push(
      `قیمت پس از ${drawdownFromRecentHighPct.toFixed(1)}٪ اصلاح از سقف اخیر، روی حمایت کف حفظ شده و با حجم ${tech.volumeRatio.toFixed(2)}x به بالا چرخیده است.`
    );
  } else if (
    (tech.breakoutState === 'CONFIRMED_BULLISH_BREAKOUT' ||
      (tech.ema9 > tech.ema21 && pumpVelocityPct >= 0.7)) &&
    tech.volumeRatio >= 1.25 &&
    tech.rsi14 >= 44 &&
    tech.rsi14 <= 68
  ) {
    pumpStage = 'EARLY_PUMP_IGNITION';
    pumpStageFa = 'استارت موج پامپ با جهش حجم';
    setupTypeFa = 'شکار استارت موج پامپ با تایید حجم و شکست مقاومت';
    score += 35;
    reasonsFa.push(
      `جهش حجم معاملات (${tech.volumeRatio.toFixed(2)} برابر میانگین) همراه با شتاب صعودی +${pumpVelocityPct.toFixed(2)}٪ در ابتدای موج حرکت.`
    );
  } else {
    rejectionReasonsFa.push(
      'هنوز هم‌زمانی «کف حمایتی معتبر + جهش حجم شروع پامپ» تایید نشده است.'
    );
  }

  if (tech.ema9 > tech.ema21 && !overextendedTop) {
    score += 11;
    reasonsFa.push('عبور میانگین سریع EMA 9 از EMA 21 به نفع آغاز موج صعودی.');
  }
  if (tech.macdHistogram > 0) {
    score += 9;
    reasonsFa.push('چرخش مثبت هیستوگرام MACD و افزایش شتاب خریداران.');
  }

  if (!costs.isEconomical) {
    rejectionReasonsFa.push(
      `نسبت سود خالص به ریسک پس از کسر کارمزد ۰.۲٪ بیت‌۲۴ و اسلیپیج (${costs.netRiskRewardRatio.toFixed(2)}) کمتر از حد استاندارد است.`
    );
  } else {
    score += 11;
    reasonsFa.push(
      `صرفه اقتصادی تایید شد: هدف سود پله‌ای (+${grossTarget1Pct}٪ و +${grossTarget2Pct}٪) با R:R خالص ${costs.netRiskRewardRatio.toFixed(2)}.`
    );
  }

  const finalScore = Math.max(8, Math.min(96, Math.round(score - rejectionReasonsFa.length * 14)));
  const isConfirmedBuy =
    rejectionReasonsFa.length === 0 &&
    (pumpStage === 'BOTTOM_ACCUMULATION_TURN' || pumpStage === 'EARLY_PUMP_IGNITION') &&
    finalScore >= 68;

  const action: SmartSignal['action'] = isConfirmedBuy
    ? 'BUY_CONFIRMED'
    : pumpStage === 'LATE_PUMP_FOMO_TRAP' || pumpStage === 'FALLING_KNIFE_RISK' || !costs.isEconomical
      ? 'AVOID_UNFAVORABLE'
      : 'HOLD_WATCH';

  const stopLoss = roundMemePrice(price * (1 - dynamicStopPct / 100), market.quoteSymbol, price);
  const takeProfit1 = roundMemePrice(price * (1 + grossTarget1Pct / 100), market.quoteSymbol, price);
  const takeProfit2 = roundMemePrice(price * (1 + grossTarget2Pct / 100), market.quoteSymbol, price);

  const memeMetrics: MemePumpMetrics = {
    pumpStage,
    pumpStageFa,
    drawdownFromRecentHighPct: Number(drawdownFromRecentHighPct.toFixed(2)),
    bounceFromSupportPct: Number(bounceFromSupportPct.toFixed(2)),
    volumeSurgeMultiple: tech.volumeRatio,
    pumpVelocityPct: Number(pumpVelocityPct.toFixed(2)),
  };

  return {
    id: `sig-meme-${market.marketName}-${Date.now()}`,
    timestamp: Date.now(),
    module: 'MEME_HUNTER',
    marketName: market.marketName,
    baseSymbol: market.baseSymbol,
    baseFaName: market.baseFaName,
    quoteSymbol: market.quoteSymbol,
    currentPrice: price,
    change24hPct: market.change24hPct,
    action,
    confidenceScore: finalScore,
    setupTypeFa,
    summaryFa:
      action === 'BUY_CONFIRMED'
        ? `شکار میم‌کوین ${market.baseFaName} (${market.marketName}): ${setupTypeFa} | فروش خودکار پله‌ای در رشد (+${grossTarget1Pct}٪ و +${grossTarget2Pct}٪ با حد ضرر متحرک).`
        : rejectionReasonsFa[0] || `در حال رصد کف و حجم پامپ در ${market.marketName}.`,
    reasonsFa,
    rejectionReasonsFa,
    suggestedEntry: price,
    stopLoss,
    takeProfit1,
    takeProfit2,
    trailingStopDeltaPct: riskSettings.trailingStopPct,
    technicals: tech,
    costs,
    memeMetrics,
    executableOnBit24: market.spotActive,
  };
}

/**
 * Exits a meme coin position when the pump loses steam after rising, or if support breaks sharply.
 */
export function evaluateMemeEarlyExit(
  position: ManagedPosition,
  candles: OhlcvCandle[]
): { shouldExit: boolean; reasonFa: string } {
  if (candles.length < 26) return { shouldExit: false, reasonFa: '' };
  const tech = buildTechnicalSnapshot(candles);
  const lastPrice = candles[candles.length - 1].c;

  // 1. Protect pump gains if momentum stalls & EMA9 crosses below EMA21
  if (
    position.unrealizedPnlPct >= 1.4 &&
    tech.ema9 < tech.ema21 * 0.996 &&
    tech.macdHistogram < 0
  ) {
    return {
      shouldExit: true,
      reasonFa: 'فروش هوشمند پایان موج پامپ: تخلیه شتاب خرید و حفظ سود کسب‌شده.',
    };
  }

  // 2. Hard support floor broken with bearish momentum
  if (lastPrice < tech.supportLevel * 0.991 && tech.macdHistogram < 0 && tech.rsi14 < 39) {
    return {
      shouldExit: true,
      reasonFa: 'خروج اضطراری محافظ سرمایه: شکست کف حمایتی میم‌کوین.',
    };
  }

  return { shouldExit: false, reasonFa: '' };
}

function roundMemePrice(price: number, quote: 'IRT' | 'USDT', refPrice: number): number {
  if (quote === 'IRT') {
    if (refPrice < 100) return Number(price.toFixed(2)); // e.g., PEPE/IRT or SHIB/IRT sub-100 Toman!
    if (refPrice < 1000) return Number(price.toFixed(1));
    return Math.round(price);
  }
  if (refPrice < 0.001) return Number(price.toFixed(8));
  if (refPrice < 1) return Number(price.toFixed(6));
  return Number(price.toFixed(4));
}
