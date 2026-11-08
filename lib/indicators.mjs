/** Indicators use only complete (closed) OHLC candles. */
export function closedCloses(candles) {
  if (!Array.isArray(candles) || candles.length === 0) throw new TypeError('At least one candle is required.');
  for (const [i, candle] of candles.entries()) {
    if (!candle || candle.closed !== true) throw new Error(`Candle ${i} is not confirmed closed.`);
    if (!Number.isFinite(candle.close) || candle.close <= 0) throw new TypeError(`Candle ${i} has an invalid close.`);
  }
  return candles.map(({ close }) => close);
}

/** Wilder RSI; null until there is enough closed-candle history. */
export function calculateRsi(candles, period = 14) {
  const closes = closedCloses(candles);
  if (!Number.isInteger(period) || period < 2) throw new RangeError('RSI period must be an integer >= 2.');
  if (closes.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const alpha = 2 / (period + 1);
  const result = [];
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema += alpha * (values[i] - ema);
    result[i] = ema;
  }
  return result;
}

/** MACD(12,26,9), calculated only from the supplied closed candles. */
export function calculateMacd(candles, fast = 12, slow = 26, signal = 9) {
  const closes = closedCloses(candles);
  if (!(Number.isInteger(fast) && Number.isInteger(slow) && Number.isInteger(signal) && fast > 0 && slow > fast && signal > 0)) {
    throw new RangeError('MACD requires positive periods with slow > fast.');
  }
  if (closes.length < slow + signal - 1) return null;
  const fastEma = emaSeries(closes, fast), slowEma = emaSeries(closes, slow);
  const macd = [];
  for (let i = slow - 1; i < closes.length; i++) macd[i] = fastEma[i] - slowEma[i];
  const compactMacd = macd.slice(slow - 1);
  const signalSeries = emaSeries(compactMacd, signal);
  const line = compactMacd.at(-1), signalLine = signalSeries.at(-1);
  return { line, signal: signalLine, histogram: line - signalLine };
}
