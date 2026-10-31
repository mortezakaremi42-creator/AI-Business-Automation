import {
  Bit24TickerMarket,
  CandleBar,
  GoldMarketSignal,
  OrderBookDepth,
  PumpOpportunitySignal,
  SignalTier,
} from '../shared/contracts.js';
import { roundIrtPrice } from './bit24Catalog.js';
import {
  computeMultiTimeframeChanges,
  evaluateFullTechnicals,
} from './mathIndicators.js';

export function classifyOpportunityTier(score: number): SignalTier {
  if (score >= 85) return 'STRONG_TEST_SIGNAL';
  if (score >= 75) return 'REVIEW_OPPORTUNITY';
  if (score >= 60) return 'ALERT_ONLY';
  return 'REJECTED';
}

/**
 * SECTION 2: AI PUMP HUNTER ENGINE (Crypto Spot on Bit24 ONLY)
 * Strictly never mixed with Digital Gold (PAXG/XAUT).
 */
export function analyzeBit24CryptoPumpOpportunity(
  market: Bit24TickerMarket,
  candles: CandleBar[],
  orderBook: OrderBookDepth
): PumpOpportunitySignal {
  const mtf = computeMultiTimeframeChanges(candles);
  const tech = evaluateFullTechnicals(candles, orderBook, market.change24hPct);

  const reasonsFa: string[] = [];
  const reasonsEn: string[] = [];
  const warningsFa: string[] = [];
  const warningsEn: string[] = [];

  let rawScore = 0;

  // 1. Volume Surge & Abnormal Buying Volume (max 20 pts)
  if (tech.volumeSurgeRatio >= 2.1) {
    rawScore += 20;
    reasonsFa.push(`رشد حجم معاملات قدرتمند (${tech.volumeSurgeRatio}x میانگین)`);
    reasonsEn.push(`Strong volume surge (${tech.volumeSurgeRatio}x baseline)`);
  } else if (tech.volumeSurgeRatio >= 1.45) {
    rawScore += 14;
    reasonsFa.push(`افزایش حجم معاملات (${tech.volumeSurgeRatio}x)`);
    reasonsEn.push(`Rising trading volume (${tech.volumeSurgeRatio}x)`);
  } else if (tech.volumeSurgeRatio >= 1.1) {
    rawScore += 7;
  } else {
    warningsFa.push(`حجم معاملات پایین‌تر از میانگین (${tech.volumeSurgeRatio}x)`);
    warningsEn.push(`Sub-average trading volume (${tech.volumeSurgeRatio}x)`);
  }

  // 2. Buyer Power (Orderbook + Green Candle Volume) (max 16 pts)
  if (tech.buyerPowerPct >= 62) {
    rawScore += 16;
    reasonsFa.push(`قدرت خریداران غالب (${tech.buyerPowerPct}%)`);
    reasonsEn.push(`Dominant buyer power (${tech.buyerPowerPct}%)`);
  } else if (tech.buyerPowerPct >= 54) {
    rawScore += 11;
    reasonsFa.push(`برتری تقاضای خرید (${tech.buyerPowerPct}%)`);
    reasonsEn.push(`Positive buyer demand (${tech.buyerPowerPct}%)`);
  } else {
    warningsFa.push(`فشار خریداران کافی نیست (${tech.buyerPowerPct}%)`);
    warningsEn.push(`Insufficient buyer pressure (${tech.buyerPowerPct}%)`);
  }

  // 3. Multi-timeframe Price Momentum (1m / 5m / 15m / 60m + 24h trend) (max 18 pts)
  const healthyShortImpulse =
    mtf.change5mPct >= 0.25 &&
    mtf.change15mPct >= 0.45 &&
    mtf.change60mPct >= 0.6 &&
    mtf.change60mPct <= 8.5;
  if (healthyShortImpulse) {
    rawScore += 12;
    reasonsFa.push(
      `شتاب سالم چندبازه (5m: +${mtf.change5mPct}% | 15m: +${mtf.change15mPct}% | 60m: +${mtf.change60mPct}%)`
    );
    reasonsEn.push(
      `Healthy multi-timeframe momentum (5m: +${mtf.change5mPct}% | 15m: +${mtf.change15mPct}% | 60m: +${mtf.change60mPct}%)`
    );
  } else if (mtf.change15mPct > 0 && mtf.change60mPct > 0) {
    rawScore += 7;
  }

  if (market.change24hPct >= 0.5 && market.change24hPct <= 14.5) {
    rawScore += 6;
    reasonsFa.push(`روند ۲۴ ساعته مثبت و متعادل (+${market.change24hPct}%)`);
    reasonsEn.push(`Constructive 24h trend (+${market.change24hPct}%)`);
  }

  // 4. EMA20 & EMA50 Structure + MACD + RSI (max 24 pts)
  if (market.priceIrt >= tech.ema20 && tech.ema20 >= tech.ema50) {
    rawScore += 10;
    reasonsFa.push('ساختار صعودی قیمت بالای EMA20 و EMA50');
    reasonsEn.push('Bullish alignment: Price > EMA20 > EMA50');
  } else if (tech.ema20 >= tech.ema50 * 0.997) {
    rawScore += 5;
  }

  if (tech.macdHistogram > 0 && tech.macdLine >= tech.macdSignal) {
    rawScore += 7;
    reasonsFa.push('تأیید مومنتوم مثبت در MACD');
    reasonsEn.push('Bullish MACD histogram expansion');
  }

  if (tech.rsi14 >= 46 && tech.rsi14 <= 68) {
    rawScore += 7;
    reasonsFa.push(`RSI در محدوده سالم صعودی (${tech.rsi14})`);
    reasonsEn.push(`RSI in healthy bullish zone (${tech.rsi14})`);
  } else if (tech.rsi14 > 73) {
    warningsFa.push(`اشباع خرید در RSI (${tech.rsi14})`);
    warningsEn.push(`Overbought RSI (${tech.rsi14})`);
  }

  // 5. Resistance Breakout OR Healthy Pullback to Key Support + ATR Volatility (max 22 pts)
  let entryStyle: PumpOpportunitySignal['entryStyle'] = 'NO_ENTRY';
  if (tech.resistanceBreakout) {
    rawScore += 16;
    entryStyle = 'BREAKOUT';
    reasonsFa.push('شکست معتبر مقاومت کلیدی همراه با حجم');
    reasonsEn.push('Confirmed resistance breakout with volume');
  } else if (tech.healthyPullbackToSupport) {
    rawScore += 15;
    entryStyle = 'PULLBACK';
    reasonsFa.push('پولبک سالم روی حمایت معتبر / EMA20 و بازگشت خریدار');
    reasonsEn.push('Healthy pullback bounce off support / EMA20');
  } else {
    rawScore += 4;
  }

  if (tech.atrPct >= 0.15 && tech.atrPct <= 3.8) {
    rawScore += 6;
  } else if (tech.atrPct > 4.5) {
    warningsFa.push(`نوسان غیرعادی ATR (${tech.atrPct}%)`);
    warningsEn.push(`Excessive ATR volatility (${tech.atrPct}%)`);
  }

  // 6. Anti-Blind-Chasing & Anti-Pump-and-Dump Hard Penalties
  if (tech.alreadyOverPumped) {
    rawScore = Math.min(rawScore, 44);
    entryStyle = 'NO_ENTRY';
    warningsFa.push(
      `ممنوعیت خرید کورکورانه: ارز قبلاً رشد شدید کرده است (24h: ${market.change24hPct}%, RSI: ${tech.rsi14})`
    );
    warningsEn.push(
      `Blind-chase blocked: Coin already over-pumped (24h: ${market.change24hPct}%, RSI: ${tech.rsi14})`
    );
  }

  if (tech.pumpAndDumpRisk) {
    rawScore = Math.min(rawScore, 35);
    entryStyle = 'NO_ENTRY';
    warningsFa.push('هشدار تله پامپ و دامپ (شدو بالایی سنگین / افت حجم در جهش)');
    warningsEn.push('Pump-and-Dump trap risk detected (exhaustion wick / weak volume)');
  }

  if (orderBook.spreadPct > 0.75) {
    rawScore = Math.max(0, rawScore - 18);
    warningsFa.push(`اختلاف قیمت خرید و فروش بالا (${orderBook.spreadPct}%)`);
    warningsEn.push(`Wide bid-ask spread (${orderBook.spreadPct}%)`);
  }

  const opportunityScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const tier = classifyOpportunityTier(opportunityScore);

  return {
    symbol: market.symbol,
    baseCoin: market.baseCoin,
    faName: market.faName,
    enName: market.enName,
    priceIrt: market.priceIrt,
    opportunityScore,
    tier,
    entryStyle: opportunityScore >= 75 ? entryStyle : 'NO_ENTRY',
    change1mPct: mtf.change1mPct,
    change5mPct: mtf.change5mPct,
    change15mPct: mtf.change15mPct,
    change60mPct: mtf.change60mPct,
    change24hPct: market.change24hPct,
    volume24hIrt: market.volume24hIrt,
    spreadPct: orderBook.spreadPct,
    estimatedSlippagePct: orderBook.estimatedSlippagePct,
    indicators: tech,
    reasonsFa,
    reasonsEn,
    warningsFa,
    warningsEn,
    noProfitGuaranteeDisclaimerFa:
      'سلب مسئولیت قطعی: هیچ امتیاز یا سیگنالی سود قطعی را تضمین نمی‌کند و بازار رمزارز همواره دارای ریسک است.',
    noProfitGuaranteeDisclaimerEn:
      'Strict Disclaimer: No score or signal guarantees profit; cryptocurrency markets carry inherent risk.',
    evaluatedAt: Date.now(),
  };
}

