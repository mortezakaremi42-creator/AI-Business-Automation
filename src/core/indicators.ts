import {
  CostAndRewardCalc,
  OhlcvCandle,
  OrderBookLevel,
  OrderBookSnapshot,
  TechnicalSnapshot,
} from '../shared/types.js';

export function computeEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  result.push(prev);

  for (let i = 1; i < values.length; i++) {
    const next = values[i] * k + prev * (1 - k);
    result.push(next);
    prev = next;
  }
  return result;
}

export function computeEma(values: number[], period: number): number {
  const series = computeEmaSeries(values, period);
  return series.length > 0 ? series[series.length - 1] : 0;
}

export function computeRsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function computeMacd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macdLine: number; signalLine: number; histogram: number; prevHistogram: number } {
  if (closes.length < slowPeriod + 2) {
    return { macdLine: 0, signalLine: 0, histogram: 0, prevHistogram: 0 };
  }
  const emaFast = computeEmaSeries(closes, fastPeriod);
  const emaSlow = computeEmaSeries(closes, slowPeriod);
  const macdSeries = closes.map((_, idx) => emaFast[idx] - emaSlow[idx]);
  const signalSeries = computeEmaSeries(macdSeries, signalPeriod);

  const last = macdSeries.length - 1;
  const macdLine = macdSeries[last];
  const signalLine = signalSeries[last];
  const histogram = macdLine - signalLine;
  const prevHistogram = last > 0 ? macdSeries[last - 1] - signalSeries[last - 1] : histogram;

  return { macdLine, signalLine, histogram, prevHistogram };
}

export function computeAtr(candles: OhlcvCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].c;
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prevClose),
      Math.abs(cur.l - prevClose)
    );
    trs.push(tr);
  }
  if (trs.length === 0) return 0;
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Aggregates 1H candles into 4H candles strictly using historical bars (no look-ahead)
 * to evaluate Higher-Timeframe (HTF) multi-timeframe trend alignment.
 */
export function aggregateHigherTimeframeCloses(candles: OhlcvCandle[], groupSize = 4): number[] {
  if (candles.length < groupSize * 4) {
    return candles.map((c) => c.c);
  }
  const htfCloses: number[] = [];
  for (let i = groupSize - 1; i < candles.length; i += groupSize) {
    htfCloses.push(candles[i].c);
  }
  if ((candles.length - 1) % groupSize !== groupSize - 1 && candles.length > 0) {
    htfCloses.push(candles[candles.length - 1].c);
  }
  return htfCloses;
}

export function detectSupportResistance(candles: OhlcvCandle[]): {
  support: number;
  resistance: number;
  priorResistance: number;
} {
  if (candles.length < 8) {
    const last = candles[candles.length - 1]?.c ?? 1;
    return {
      support: last * 0.985,
      resistance: last * 1.018,
      priorResistance: last * 1.015,
    };
  }

  // Exclude the very last 2 candles when computing prior structural S/R so valid breakouts are detectable
  const structureWindow = candles.slice(-45, -2);
  const lows = structureWindow.map((c) => c.l).sort((a, b) => a - b);
  const highs = structureWindow.map((c) => c.h).sort((a, b) => b - a);

  const idxLow = Math.min(lows.length - 1, Math.max(0, Math.floor(lows.length * 0.15)));
  const idxHigh = Math.min(highs.length - 1, Math.max(0, Math.floor(highs.length * 0.15)));

  const lastPrice = candles[candles.length - 1].c;
  const rawSupport = lows[idxLow];
  const rawResistance = highs[idxHigh];

  const range = Math.max(lastPrice * 0.008, rawResistance - rawSupport);
  const support = rawSupport < lastPrice ? rawSupport : lastPrice * 0.985;
  const resistance =
    rawResistance > lastPrice * 1.002 ? rawResistance : rawResistance + range * 0.85;

  return {
    support,
    resistance,
    priorResistance: rawResistance,
  };
}

