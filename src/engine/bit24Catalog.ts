import {
  Bit24TickerMarket,
  CandleBar,
  OrderBookDepth,
} from '../shared/contracts.js';
import { computeMultiTimeframeChanges } from './mathIndicators.js';

export function roundIrtPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (price < 10) return Number(price.toFixed(4));
  if (price < 1000) return Number(price.toFixed(2));
  return Math.round(price);
}

interface CatalogSeed {
  symbol: string;
  baseCoin: string;
  faName: string;
  enName: string;
  segment: 'CRYPTO' | 'GOLD';
  basePriceIrt: number;
  change24hPct: number;
  volume24hIrt: number;
  pattern: 'PRE_PUMP_ACCUMULATION' | 'PULLBACK_BOUNCE' | 'OVERPUMPED_TRAP' | 'STEADY_GOLD' | 'LOW_VOLUME_NOISE';
}

const BIT24_OFFICIAL_SEEDS: CatalogSeed[] = [
  // ==================== CRYPTO SPOT ON BIT24 ====================
  {
    symbol: 'BTC/IRT',
    baseCoin: 'BTC',
    faName: 'بیت‌کوین',
    enName: 'Bitcoin',
    segment: 'CRYPTO',
    basePriceIrt: 8_535_000_000,
    change24hPct: 3.15,
    volume24hIrt: 192_000_000_000,
    pattern: 'PRE_PUMP_ACCUMULATION',
  },
  {
    symbol: 'ETH/IRT',
    baseCoin: 'ETH',
    faName: 'اتریوم',
    enName: 'Ethereum',
    segment: 'CRYPTO',
    basePriceIrt: 282_400_000,
    change24hPct: 4.1,
    volume24hIrt: 118_000_000_000,
    pattern: 'PRE_PUMP_ACCUMULATION',
  },
  {
    symbol: 'TRX/IRT',
    baseCoin: 'TRX',
    faName: 'ترون',
    enName: 'TRON',
    segment: 'CRYPTO',
    basePriceIrt: 21_650,
    change24hPct: 2.45,
    volume24hIrt: 64_500_000_000,
    pattern: 'PULLBACK_BOUNCE',
  },
  {
    symbol: 'XRP/IRT',
    baseCoin: 'XRP',
    faName: 'ریپل',
    enName: 'Ripple',
    segment: 'CRYPTO',
    basePriceIrt: 218_900,
    change24hPct: 5.2,
    volume24hIrt: 88_200_000_000,
    pattern: 'PRE_PUMP_ACCUMULATION',
  },
  {
    symbol: 'ADA/IRT',
    baseCoin: 'ADA',
    faName: 'کاردانو',
    enName: 'Cardano',
    segment: 'CRYPTO',
    basePriceIrt: 78_400,
    change24hPct: 2.9,
    volume24hIrt: 41_000_000_000,
    pattern: 'PULLBACK_BOUNCE',
  },
  {
    symbol: 'LINK/IRT',
    baseCoin: 'LINK',
    faName: 'چین‌لینک',
    enName: 'Chainlink',
    segment: 'CRYPTO',
    basePriceIrt: 1_645_000,
    change24hPct: 4.85,
    volume24hIrt: 36_800_000_000,
    pattern: 'PRE_PUMP_ACCUMULATION',
  },
  {
    symbol: 'AVAX/IRT',
    baseCoin: 'AVAX',
    faName: 'آوالانچ',
    enName: 'Avalanche',
    segment: 'CRYPTO',
    basePriceIrt: 3_120_000,
    change24hPct: 3.4,
    volume24hIrt: 29_500_000_000,
    pattern: 'PULLBACK_BOUNCE',
  },
  {
    symbol: 'DOGE/IRT',
    baseCoin: 'DOGE',
    faName: 'دوج‌کوین',
    enName: 'Dogecoin',
    segment: 'CRYPTO',
    basePriceIrt: 25_140,
    change24hPct: 5.6,
    volume24hIrt: 74_000_000_000,
    pattern: 'PRE_PUMP_ACCUMULATION',
  },
  {
    symbol: 'SHIB/IRT',
    baseCoin: 'SHIB',
    faName: 'شیبا اینو',
    enName: 'Shiba Inu',
    segment: 'CRYPTO',
    basePriceIrt: 1.674,
    change24hPct: 3.2,
    volume24hIrt: 38_400_000_000,
    pattern: 'PULLBACK_BOUNCE',
  },
  {
    symbol: 'PEPE/IRT',
    baseCoin: 'PEPE',
    faName: 'پپه',
    enName: 'Pepe',
    segment: 'CRYPTO',
    basePriceIrt: 1.045,
    change24hPct: 22.8, // قبلاً پامپ شده — برای نمایش جلوگیری از خرید کورکورانه در سقف!
    volume24hIrt: 51_000_000_000,
    pattern: 'OVERPUMPED_TRAP',
  },
  {
    symbol: 'TON/IRT',
    baseCoin: 'TON',
    faName: 'تون‌کوین',
    enName: 'Toncoin',
    segment: 'CRYPTO',
    basePriceIrt: 479_500,
    change24hPct: 1.95,
    volume24hIrt: 44_600_000_000,
    pattern: 'PULLBACK_BOUNCE',
  },
  {
    symbol: 'DOT/IRT',
    baseCoin: 'DOT',
    faName: 'پولکادات',
    enName: 'Polkadot',
    segment: 'CRYPTO',
    basePriceIrt: 592_000,
    change24hPct: -0.6,
    volume24hIrt: 19_200_000_000,
    pattern: 'LOW_VOLUME_NOISE',
  },
  {
    symbol: 'LTC/IRT',
    baseCoin: 'LTC',
    faName: 'لایت‌کوین',
    enName: 'Litecoin',
    segment: 'CRYPTO',
    basePriceIrt: 9_850_000,
    change24hPct: 2.1,
    volume24hIrt: 24_700_000_000,
    pattern: 'PULLBACK_BOUNCE',
  },
  {
    symbol: 'NEAR/IRT',
    baseCoin: 'NEAR',
    faName: 'نیر پروتکل',
    enName: 'NEAR Protocol',
    segment: 'CRYPTO',
    basePriceIrt: 458_000,
    change24hPct: 4.5,
    volume24hIrt: 27_900_000_000,
    pattern: 'PRE_PUMP_ACCUMULATION',
  },

  // ==================== GOLD AI TRADER (SEPARATE SEGMENT) ====================
  {
    symbol: 'PAXG/IRT',
    baseCoin: 'PAXG',
    faName: 'پکس گلد (طلای دیجیتال)',
    enName: 'PAX Gold (1 oz)',
    segment: 'GOLD',
    basePriceIrt: 261_200_000,
    change24hPct: 1.48,
    volume24hIrt: 32_500_000_000,
    pattern: 'STEADY_GOLD',
  },
  {
    symbol: 'XAUT/IRT',
    baseCoin: 'XAUT',
    faName: 'تتر گلد (طلای دیجیتال)',
    enName: 'Tether Gold (1 oz)',
    segment: 'GOLD',
    basePriceIrt: 260_650_000,
    change24hPct: 1.36,
    volume24hIrt: 26_800_000_000,
    pattern: 'STEADY_GOLD',
  },
];

function deterministicHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Generates realistic 1-minute OHLCV candles for a Bit24 pair without future-peeking.
 */
export function buildRealisticCandles1m(
  symbol: string,
  basePriceIrt: number,
  count = 160
): CandleBar[] {
  const seed = BIT24_OFFICIAL_SEEDS.find((s) => s.symbol === symbol);
  const pattern = seed?.pattern || 'PULLBACK_BOUNCE';
  const hash = deterministicHash(symbol);
  const nowSec = Math.floor(Date.now() / 60) * 60;
  const startSec = nowSec - (count - 1) * 60;

  const bars: CandleBar[] = [];
  let prevClose = basePriceIrt * 0.985;

  for (let i = 0; i < count; i++) {
    const progress = i / Math.max(1, count - 1);
    const wave =
      Math.sin((i + (hash % 19)) * 0.21) * 0.0045 +
      Math.cos((i + (hash % 11)) * 0.09) * 0.003;

    let trendFactor = 1.0;
    let volMult = 1.0 + ((i * 7 + hash) % 10) * 0.06;

    if (pattern === 'PRE_PUMP_ACCUMULATION') {
      // Quiet accumulation followed by fresh breakout + buyer volume in final 8 bars
      if (progress < 0.88) {
        trendFactor = 0.982 + progress * 0.014 + wave;
      } else {
        const tail = (progress - 0.88) / 0.12;
        trendFactor = 0.996 + tail * 0.022 + wave * 0.3;
        volMult = 2.35 + tail * 0.9;
      }
    } else if (pattern === 'PULLBACK_BOUNCE') {
      // Uptrend + healthy pullback near EMA20 + green reversal bounce at the end
      if (progress < 0.75) {
        trendFactor = 0.975 + progress * 0.032 + wave;
      } else if (progress < 0.94) {
        const dip = (progress - 0.75) / 0.19;
        trendFactor = 0.999 - dip * 0.008 + wave * 0.25;
      } else {
        const bounce = (progress - 0.94) / 0.06;
        trendFactor = 0.991 + bounce * 0.011;
        volMult = 1.85;
      }
    } else if (pattern === 'OVERPUMPED_TRAP') {
      // Already pumped +14% with long upper wick exhaustion at top
      trendFactor = 0.90 + progress * 0.125 + Math.abs(wave);
      if (i >= count - 3) {
        volMult = 0.65; // Drying volume on spike = fake pump warning!
      }
    } else if (pattern === 'STEADY_GOLD') {
      trendFactor = 0.989 + progress * 0.012 + wave * 0.45;
      if (i >= count - 5) {
        volMult = 1.65;
      }
    } else {
      trendFactor = 0.995 + wave * 0.8;
      volMult = 0.75;
    }

    const targetClose = roundIrtPrice(basePriceIrt * trendFactor);
    const open = i === 0 ? targetClose : prevClose;
    const bodySpan = Math.abs(targetClose - open);
    const wickPad = Math.max(basePriceIrt * 0.0018, bodySpan * 0.55);
    const extraUpperWick =
      pattern === 'OVERPUMPED_TRAP' && i === count - 1 ? basePriceIrt * 0.019 : 0;

    const high = roundIrtPrice(Math.max(open, targetClose) + wickPad + extraUpperWick);
    const low = roundIrtPrice(Math.max(0.0001, Math.min(open, targetClose) - wickPad * 0.85));
    const baseVol = Math.max(10, ((seed?.volume24hIrt || 20_000_000_000) / 1440) / Math.max(1, basePriceIrt));

    bars.push({
      t: startSec + i * 60,
      o: open,
      h: high,
      l: low,
      c: targetClose,
      v: Number((baseVol * volMult).toFixed(4)),
    });
    prevClose = targetClose;
  }

  return bars;
}