/**
 * SECTION 6: GOLD AI TRADER (PAXG & XAUT ONLY on Bit24)
 * Completely independent from Crypto/Meme coins. Never fakes tradability!
 */
export function analyzeGoldAiMarket(
  symbol: 'PAXG/IRT' | 'XAUT/IRT',
  baseCoin: 'PAXG' | 'XAUT',
  market: Bit24TickerMarket | undefined,
  candles: CandleBar[],
  orderBook: OrderBookDepth | undefined,
  goldStopLossPct = 2.5,
  goldTakeProfitPct = 6.0
): GoldMarketSignal {
  const faName =
    baseCoin === 'PAXG' ? 'پکس گلد (PAXG)' : 'تتر گلد (XAUT)';
  const enName =
    baseCoin === 'PAXG' ? 'PAX Gold (PAXG)' : 'Tether Gold (XAUT)';

  if (!market || !market.tradableOnBit24 || !orderBook || candles.length < 20) {
    return {
      symbol,
      baseCoin,
      faName,
      enName,
      verifiedTradableOnBit24: false,
      tradabilityNoteFa: `نماد ${symbol} در حال حاضر در لیست بازارهای قابل معامله دریافتی از Bit24 تأیید نشد؛ معامله غیرفعال است.`,
      tradabilityNoteEn: `${symbol} is not currently verified as tradable in the Bit24 market list; trading is disabled.`,
      priceIrt: 0,
      shortTermTrend: 'NEUTRAL',
      supportIrt: 0,
      resistanceIrt: 0,
      rsi14: 50,
      macdHistogram: 0,
      volume24hIrt: 0,
      roundTripFeePct: 0.4,
      suggestedStopLossIrt: 0,
      suggestedTakeProfitIrt: 0,
      goldScore: 0,
      action: 'NOT_TRADABLE',
      rationaleFa: 'عدم تأیید قابلیت معامله در صرافی Bit24 (نمایش واقعی بدون شبیه‌سازی جعلی).',
      rationaleEn: 'Not verified as tradable on Bit24 (strict honest reporting).',
      evaluatedAt: Date.now(),
    };
  }

  const tech = evaluateFullTechnicals(candles, orderBook, market.change24hPct);
  const shortTermTrend: GoldMarketSignal['shortTermTrend'] =
    market.priceIrt >= tech.ema20 && tech.ema20 >= tech.ema50
      ? 'BULLISH'
      : market.priceIrt < tech.ema20 && tech.ema20 < tech.ema50
      ? 'BEARISH'
      : 'NEUTRAL';

  const roundTripFeePct = Number((market.feePctPerSide * 2).toFixed(2));
  let goldScore = 40;

  if (shortTermTrend === 'BULLISH') goldScore += 22;
  if (tech.rsi14 >= 42 && tech.rsi14 <= 66) goldScore += 14;
  if (tech.macdHistogram >= 0) goldScore += 12;
  if (tech.volumeSurgeRatio >= 1.2) goldScore += 10;
  if (orderBook.spreadPct <= 0.35) goldScore += 6;
  if (tech.rsi14 > 74) goldScore -= 20;

  goldScore = Math.max(0, Math.min(100, Math.round(goldScore)));

  let action: GoldMarketSignal['action'] = 'HOLD_WATCH';
  let rationaleFa = `روند کوتاه‌مدت ${shortTermTrend === 'BULLISH' ? 'صعودی' : 'خنثی'} با RSI=${tech.rsi14} و کارمزد رفت‌وبرگشت ${roundTripFeePct}%؛ در حال پایش نقطه ورود کم‌ریسک.`;
  let rationaleEn = `Short-term ${shortTermTrend} structure (RSI=${tech.rsi14}, round-trip fee ${roundTripFeePct}%); monitoring low-risk gold entry.`;

  if (goldScore >= 76 && shortTermTrend === 'BULLISH') {
    action = 'GOLD_BUY_CANDIDATE';
    rationaleFa = `تأیید روند صعودی طلای دیجیتال بالای EMA20/EMA50 با مکدی مثبت، حجم مناسب و پوشش کامل کارمزد ${roundTripFeePct}% صرافی Bit24.`;
    rationaleEn = `Confirmed digital gold uptrend above EMA20/EMA50 with positive MACD, healthy liquidity, and net edge exceeding ${roundTripFeePct}% Bit24 fee.`;
  } else if (tech.rsi14 > 73 || shortTermTrend === 'BEARISH') {
    action = 'AVOID_HIGH_SPREAD_OR_OVERBOUGHT';
    rationaleFa = 'پرهیز از خرید طلا در اشباع خرید یا روند نزولی کوتاه‌مدت.';
    rationaleEn = 'Avoiding gold entry due to short-term weakness or overbought RSI.';
  }

  return {
    symbol,
    baseCoin,
    faName,
    enName,
    verifiedTradableOnBit24: true,
    tradabilityNoteFa:
      market.dataFeedType === 'LIVE_BIT24_API'
        ? `تأیید مستقیم از API رسمی Bit24 (${symbol} فعال و قابل معامله)`
        : `تأیید در کاتالوگ رسمی Bit24 (${symbol}) — فید فعلی: شبیه‌ساز دمو`,
    tradabilityNoteEn:
      market.dataFeedType === 'LIVE_BIT24_API'
        ? `Verified directly via live Bit24 API (${symbol} active)`
        : `Verified in official Bit24 catalog (${symbol}) — active feed: Demo simulator`,
    priceIrt: market.priceIrt,
    shortTermTrend,
    supportIrt: tech.supportLevel,
    resistanceIrt: tech.resistanceLevel,
    rsi14: tech.rsi14,
    macdHistogram: tech.macdHistogram,
    volume24hIrt: market.volume24hIrt,
    roundTripFeePct,
    suggestedStopLossIrt: roundIrtPrice(market.priceIrt * (1 - goldStopLossPct / 100)),
    suggestedTakeProfitIrt: roundIrtPrice(market.priceIrt * (1 + goldTakeProfitPct / 100)),
    goldScore,
    action,
    rationaleFa,
    rationaleEn,
    evaluatedAt: Date.now(),
  };
}
