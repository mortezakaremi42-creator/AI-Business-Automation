import {
  Bit24MarketInfo,
  ManagedPosition,
  ModuleRiskSettings,
  OhlcvCandle,
  OrderBookSnapshot,
  SmartSignal,
} from '../shared/types.js';
import { buildTechnicalSnapshot, evaluateTradeEconomics } from './indicators.js';
import { smartRoundMarketPrice } from './marketSimulator.js';

export interface SpotCryptoAnalysisInput {
  market: Bit24MarketInfo;
  candles: OhlcvCandle[];
  orderBook: OrderBookSnapshot;
  riskSettings: ModuleRiskSettings;
  feePctPerSide: number;
  maxAllowedSpreadPct: number;
  minNetRiskReward: number;
}

export function analyzeSpotCryptoMarket(input: SpotCryptoAnalysisInput): SmartSignal {
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

  // ATR(14)-adaptive Stop-Loss & Targets
  const dynamicStopPct = Number(
    Math.max(
      1.1,
      Math.min(
        riskSettings.stopLossPct,
        Math.max(tech.atrPct * 1.8, tech.distanceToSupportPct + 0.45)
      )
    ).toFixed(2)
  );
  const grossTarget2Pct = Number(
    Math.max(
      riskSettings.takeProfit2Pct,
      Math.min(
        riskSettings.takeProfit2Pct * 1.4,
        Math.max(tech.distanceToResistancePct, dynamicStopPct * 2.3)
      )
    ).toFixed(2)
  );
  const grossTarget1Pct = Number(
    Math.max(riskSettings.takeProfit1Pct, grossTarget2Pct * 0.55).toFixed(2)
  );

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

  // Data completeness & liquidity gates (Stage 3 & Stage 5)
  if (candles.length < 30 || price <= 0 || orderBook.bestAsk <= 0) {
    rejectionReasonsFa.push('داده تاریخی کندل یا دفتر سفارشات ناقص است؛ خرید مجاز نیست.');
  }
  if (!market.spotActive) {
    rejectionReasonsFa.push(`بازار اسپات ${market.marketName} در بیت‌۲۴ غیرفعال است.`);
  }
  if (orderBook.spreadPct > maxAllowedSpreadPct * 1.15) {
    rejectionReasonsFa.push(
      `اسپرد خریدوفروش (${orderBook.spreadPct.toFixed(2)}٪) بیش از آستانه ایمن ورود است.`
    );
  }
  const minDepthRequired = market.quoteSymbol === 'IRT' ? 20_000_000 : 250;
  if (orderBook.askDepthQuote < minDepthRequired) {
    rejectionReasonsFa.push('عمق نقدشوندگی دفتر فروش کافی نیست؛ ریسک لغزش قیمت بالاست.');
  }

  // Fake-Pump & Sudden Spike Late-Entry Filter (Stage 3 explicit requirement)
  if (tech.fakePumpRisk || tech.breakoutState === 'FAKE_BREAKOUT_TRAP') {
    rejectionReasonsFa.push(
      `احتمال پامپ کاذب یا تله شکست مقاومت در ${market.marketName} (جهش بدون حجم کافی یا سایه رد قیمت بالا)؛ ورود ممنوع.`
    );
  }
  if (tech.suddenSpikePct > 5.2 && tech.rsi14 > 66) {
    rejectionReasonsFa.push(
      `جهش ناگهانی اخیر (+${tech.suddenSpikePct.toFixed(1)}٪) و خطر ورود دیرهنگام در سقف کوتاه‌مدت.`
    );
  }
  if (tech.rsi14 > 70) {
    rejectionReasonsFa.push(
      `شاخص RSI (${tech.rsi14.toFixed(1)}) در اشباع خرید است؛ پرهیز از ورود هیجانی در سقف.`
    );
  }
  if (tech.breakoutState === 'BREAKDOWN_RISK') {
    rejectionReasonsFa.push('احتمال شکست حمایت و ادامه اصلاح نزولی؛ ورود مجاز نیست.');
  }

  let score = 32;
  let setupTypeFa = 'پایش روند بازار اسپات';

  const emaBullish = tech.ema9 > tech.ema21 && tech.ema21 > tech.ema50 * 0.997;
  const macdPositive = tech.macdHistogram > 0;

  if (tech.breakoutState === 'CONFIRMED_BULLISH_BREAKOUT') {
    score += 34;
    setupTypeFa = 'شکست صعودی مقاومت همراه با جهش حجم';
    reasonsFa.push(
      `عبور تاییدشده از مقاومت با حجم ${tech.volumeRatio.toFixed(2)} برابر میانگین ۲۰ کندل.`
    );
  } else if (tech.breakoutState === 'SUPPORT_REVERSAL_CONFIRMED') {
    score += 29;
    setupTypeFa = 'برگشت تاییدشده از ناحیه حمایتی';
    reasonsFa.push('حفظ حمایت معتبر و ثبت کندل بازگشتی با بهبود مومنتوم MACD.');
  } else if (emaBullish && macdPositive && tech.rsi14 >= 44 && tech.rsi14 <= 66) {
    score += 25;
    setupTypeFa = 'پولبک سالم در روند صعودی چندتایم‌فریمی';
    reasonsFa.push(
      `ساختار صعودی EMA 9/21/50، نوسان ATR برابر ${tech.atrPct.toFixed(2)}٪ و مومنتوم مثبت.`
    );
  } else {
    rejectionReasonsFa.push('عدم شکل‌گیری ستاپ تاییدشده صعودی در تایم‌فریم تحلیلی.');
  }

  if (emaBullish && tech.htfTrend === 'BULLISH') {
    score += 13;
    reasonsFa.push('هم‌جهتی روند ۱ ساعته و ۴ ساعته (Multi-Timeframe) به نفع رشد قیمت.');
  } else if (emaBullish) {
    score += 9;
    reasonsFa.push('هم‌راستایی روند کوتاه‌مدت و میان‌مدت به نفع رشد قیمت.');
  }
  if (tech.volumeRatio >= 1.1) {
    score += 8;
    reasonsFa.push(`ورود نقدینگی و حجم بالاتر از میانگین (${tech.volumeRatio.toFixed(2)}x).`);
  }

  if (!costs.isEconomical) {
    rejectionReasonsFa.push(
      `نسبت سود خالص به ریسک (${costs.netRiskRewardRatio.toFixed(2)}) پس از کارمزد ${feePctPerSide}٪ بیت‌۲۴ کافی نیست.`
    );
  } else {
    score += 11;
    reasonsFa.push(`نسبت R:R خالص ${costs.netRiskRewardRatio.toFixed(2)} پس از کسر کارمزد و اسلیپیج.`);
  }

  const finalScore = Math.max(10, Math.min(96, Math.round(score - rejectionReasonsFa.length * 14)));
  const confirmed = rejectionReasonsFa.length === 0 && finalScore >= 68;

  const action: SmartSignal['action'] = confirmed
    ? 'BUY_CONFIRMED'
    : rejectionReasonsFa.length >= 2 || tech.fakePumpRisk
      ? 'AVOID_UNFAVORABLE'
      : 'HOLD_WATCH';

  const stopLoss = smartRoundMarketPrice(price * (1 - dynamicStopPct / 100), market.quoteSymbol);
  const takeProfit1 = smartRoundMarketPrice(price * (1 + grossTarget1Pct / 100), market.quoteSymbol);
  const takeProfit2 = smartRoundMarketPrice(price * (1 + grossTarget2Pct / 100), market.quoteSymbol);

  return {
    id: `sig-spot-${market.marketName}-${Date.now()}`,
    timestamp: Date.now(),
    module: 'SPOT_CRYPTO',
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
        ? `سیگنال خرید اسپات ${market.baseFaName} (${market.marketName}): ${setupTypeFa} با R:R خالص ${costs.netRiskRewardRatio.toFixed(2)} (بدون ادعای پیش‌بینی قطعی کف).`
        : rejectionReasonsFa[0] || `در حال رصد بازار اسپات ${market.marketName}.`,
    reasonsFa,
    rejectionReasonsFa,
    suggestedEntry: price,
    stopLoss,
    takeProfit1,
    takeProfit2,
    trailingStopDeltaPct: riskSettings.trailingStopPct,
    technicals: tech,
    costs,
    executableOnBit24: market.spotActive,
  };
}

export function evaluateSpotEarlyExit(
  position: ManagedPosition,
  candles: OhlcvCandle[]
): { shouldExit: boolean; reasonFa: string } {
  if (candles.length < 26) return { shouldExit: false, reasonFa: '' };
  const tech = buildTechnicalSnapshot(candles);
  const lastPrice = candles[candles.length - 1].c;

  if (lastPrice < tech.supportLevel * 0.994 && tech.macdHistogram < 0) {
    return {
      shouldExit: true,
      reasonFa: 'خروج زودهنگام اسپات: شکست حمایت کوتاه‌مدت و افزایش فشار فروش.',
    };
  }
  if (position.unrealizedPnlPct > 0.6 && tech.ema9 < tech.ema21 * 0.9975 && tech.rsi14 < 43) {
    return {
      shouldExit: true,
      reasonFa: 'خروج محافظتی حفظ سود اسپات: تقاطع نزولی EMA9/21.',
    };
  }
  return { shouldExit: false, reasonFa: '' };
}