export function buildSimulatedOrderBook(
  market: Bit24TickerMarket,
  candles: CandleBar[]
): OrderBookDepth {
  const last = candles[candles.length - 1]?.c || market.priceIrt;
  const seed = BIT24_OFFICIAL_SEEDS.find((s) => s.symbol === market.symbol);
  const isStrongBuy =
    seed?.pattern === 'PRE_PUMP_ACCUMULATION' || seed?.pattern === 'STEADY_GOLD';
  const isTrap = seed?.pattern === 'OVERPUMPED_TRAP';

  const halfSpreadRatio = market.segment === 'GOLD' ? 0.0009 : isTrap ? 0.0046 : 0.0013;
  const bestBid = roundIrtPrice(last * (1 - halfSpreadRatio));
  const bestAsk = roundIrtPrice(last * (1 + halfSpreadRatio));
  const spreadPct =
    bestBid > 0 ? Number((((bestAsk - bestBid) / bestBid) * 100).toFixed(3)) : 0.25;

  const bidDepthIrt = isStrongBuy ? 420_000_000 : isTrap ? 85_000_000 : 230_000_000;
  const askDepthIrt = isStrongBuy ? 210_000_000 : isTrap ? 340_000_000 : 205_000_000;
  const buyerPressurePct = Number(
    ((bidDepthIrt / Math.max(1, bidDepthIrt + askDepthIrt)) * 100).toFixed(1)
  );
  const estimatedSlippagePct = Number(
    Math.min(0.45, Math.max(0.04, (25_000_000 / Math.max(1, askDepthIrt)) * 0.35)).toFixed(3)
  );

  return {
    symbol: market.symbol,
    bestBid,
    bestAsk,
    spreadPct,
    bidDepthIrt,
    askDepthIrt,
    buyerPressurePct,
    estimatedSlippagePct,
    fromLiveOrderBook: false,
  };
}

export function createInitialBit24Catalog(): {
  markets: Bit24TickerMarket[];
  candlesBySymbol: Map<string, CandleBar[]>;
} {
  const candlesBySymbol = new Map<string, CandleBar[]>();
  const now = Date.now();

  const markets: Bit24TickerMarket[] = BIT24_OFFICIAL_SEEDS.map((s) => {
    const candles = buildRealisticCandles1m(s.symbol, s.basePriceIrt, 160);
    candlesBySymbol.set(s.symbol, candles);
    const lastPrice = candles[candles.length - 1].c;
    const mtf = computeMultiTimeframeChanges(candles);
    const volBase = Number((s.volume24hIrt / Math.max(0.0001, lastPrice)).toFixed(3));

    return {
      symbol: s.symbol,
      baseCoin: s.baseCoin,
      quoteCoin: 'IRT',
      faName: s.faName,
      enName: s.enName,
      segment: s.segment,
      tradableOnBit24: true,
      priceIrt: lastPrice,
      change1mPct: mtf.change1mPct,
      change5mPct: mtf.change5mPct,
      change15mPct: mtf.change15mPct,
      change60mPct: mtf.change60mPct,
      change24hPct: s.change24hPct,
      high24hIrt: roundIrtPrice(lastPrice * 1.032),
      low24hIrt: roundIrtPrice(lastPrice * 0.968),
      volume24hBase: volBase,
      volume24hIrt: s.volume24hIrt,
      minOrderIrt: 250_000,
      feePctPerSide: 0.2,
      updatedAt: now,
      dataFeedType: 'SIMULATED_MARKET_FEED',
    };
  });

  return { markets, candlesBySymbol };
}
