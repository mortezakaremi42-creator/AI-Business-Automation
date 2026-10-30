import {
  Bit24MarketInfo,
  GoldGlobalComparison,
  ManagedPosition,
  ModuleRiskSettings,
  OhlcvCandle,
  OrderBookSnapshot,
  SmartSignal,
} from '../shared/types.js';
import { buildTechnicalSnapshot, evaluateTradeEconomics } from './indicators.js';
import { smartRoundMarketPrice } from './marketSimulator.js';

export interface GoldAnalysisInput {
  market: Bit24MarketInfo;
  candles: OhlcvCandle[];
  orderBook: OrderBookSnapshot;
  riskSettings: ModuleRiskSettings;
  feePctPerSide: number;
  maxAllowedSpreadPct: number;
  minNetRiskReward: number;
  globalXauUsd: number;
  globalXauChange24hPct: number;
  usdtIrtRate: number;
}

export function analyzeGoldMarket(input: GoldAnalysisInput): SmartSignal {
  const {
    market,
    candles,
    orderBook,
    riskSettings,
    feePctPerSide,
    maxAllowedSpreadPct,
    minNetRiskReward,
    globalXauUsd,
    globalXauChange24hPct,
    usdtIrtRate,
  } = input;

  const tech = buildTechnicalSnapshot(candles);
  const price = market.eachPrice || candles[candles.length - 1]?.c || 1;

  // Compute implied USD price of PAXG/XAUT on Bit24 without assuming 1:1 parity with XAU/USD or Iranian domestic gold
  const safeUsdtIrt = Math.max(1000, usdtIrtRate);
  const tokenImpliedUsd =
    market.quoteSymbol === 'USDT' ? price : price / safeUsdtIrt;
  const safeXau = globalXauUsd > 500 ? globalXauUsd : tokenImpliedUsd;
  const basisVsXauPct =
    safeXau > 0 ? ((tokenImpliedUsd - safeXau) / safeXau) * 100 : 0;
  const divergence24hPct = market.change24hPct - globalXauChange24hPct;

  const goldComparison: GoldGlobalComparison = {
    globalXauUsd: Number(safeXau.toFixed(2)),
    globalXauChange24hPct: Number(globalXauChange24hPct.toFixed(2)),
    usdtIrtRate: Math.round(safeUsdtIrt),
    tokenImpliedUsd: Number(tokenImpliedUsd.toFixed(2)),
    basisVsXauPct: Number(basisVsXauPct.toFixed(2)),
    divergence24hPct: Number(divergence24hPct.toFixed(2)),
    productTypeFa:
      market.baseSymbol === 'PAXG'
        ? 'توکن دیجیتال طلا پکس‌گلد (PAXG — معادل ۱ انس تروا طلای فیزیکی لندن در شبکه بلاکچین)'
        : 'توکن دیجیتال طلا تترگلد (XAUT — معادل ۱ انس تروا شمش طلای سوئیس در شبکه بلاکچین)',
    priceUnitFa:
      market.quoteSymbol === 'IRT'
        ? 'تومان ایران (IRT) به ازای هر ۱ واحد توکن طلا در صرافی بیت‌۲۴'
        : 'تتر (USDT) به ازای هر ۱ واحد توکن طلا در صرافی بیت‌۲۴',
    accountCurrencyFa:
      market.quoteSymbol === 'IRT' ? 'کیف پول اسپات تومانی بیت‌۲۴ (IRT)' : 'کیف پول اسپات تتری بیت‌۲۴ (USDT)',
    tradingHoursFa:
      'بازار اسپات بیت‌۲۴: ۲۴ ساعته در ۷ روز هفته (توجه: بازار جهانی انس XAU/USD شنبه‌ها و یکشنبه‌ها تعطیل است و در آخر هفته میلادی ممکن است اسپرد توکن‌های طلا افزایش یابد).',
    brokerLimitationsFa:
      'معامله واقعی صرفاً روی توکن‌های طلای دیجیتال لیست‌شده در بیت‌۲۴ (PAXG/XAUT) از طریق CAPI v2 انجام می‌شود؛ اتصال کارگزار فارکس XAU/USD در این نسخه «تکمیل نشده» است و صرفاً نقش نرخ مرجع تحلیلی دارد. اجرای حد ضرر در نوسان شدید مشمول اسلیپیج دفتر سفارشات است.',
    noteFa:
      market.quoteSymbol === 'IRT'
        ? `قیمت ${market.baseSymbol} تومانی تابع هم‌زمان انس جهانی (XAU/USD)، نرخ تتر/تومان و عرضه/تقاضای داخلی بیت‌۲۴ است (اختلاف دلاری فعلی با انس: ${basisVsXauPct >= 0 ? '+' : ''}${basisVsXauPct.toFixed(2)}٪) و برابر با طلای ۱۸ عیار داخلی فرض نمی‌شود.`
        : `قیمت ${market.baseSymbol}/USDT در بیت‌۲۴ نسبت به انس جهانی (${safeXau.toFixed(1)}$) دارای اختلاف ${basisVsXauPct >= 0 ? '+' : ''}${basisVsXauPct.toFixed(2)}٪ است (برابری مطلق فرض نمی‌شود).`,
  };

  // Dynamic Stop-Loss anchored to ATR(14) volatility, structural support & user risk settings
  const atrStopPct = Math.max(0.7, tech.atrPct * 1.65);
  const structuralStopDistPct = Math.max(
    atrStopPct,
    Math.min(riskSettings.stopLossPct * 1.25, tech.distanceToSupportPct + 0.35)
  );
  const effectiveStopPct = Number(
    Math.min(riskSettings.stopLossPct, structuralStopDistPct).toFixed(2)
  );
  const grossTarget2Pct = Math.max(
    riskSettings.takeProfit2Pct,
    Math.min(
      riskSettings.takeProfit2Pct * 1.35,
      Math.max(tech.distanceToResistancePct, effectiveStopPct * 2.2)
    )
  );
  const grossTarget1Pct = Number(
    Math.max(riskSettings.takeProfit1Pct, grossTarget2Pct * 0.55).toFixed(2)
  );

  const costs = evaluateTradeEconomics({
    feePctPerSide,
    spreadPct: orderBook.spreadPct,
    estimatedSlippagePct: orderBook.estimatedSlippagePct,
    grossTargetPct: grossTarget2Pct,
    stopDistancePct: effectiveStopPct,
    minNetRiskReward,
  });

  const reasonsFa: string[] = [];
  const rejectionReasonsFa: string[] = [];

  // 0. Data Completeness Gate (Stage 5 requirement)
  if (candles.length < 30 || price <= 0 || orderBook.bestAsk <= 0) {
    rejectionReasonsFa.push(
      'داده کندلی یا دفتر سفارشات طلا ناقص است؛ طبق قانون مدیریت ریسک، ورود تا تکمیل داده ممنوع است.'
    );
  }

  // 1. Market availability & Liquidity / Spread gates
  if (!market.spotActive) {
    rejectionReasonsFa.push(
      `بازار ${market.marketName} در حال حاضر غیرفعال است؛ سیستم در حالت «فقط تحلیل و سیگنال» قرار دارد.`
    );
  }
  if (orderBook.spreadPct > maxAllowedSpreadPct) {
    rejectionReasonsFa.push(
      `اسپرد خریدوفروش (${orderBook.spreadPct.toFixed(2)}٪) بالاتر از سقف مجاز (${maxAllowedSpreadPct.toFixed(2)}٪) است.`
    );
  }
  const minDepthRequired = market.quoteSymbol === 'IRT' ? 25_000_000 : 350;
  if (orderBook.askDepthQuote < minDepthRequired) {
    rejectionReasonsFa.push(
      'نقدشوندگی دفتر سفارشات در سمت فروش کم است و ریسک لغزش قیمت (Slippage) بالاست.'
    );
  }

  // 2. Global Gold Basis / Local Bubble Protection
  if (basisVsXauPct > 1.65) {
    rejectionReasonsFa.push(
      `توکن ${market.baseSymbol} حدود +${basisVsXauPct.toFixed(2)}٪ بالاتر از انس جهانی معامله می‌شود (حباب مثبت محلی)؛ خودداری از ورود در سقف کاذب.`
    );
  }

  // 3. Trend, Momentum, Multi-Timeframe & Fake-Pump Filter
  const emaAlignedBullish = tech.ema9 > tech.ema21 && tech.ema21 >= tech.ema50 * 0.999;
  const macdBullish = tech.macdHistogram > 0 || tech.macdLine > tech.macdSignal;
  const healthyRsi = tech.rsi14 >= 38 && tech.rsi14 <= 67;

  if (tech.fakePumpRisk) {
    rejectionReasonsFa.push(
      'تشخیص جهش ناگهانی بدون پشتوانه حجم یا سایه بالایی سنگین در طلا؛ پرهیز از تله ورود دیرهنگام.'
    );
  }
  if (tech.rsi14 > 67) {
    rejectionReasonsFa.push(
      `شاخص RSI طلا (${tech.rsi14.toFixed(1)}) در ناحیه اشباع خرید قرار دارد؛ ریسک اصلاح کوتاه‌مدت بالاست.`
    );
  }
  if (tech.breakoutState === 'BREAKDOWN_RISK') {
    rejectionReasonsFa.push(
      'سطح حمایت کوتاه‌مدت در معرض شکست رو به پایین است؛ ورود ممنوع تا تایید بازگشت روند.'
    );
  }

  let setupScore = 35;
  let setupTypeFa = 'رصد نوسان طلا';

  if (tech.breakoutState === 'CONFIRMED_BULLISH_BREAKOUT') {
    setupScore += 32;
    setupTypeFa = 'شکست معتبر مقاومت با تایید حجم';
    reasonsFa.push(
      `شکست معتبر سقف کوتاه‌مدت با نسبت حجم ${tech.volumeRatio.toFixed(2)} برابر میانگین ۲۰ کندل اخیر.`
    );
  } else if (tech.breakoutState === 'SUPPORT_REVERSAL_CONFIRMED') {
    setupScore += 28;
    setupTypeFa = 'بازگشت تاییدشده از سطح حمایت';
    reasonsFa.push(
      `واکنش مثبت و تاییدشده به حمایت معتبر (${formatGoldPrice(tech.supportLevel, market.quoteSymbol)}) همراه با چرخش هیستوگرام MACD.`
    );
  } else if (emaAlignedBullish && macdBullish && tech.volumeRatio >= 0.95) {
    setupScore += 24;
    setupTypeFa = 'ادامه روند صعودی تاییدشده (EMA 9/21/50)';
    reasonsFa.push(
      `آرایش صعودی میانگین‌های متحرک EMA 9 > EMA 21 > EMA 50 و نوسان کنترل‌شده ATR (${tech.atrPct.toFixed(2)}٪).`
    );
  } else {
    rejectionReasonsFa.push(
      'بازار طلا در وضعیت رنج/کم‌رمق بدون تایید شکست مقاومت یا بازگشت معتبر از حمایت است.'
    );
  }

  if (emaAlignedBullish && tech.htfTrend !== 'BEARISH') {
    setupScore += 12;
    reasonsFa.push('هم‌جهتی روند کوتاه‌مدت (۱ ساعته) و تایم‌فریم بالاتر (۴ ساعته) به نفع خریداران طلا.');
  }
  if (macdBullish && healthyRsi) {
    setupScore += 10;
    reasonsFa.push(`تعادل مناسب مومنتوم (RSI: ${tech.rsi14.toFixed(1)}، ATR: ${tech.atrPct.toFixed(2)}٪).`);
  }
  if (basisVsXauPct <= 0.35 && globalXauChange24hPct >= 0) {
    setupScore += 8;
    reasonsFa.push(
      `هم‌سویی مثبت با انس جهانی طلا (${globalXauChange24hPct >= 0 ? '+' : ''}${globalXauChange24hPct.toFixed(2)}٪) بدون حباب قیمتی نامتعارف.`
    );
  }

  // 4. Net Risk/Reward Gate after Bit24 Fees + Slippage
  if (!costs.isEconomical) {
    rejectionReasonsFa.push(
      `نسبت سود خالص به ریسک پس از کسر کارمزد رفت‌وبرگشت و اسلیپیج (${costs.netRiskRewardRatio.toFixed(2)}) کمتر از حداقل استاندارد (${minNetRiskReward.toFixed(2)}) است.`
    );
  } else {
    setupScore += 10;
    reasonsFa.push(
      `نسبت سود به ریسک خالص پس از کسر ${costs.totalFrictionPct.toFixed(2)}٪ کارمزد و لغزش برابر ${costs.netRiskRewardRatio.toFixed(2)} است.`
    );
  }

  const finalScore = Math.max(8, Math.min(96, Math.round(setupScore - rejectionReasonsFa.length * 14)));
  const allGatesPassed = rejectionReasonsFa.length === 0 && finalScore >= 68;

  let action: SmartSignal['action'] = 'HOLD_WATCH';
  if (allGatesPassed) {
    action = 'BUY_CONFIRMED';
  } else if (
    tech.breakoutState === 'BREAKDOWN_RISK' ||
    tech.fakePumpRisk ||
    orderBook.spreadPct > maxAllowedSpreadPct ||
    !costs.isEconomical
  ) {
    action = 'AVOID_UNFAVORABLE';
  }

  const stopLoss = smartRoundMarketPrice(price * (1 - effectiveStopPct / 100), market.quoteSymbol);
  const takeProfit1 = smartRoundMarketPrice(price * (1 + grossTarget1Pct / 100), market.quoteSymbol);
  const takeProfit2 = smartRoundMarketPrice(price * (1 + grossTarget2Pct / 100), market.quoteSymbol);

  const summaryFa =
    action === 'BUY_CONFIRMED'
      ? `سیگنال خرید تاییدشده ${market.baseFaName} (${market.marketName}): ${setupTypeFa} با حد ضرر مشخص و نسبت R:R خالص ${costs.netRiskRewardRatio.toFixed(2)} (بدون ادعای کف مطلق).`
      : rejectionReasonsFa[0] || `در انتظار تایید شرایط کم‌ریسک‌تر در ${market.marketName}.`;

  return {
    id: `sig-gold-${market.marketName}-${Date.now()}`,
    timestamp: Date.now(),
    module: 'DIGITAL_GOLD',
    marketName: market.marketName,
    baseSymbol: market.baseSymbol,
    baseFaName: market.baseFaName,
    quoteSymbol: market.quoteSymbol,
    currentPrice: price,
    change24hPct: market.change24hPct,
    action,
    confidenceScore: finalScore,
    setupTypeFa,
    summaryFa,
    reasonsFa,
    rejectionReasonsFa,
    suggestedEntry: price,
    stopLoss,
    takeProfit1,
    takeProfit2,
    trailingStopDeltaPct: riskSettings.trailingStopPct,
    technicals: tech,
    costs,
    goldComparison,
    executableOnBit24: market.spotActive,
  };
}

