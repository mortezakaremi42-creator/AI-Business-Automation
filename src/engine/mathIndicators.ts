import { CandleBar, OrderBookDepth, TechnicalIndicators } from '../shared/contracts.js';

export function computeEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function computeEmaLast(values: number[], period: number): number {
  const s = computeEmaSeries(values, period);
  return s.length > 0 ? s[s.length - 1] : 0;
}

export function computeRsi14(closes: number[]): number {
  const period = 14;
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function computeMacd(closes: number[]): {
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
} {
  if (closes.length < 28) {
    return { macdLine: 0, macdSignal: 0, macdHistogram: 0 };
  }
  const ema12 = computeEmaSeries(closes, 12);
  const ema26 = computeEmaSeries(closes, 26);
  const macdSeries = closes.map((_, i) => ema12[i] - ema26[i]);
  const sigSeries = computeEmaSeries(macdSeries, 9);
  const lastIdx = closes.length - 1;
  const macdLine = macdSeries[lastIdx];
  const macdSignal = sigSeries[lastIdx];
  return {
    macdLine: Number(macdLine.toFixed(4)),
    macdSignal: Number(macdSignal.toFixed(4)),
    macdHistogram: Number((macdLine - macdSignal).toFixed(4)),
  };
}

export function computeAtr14(candles: CandleBar[]): { atr14: number; atrPct: number } {
  if (candles.length < 2) return { atr14: 0, atrPct: 0 };
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
  const period = Math.min(14, trs.length);
  const slice = trs.slice(-period);
  const atr14 = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
  const lastClose = candles[candles.length - 1].c;
  const atrPct = lastClose > 0 ? Number(((atr14 / lastClose) * 100).toFixed(2)) : 0;
  return { atr14, atrPct };
}

export function computeMultiTimeframeChanges(candles1m: CandleBar[]): {
  change1mPct: number;
  change5mPct: number;
  change15mPct: number;
  change60mPct: number;
} {
  if (candles1m.length < 2) {
    return { change1mPct: 0, change5mPct: 0, change15mPct: 0, change60mPct: 0 };
  }
  const last = candles1m[candles1m.length - 1].c;
  const pctFromAgo = (barsAgo: number) => {
    const idx = Math.max(0, candles1m.length - 1 - barsAgo);
    const base = candles1m[idx].c;
    if (base <= 0) return 0;
    return Number((((last - base) / base) * 100).toFixed(2));
  };
  return {
    change1mPct: pctFromAgo(1),
    change5mPct: pctFromAgo(5),
    change15mPct: pctFromAgo(15),
    change60mPct: pctFromAgo(60),
  };
}

export function evaluateFullTechnicals(
  candles: CandleBar[],
  orderBook: OrderBookDepth,
  change24hPct: number
): TechnicalIndicators {
  const closes = candles.map((c) => c.c);
  const lastCandle = candles[candles.length - 1] || {
    t: 0,
    o: 1,
    h: 1,
    l: 1,
    c: 1,
    v: 1,
  };
  const lastPrice = lastCandle.c;

  const ema20 = computeEmaLast(closes, 20);
  const ema50 = computeEmaLast(closes, 50);
  const rsi14 = computeRsi14(closes);
  const { macdLine, macdSignal, macdHistogram } = computeMacd(closes);
  const { atr14, atrPct } = computeAtr14(candles);

  // Support & Resistance over prior 25 bars (excluding current bar to prevent self-masking)
  const lookback = candles.slice(-26, -1);
  const priorHighs = lookback.length > 0 ? lookback.map((c) => c.h) : [lastPrice * 1.02];
  const priorLows = lookback.length > 0 ? lookback.map((c) => c.l) : [lastPrice * 0.98];
  const resistanceLevel = Math.max(...priorHighs);
  const supportLevel = Math.min(...priorLows);

  // Volume Surge Ratio vs 20-bar baseline
  const volBaselineSlice = candles.slice(-21, -1);
  const avgVol =
    volBaselineSlice.length > 0
      ? volBaselineSlice.reduce((s, c) => s + c.v, 0) / volBaselineSlice.length
      : Math.max(1, lastCandle.v);
  const volumeSurgeRatio = avgVol > 0 ? Number((lastCandle.v / avgVol).toFixed(2)) : 1;
  const abnormalVolumeDetected = volumeSurgeRatio >= 2.1;

  // Buyer Power % combining OrderBook bid pressure + recent green-bar volume share
  const recent10 = candles.slice(-10);
  const greenVol = recent10
    .filter((c) => c.c >= c.o)
    .reduce((acc, c) => acc + c.v, 0);
  const totalVol10 = recent10.reduce((acc, c) => acc + c.v, 0);
  const candleBuyerPct = totalVol10 > 0 ? (greenVol / totalVol10) * 100 : 50;
  const buyerPowerPct = Number(
    (orderBook.buyerPressurePct * 0.55 + candleBuyerPct * 0.45).toFixed(1)
  );

  // Breakout vs Healthy Pullback
  const resistanceBreakout =
    lastPrice > resistanceLevel * 0.999 &&
    volumeSurgeRatio >= 1.35 &&
    lastCandle.c > lastCandle.o;

  const distToSupportPct =
    supportLevel > 0 ? ((lastPrice - supportLevel) / supportLevel) * 100 : 5;
  const distToEma20Pct = ema20 > 0 ? Math.abs((lastPrice - ema20) / ema20) * 100 : 5;
  const healthyPullbackToSupport =
    ema20 >= ema50 * 0.996 &&
    (distToSupportPct <= 2.4 || distToEma20Pct <= 1.1) &&
    lastCandle.c > lastCandle.o &&
    rsi14 >= 38 &&
    rsi14 <= 62;

  // Prevent blind chasing of already-pumped coins & detect Pump-and-Dump traps
  const { change15mPct, change60mPct } = computeMultiTimeframeChanges(candles);
  const alreadyOverPumped =
    change24hPct >= 17.5 || change60mPct >= 9.5 || rsi14 >= 74;

  const candleRange = Math.max(1e-9, lastCandle.h - lastCandle.l);
  const upperWickRatio = (lastCandle.h - Math.max(lastCandle.o, lastCandle.c)) / candleRange;
  const pumpAndDumpRisk =
    (change15mPct >= 5.5 && volumeSurgeRatio < 0.9) ||
    (change60mPct >= 7.0 && upperWickRatio > 0.58) ||
    (alreadyOverPumped && buyerPowerPct < 45);

  return {
    rsi14,
    macdLine,
    macdSignal,
    macdHistogram,
    ema20: Number(ema20.toFixed(4)),
    ema50: Number(ema50.toFixed(4)),
    atr14: Number(atr14.toFixed(4)),
    atrPct,
    supportLevel: Number(supportLevel.toFixed(4)),
    resistanceLevel: Number(resistanceLevel.toFixed(4)),
    resistanceBreakout,
    healthyPullbackToSupport,
    volumeSurgeRatio,
    abnormalVolumeDetected,
    buyerPowerPct,
    alreadyOverPumped,
    pumpAndDumpRisk,
  };
}