export function buildTechnicalSnapshot(candles: OhlcvCandle[]): TechnicalSnapshot {
  const closes = candles.map((c) => c.c);
  const volumes = candles.map((c) => c.v);
  const lastPrice = closes[closes.length - 1] || 1;
  const prevCandle = candles[candles.length - 2] ?? candles[candles.length - 1];
  const lastCandle = candles[candles.length - 1];

  const ema9 = computeEma(closes, 9);
  const ema21 = computeEma(closes, 21);
  const ema50 = computeEma(closes, 50);
  const rsi14 = computeRsi(closes, 14);
  const macd = computeMacd(closes, 12, 26, 9);
  const atr14 = computeAtr(candles, 14);
  const atrPct = lastPrice > 0 ? (atr14 / lastPrice) * 100 : 0;

  const { support, resistance, priorResistance } = detectSupportResistance(candles);
  const distanceToSupportPct =
    lastPrice > 0 ? ((lastPrice - support) / lastPrice) * 100 : 0;
  const distanceToResistancePct =
    lastPrice > 0 ? ((resistance - lastPrice) / lastPrice) * 100 : 0;

  const recentVolWindow = volumes.slice(-21, -1);
  const avgVol =
    recentVolWindow.length > 0
      ? recentVolWindow.reduce((a, b) => a + b, 0) / recentVolWindow.length
      : lastCandle?.v || 1;
  const volumeRatio = avgVol > 0 ? (lastCandle?.v || avgVol) / avgVol : 1;

  // 1. Short-term trend (1H EMA 9 vs EMA 21)
  let shortTermTrend: TechnicalSnapshot['shortTermTrend'] = 'NEUTRAL';
  if (ema9 > ema21 * 1.0008 && lastPrice >= ema9 * 0.9985) {
    shortTermTrend = 'BULLISH';
  } else if (ema9 < ema21 * 0.9992 && lastPrice <= ema9 * 1.0015) {
    shortTermTrend = 'BEARISH';
  }

  // 2. Medium-term trend (1H EMA 21 vs EMA 50)
  let mediumTermTrend: TechnicalSnapshot['mediumTermTrend'] = 'RANGING';
  const ema21To50GapPct = ema50 > 0 ? ((ema21 - ema50) / ema50) * 100 : 0;
  if (ema21To50GapPct > 0.16 && lastPrice > ema50) {
    mediumTermTrend = 'BULLISH';
  } else if (ema21To50GapPct < -0.16 && lastPrice < ema50) {
    mediumTermTrend = 'BEARISH';
  }

  // 3. Higher-Timeframe (4H aggregated) trend
  const htfCloses = aggregateHigherTimeframeCloses(candles, 4);
  const htfEmaFast = computeEma(htfCloses, 7);
  const htfEmaSlow = computeEma(htfCloses, 18);
  let htfTrend: TechnicalSnapshot['htfTrend'] = 'NEUTRAL';
  if (htfEmaFast > htfEmaSlow * 1.001) htfTrend = 'BULLISH';
  else if (htfEmaFast < htfEmaSlow * 0.999) htfTrend = 'BEARISH';

  // 4. Sudden Spike & Fake-Pump / Bull-Trap Detection (Stage 3 requirement)
  const close3Ago = closes[Math.max(0, closes.length - 4)] || lastPrice;
  const suddenSpikePct =
    close3Ago > 0 ? Number((((lastPrice - close3Ago) / close3Ago) * 100).toFixed(2)) : 0;
  const candleRange = lastCandle ? Math.max(1e-8, lastCandle.h - lastCandle.l) : 1;
  const upperWickRatio = lastCandle
    ? (lastCandle.h - Math.max(lastCandle.c, lastCandle.o)) / candleRange
    : 0;

  const isLowVolumeSpike = suddenSpikePct > Math.max(2.6, atrPct * 2.4) && volumeRatio < 0.95;
  const isUpperWickBullTrap =
    lastCandle !== undefined &&
    lastCandle.h > priorResistance * 1.001 &&
    lastPrice < priorResistance &&
    upperWickRatio > 0.52;
  const fakePumpRisk = isLowVolumeSpike || isUpperWickBullTrap;

  // 5. Confirmed Breakout OR Confirmed Support Reversal
  let breakoutState: TechnicalSnapshot['breakoutState'] = 'NONE';
  const bullishCandle =
    lastCandle && lastCandle.c > lastCandle.o && lastCandle.c > prevCandle.c;

  if (fakePumpRisk) {
    breakoutState = 'FAKE_BREAKOUT_TRAP';
  } else if (
    bullishCandle &&
    lastPrice > priorResistance * 1.0008 &&
    volumeRatio >= 1.12 &&
    macd.histogram >= macd.prevHistogram
  ) {
    breakoutState = 'CONFIRMED_BULLISH_BREAKOUT';
  } else if (
    bullishCandle &&
    distanceToSupportPct >= 0.1 &&
    distanceToSupportPct <= 1.65 &&
    rsi14 >= 34 &&
    rsi14 <= 60 &&
    macd.histogram > macd.prevHistogram
  ) {
    breakoutState = 'SUPPORT_REVERSAL_CONFIRMED';
  } else if (
    lastPrice < support * 0.998 ||
    (shortTermTrend === 'BEARISH' && rsi14 < 38 && !bullishCandle)
  ) {
    breakoutState = 'BREAKDOWN_RISK';
  }

  return {
    ema9,
    ema21,
    ema50,
    rsi14,
    macdLine: macd.macdLine,
    macdSignal: macd.signalLine,
    macdHistogram: macd.histogram,
    atr14,
    atrPct: Number(atrPct.toFixed(3)),
    supportLevel: support,
    resistanceLevel: resistance,
    distanceToSupportPct: Number(distanceToSupportPct.toFixed(2)),
    distanceToResistancePct: Number(distanceToResistancePct.toFixed(2)),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    shortTermTrend,
    mediumTermTrend,
    htfTrend,
    suddenSpikePct,
    fakePumpRisk,
    breakoutState,
  };
}