export function evaluateGoldEarlyExit(
  position: ManagedPosition,
  candles: OhlcvCandle[]
): { shouldExit: boolean; reasonFa: string } {
  if (candles.length < 26) return { shouldExit: false, reasonFa: '' };
  const tech = buildTechnicalSnapshot(candles);
  const lastPrice = candles[candles.length - 1].c;

  if (lastPrice < tech.supportLevel * 0.9965 && tech.macdHistogram < 0) {
    return {
      shouldExit: true,
      reasonFa: 'خروج زودهنگام محافظتی: شکست سطح حمایت کلیدی طلا همراه با مومنتوم منفی MACD.',
    };
  }

  if (
    position.unrealizedPnlPct > 0.35 &&
    tech.ema9 < tech.ema21 * 0.9988 &&
    tech.macdHistogram < 0 &&
    tech.rsi14 < 45
  ) {
    return {
      shouldExit: true,
      reasonFa: 'خروج هوشمند حفظ سود: تضعیف روند کوتاه‌مدت (تقاطع نزولی EMA9/EMA21 و افت MACD).',
    };
  }

  return { shouldExit: false, reasonFa: '' };
}

function formatGoldPrice(price: number, quote: 'IRT' | 'USDT'): string {
  if (quote === 'IRT') return `${Math.round(price).toLocaleString('fa-IR')} تومان`;
  return `${price.toFixed(2)} USDT`;
}