export function buildOrderBookSnapshot(
  symbol: string,
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  targetOrderQuoteSize: number,
  isLiveOrderBook = false
): OrderBookSnapshot {
  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

  const bestBid = sortedBids[0]?.price || 0;
  const bestAsk = sortedAsks[0]?.price || 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestAsk || bestBid || 1;
  const spreadPct = bestBid > 0 && bestAsk > 0 ? ((bestAsk - bestBid) / mid) * 100 : 0.25;

  const bidDepthQuote = sortedBids.slice(0, 10).reduce((acc, lvl) => acc + lvl.total, 0);
  const askDepthQuote = sortedAsks.slice(0, 10).reduce((acc, lvl) => acc + lvl.total, 0);

  let remainingQuote = Math.max(1, targetOrderQuoteSize);
  let spentQuote = 0;
  let acquiredBase = 0;

  for (const ask of sortedAsks) {
    if (remainingQuote <= 0) break;
    const takeQuote = Math.min(remainingQuote, ask.total);
    if (ask.price > 0) {
      acquiredBase += takeQuote / ask.price;
      spentQuote += takeQuote;
      remainingQuote -= takeQuote;
    }
  }

  let estimatedSlippagePct = 0.08;
  if (acquiredBase > 0 && bestAsk > 0) {
    const avgFill = spentQuote / acquiredBase;
    const bookImpact = ((avgFill - bestAsk) / bestAsk) * 100;
    const unfilledPenalty = remainingQuote > 0 ? 0.35 : 0;
    estimatedSlippagePct = Math.max(0.03, bookImpact + unfilledPenalty);
  }

  return {
    symbol,
    bestBid,
    bestAsk,
    spreadPct: Number(spreadPct.toFixed(3)),
    bidDepthQuote,
    askDepthQuote,
    estimatedSlippagePct: Number(estimatedSlippagePct.toFixed(3)),
    bids: sortedBids.slice(0, 10),
    asks: sortedAsks.slice(0, 10),
    isLiveOrderBook,
  };
}

export function evaluateTradeEconomics(params: {
  feePctPerSide: number;
  spreadPct: number;
  estimatedSlippagePct: number;
  grossTargetPct: number;
  stopDistancePct: number;
  minNetRiskReward: number;
}): CostAndRewardCalc {
  const roundTripFeePct = params.feePctPerSide * 2;
  const totalFrictionPct =
    roundTripFeePct + params.spreadPct * 0.5 + params.estimatedSlippagePct * 2;

  const netRewardPct = Math.max(0, params.grossTargetPct - totalFrictionPct);
  const netRiskPct = Math.max(0.15, params.stopDistancePct + totalFrictionPct);
  const netRiskRewardRatio = netRewardPct / netRiskPct;

  return {
    makerFeePct: params.feePctPerSide,
    takerFeePct: params.feePctPerSide,
    roundTripFeePct: Number(roundTripFeePct.toFixed(3)),
    spreadPct: Number(params.spreadPct.toFixed(3)),
    estimatedSlippagePct: Number(params.estimatedSlippagePct.toFixed(3)),
    totalFrictionPct: Number(totalFrictionPct.toFixed(3)),
    grossTargetPct: Number(params.grossTargetPct.toFixed(2)),
    stopDistancePct: Number(params.stopDistancePct.toFixed(2)),
    netRewardPct: Number(netRewardPct.toFixed(2)),
    netRiskPct: Number(netRiskPct.toFixed(2)),
    netRiskRewardRatio: Number(netRiskRewardRatio.toFixed(2)),
    isEconomical: netRewardPct > 0.35 && netRiskRewardRatio >= params.minNetRiskReward,
  };
}
