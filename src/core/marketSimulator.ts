import {
  Bit24EndpointCapability,
  Bit24MarketInfo,
  OhlcvCandle,
  OrderBookLevel,
  OrderBookSnapshot,
} from '../shared/types.js';
import { buildOrderBookSnapshot } from './indicators.js';

export function smartRoundMarketPrice(val: number, quote: 'IRT' | 'USDT'): number {
  if (!Number.isFinite(val)) return 0;
  if (quote === 'IRT') {
    if (val < 10) return Number(val.toFixed(4));
    if (val < 1000) return Number(val.toFixed(2));
    return Math.round(val);
  }
  if (val < 0.001) return Number(val.toFixed(8));
  if (val < 1) return Number(val.toFixed(5));
  if (val < 100) return Number(val.toFixed(3));
  return Number(val.toFixed(2));
}

export const OFFICIAL_BIT24_CAPABILITIES: Bit24EndpointCapability[] = [
  {
    id: 'markets-v2',
    featureFa: 'دریافت فهرست بازارها، قیمت لحظه‌ای و وضعیت نمادها (PAXG، XAUT، کریپتو و میم‌کوین‌ها)',
    method: 'GET',
    endpoint: '/pro/capi/v2/markets',
    officialSupport: 'SUPPORTED',
    requiresSecretSignature: false,
    notesFa: 'پشتیبانی رسمی در CAPI v2؛ اسکن زنده نمادهای طلا، ارزهای اصلی و میم‌کوین‌های لیست‌شده در بیت‌۲۴.',
  },
  {
    id: 'ohlcv-v2',
    featureFa: 'دریافت کندل‌های تاریخی قیمت و حجم (OHLCV)',
    method: 'GET',
    endpoint: '/pro/capi/v2/markets/ohclv',
    officialSupport: 'SUPPORTED',
    requiresSecretSignature: false,
    notesFa: 'پشتیبانی رسمی (املای رسمی ohclv در مستندات بیت‌۲۴) برای تشخیص کف حمایتی و استارت پامپ.',
  },
  {
    id: 'orderbook-v2',
    featureFa: 'دریافت عمق دفتر سفارشات و محاسبه اسپرد خرید/فروش',
    method: 'GET',
    endpoint: '/pro/capi/v2/markets/order-books',
    officialSupport: 'SUPPORTED',
    requiresSecretSignature: false,
    notesFa: 'حیاتی برای میم‌کوین‌ها جهت جلوگیری از خرید در اسپرد بالا یا دفتر سفارشات کم‌عمق.',
  },
  {
    id: 'wallet-v1',
    featureFa: 'مشاهده موجودی کیف پول اسپات، ربات و مارجین (تومان و تتر)',
    method: 'GET',
    endpoint: '/asset/capi/v1/wallet/assets/total',
    officialSupport: 'SUPPORTED',
    requiresSecretSignature: false,
    notesFa: 'تفکیک رسمی دارایی‌های اسپات (user)، ربات (bot) و اهرم‌دار (margin) در تومان و تتر.',
  },
  {
    id: 'spot-submit-v2',
    featureFa: 'ثبت خودکار سفارش خرید در کف و فروش در رشد (طلا + کریپتو + میم‌کوین اسپات)',
    method: 'POST',
    endpoint: '/pro/capi/v2/spot-orders/submit',
    officialSupport: 'SUPPORTED',
    requiresSecretSignature: true,
    notesFa: 'پشتیبانی از Limit (0)، Market (1)، Stop-Limit (2)، OCO (3) و Trailing-Stop (5) با امضای HMAC-SHA256.',
  },
  {
    id: 'spot-cancel-v2',
    featureFa: 'لغو تکی یا یک‌جای تمامی سفارش‌های باز اسپات (ویژه توقف اضطراری)',
    method: 'POST',
    endpoint: '/pro/capi/v2/spot-orders/cancel',
    officialSupport: 'SUPPORTED',
    requiresSecretSignature: true,
    notesFa: 'در صورت عدم ارسال order_id تمام سفارش‌های در حال انجام اسپات فوراً لغو می‌شوند.',
  },
  {
    id: 'margin-v2',
    featureFa: 'معاملات اهرم‌دار مارجین (ثبت Limit، ویرایش TP/SL و بستن موقعیت)',
    method: 'POST',
    endpoint: '/pro/capi/v2/margin-orders/orders/submit',
    officialSupport: 'CONDITIONAL',
    requiresSecretSignature: true,
    notesFa: 'فقط برای سفارش Limit (type=0) روی نمادهای دارای margin_order_status=1؛ پیش‌فرض خاموش.',
  },
  {
    id: 'withdraw-blocked',
    featureFa: 'برداشت ریالی یا رمزارزی از حساب کاربری',
    method: 'BLOCKED',
    endpoint: '/lite/capi/v1/withdraw/submit [مسدودشده امنیتی]',
    officialSupport: 'SECURITY_BLOCKED',
    requiresSecretSignature: true,
    notesFa: 'کد برداشت وجه به‌طور کامل حذف و در لایه کلاینت، پروکسی و سرور مسدود شده است.',
  },
];

export function createInitialBit24Markets(
  usdtIrt = 88_500,
  globalXauUsd = 2945
): Bit24MarketInfo[] {
  const paxgUsd = Number((globalXauUsd * 1.0018).toFixed(2));
  const xautUsd = Number((globalXauUsd * 0.9994).toFixed(2));

  return [
    // ==================== DIGITAL GOLD ====================
    {
      id: 201,
      marketName: 'PAXG/IRT',
      baseSymbol: 'PAXG',
      baseFaName: 'پکس گلد (طلای دیجیتال)',
      quoteSymbol: 'IRT',
      category: 'GOLD',
      eachPrice: Math.round(paxgUsd * usdtIrt),
      change24hPct: 1.42,
      volume24hBase: 94.6,
      volume24hQuote: Math.round(94.6 * paxgUsd * usdtIrt),
      high24h: Math.round(paxgUsd * usdtIrt * 1.018),
      low24h: Math.round(paxgUsd * usdtIrt * 0.986),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 3,
      hourlyRolloverFeePct: 0.007,
    },
    {
      id: 202,
      marketName: 'XAUT/IRT',
      baseSymbol: 'XAUT',
      baseFaName: 'تتر گلد (طلای دیجیتال)',
      quoteSymbol: 'IRT',
      category: 'GOLD',
      eachPrice: Math.round(xautUsd * usdtIrt),
      change24hPct: 1.35,
      volume24hBase: 78.2,
      volume24hQuote: Math.round(78.2 * xautUsd * usdtIrt),
      high24h: Math.round(xautUsd * usdtIrt * 1.016),
      low24h: Math.round(xautUsd * usdtIrt * 0.987),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 3,
      hourlyRolloverFeePct: 0.007,
    },
    {
      id: 203,
      marketName: 'PAXG/USDT',
      baseSymbol: 'PAXG',
      baseFaName: 'پکس گلد / تتر',
      quoteSymbol: 'USDT',
      category: 'GOLD',
      eachPrice: paxgUsd,
      change24hPct: 1.18,
      volume24hBase: 62.4,
      volume24hQuote: Number((62.4 * paxgUsd).toFixed(2)),
      high24h: Number((paxgUsd * 1.014).toFixed(2)),
      low24h: Number((paxgUsd * 0.989).toFixed(2)),
      minOrderQuote: 5,
      spotActive: true,
      marginActive: false,
      maxLeverage: 1,
      hourlyRolloverFeePct: 0.007,
    },
    {
      id: 204,
      marketName: 'XAUT/USDT',
      baseSymbol: 'XAUT',
      baseFaName: 'تتر گلد / تتر',
      quoteSymbol: 'USDT',
      category: 'GOLD',
      eachPrice: xautUsd,
      change24hPct: 1.12,
      volume24hBase: 51.8,
      volume24hQuote: Number((51.8 * xautUsd).toFixed(2)),
      high24h: Number((xautUsd * 1.013).toFixed(2)),
      low24h: Number((xautUsd * 0.99).toFixed(2)),
      minOrderQuote: 5,
      spotActive: true,
      marginActive: false,
      maxLeverage: 1,
      hourlyRolloverFeePct: 0.007,
    },

    // ==================== MEME COINS ON BIT24 ====================
    {
      id: 301,
      marketName: 'DOGE/IRT',
      baseSymbol: 'DOGE',
      baseFaName: 'دوج‌کوین (میم‌کوین)',
      quoteSymbol: 'IRT',
      category: 'MEME',
      eachPrice: Math.round(0.284 * usdtIrt),
      change24hPct: 4.85,
      volume24hBase: 1_850_000,
      volume24hQuote: Math.round(1_850_000 * 0.284 * usdtIrt),
      high24h: Math.round(0.296 * usdtIrt),
      low24h: Math.round(0.268 * usdtIrt),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 3,
      hourlyRolloverFeePct: 0.01,
    },
    {
      id: 302,
      marketName: 'PEPE/IRT',
      baseSymbol: 'PEPE',
      baseFaName: 'پپه (میم‌کوین)',
      quoteSymbol: 'IRT',
      category: 'MEME',
      eachPrice: smartRoundMarketPrice(0.0000118 * usdtIrt, 'IRT'),
      change24hPct: 6.42,
      volume24hBase: 24_000_000_000,
      volume24hQuote: Math.round(24_000_000_000 * 0.0000118 * usdtIrt),
      high24h: smartRoundMarketPrice(0.0000125 * usdtIrt, 'IRT'),
      low24h: smartRoundMarketPrice(0.0000109 * usdtIrt, 'IRT'),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 3,
      hourlyRolloverFeePct: 0.012,
    },
    {
      id: 303,
      marketName: 'SHIB/IRT',
      baseSymbol: 'SHIB',
      baseFaName: 'شیبا اینو (میم‌کوین)',
      quoteSymbol: 'IRT',
      category: 'MEME',
      eachPrice: smartRoundMarketPrice(0.0000189 * usdtIrt, 'IRT'),
      change24hPct: 3.74,
      volume24hBase: 14_500_000_000,
      volume24hQuote: Math.round(14_500_000_000 * 0.0000189 * usdtIrt),
      high24h: smartRoundMarketPrice(0.0000198 * usdtIrt, 'IRT'),
      low24h: smartRoundMarketPrice(0.0000179 * usdtIrt, 'IRT'),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 3,
      hourlyRolloverFeePct: 0.011,
    },
    {
      id: 304,
      marketName: 'WIF/IRT',
      baseSymbol: 'WIF',
      baseFaName: 'داگ‌ویف‌هت (میم‌کوین)',
      quoteSymbol: 'IRT',
      category: 'MEME',
      eachPrice: Math.round(1.64 * usdtIrt),
      change24hPct: 5.65,
      volume24hBase: 210_000,
      volume24hQuote: Math.round(210_000 * 1.64 * usdtIrt),
      high24h: Math.round(1.73 * usdtIrt),
      low24h: Math.round(1.52 * usdtIrt),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: false,
      maxLeverage: 1,
      hourlyRolloverFeePct: 0.012,
    },
    {
      id: 305,
      marketName: 'BONK/IRT',
      baseSymbol: 'BONK',
      baseFaName: 'بونک (میم‌کوین)',
      quoteSymbol: 'IRT',
      category: 'MEME',
      eachPrice: smartRoundMarketPrice(0.0000242 * usdtIrt, 'IRT'),
      change24hPct: 4.18,
      volume24hBase: 9_800_000_000,
      volume24hQuote: Math.round(9_800_000_000 * 0.0000242 * usdtIrt),
      high24h: smartRoundMarketPrice(0.0000255 * usdtIrt, 'IRT'),
      low24h: smartRoundMarketPrice(0.0000228 * usdtIrt, 'IRT'),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: false,
      maxLeverage: 1,
      hourlyRolloverFeePct: 0.012,
    },
    {
      id: 306,
      marketName: 'FLOKI/IRT',
      baseSymbol: 'FLOKI',
      baseFaName: 'فلوکی (میم‌کوین)',
      quoteSymbol: 'IRT',
      category: 'MEME',
      eachPrice: smartRoundMarketPrice(0.000116 * usdtIrt, 'IRT'),
      change24hPct: 2.95,
      volume24hBase: 1_900_000_000,
      volume24hQuote: Math.round(1_900_000_000 * 0.000116 * usdtIrt),
      high24h: smartRoundMarketPrice(0.000122 * usdtIrt, 'IRT'),
      low24h: smartRoundMarketPrice(0.00011 * usdtIrt, 'IRT'),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: false,
      maxLeverage: 1,
      hourlyRolloverFeePct: 0.012,
    },
    {
      id: 307,
      marketName: 'NOT/IRT',
      baseSymbol: 'NOT',
      baseFaName: 'نات‌کوین',
      quoteSymbol: 'IRT',
      category: 'MEME',
      eachPrice: smartRoundMarketPrice(0.0064 * usdtIrt, 'IRT'),
      change24hPct: 16.8, // Overextended pump example so Anti-FOMO filter demonstrates rejecting top-chasing!
      volume24hBase: 48_000_000,
      volume24hQuote: Math.round(48_000_000 * 0.0064 * usdtIrt),
      high24h: smartRoundMarketPrice(0.0066 * usdtIrt, 'IRT'),
      low24h: smartRoundMarketPrice(0.0054 * usdtIrt, 'IRT'),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: false,
      maxLeverage: 1,
      hourlyRolloverFeePct: 0.012,
    },

    // ==================== SPOT MAJOR CRYPTO ====================
    {
      id: 101,
      marketName: 'BTC/IRT',
      baseSymbol: 'BTC',
      baseFaName: 'بیت‌کوین',
      quoteSymbol: 'IRT',
      category: 'CRYPTO',
      eachPrice: Math.round(96_450 * usdtIrt),
      change24hPct: 2.38,
      volume24hBase: 18.4,
      volume24hQuote: Math.round(18.4 * 96_450 * usdtIrt),
      high24h: Math.round(97_800 * usdtIrt),
      low24h: Math.round(94_100 * usdtIrt),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 5,
      hourlyRolloverFeePct: 0.008,
    },
    {
      id: 102,
      marketName: 'ETH/IRT',
      baseSymbol: 'ETH',
      baseFaName: 'اتریوم',
      quoteSymbol: 'IRT',
      category: 'CRYPTO',
      eachPrice: Math.round(3_185 * usdtIrt),
      change24hPct: 3.12,
      volume24hBase: 245.0,
      volume24hQuote: Math.round(245 * 3_185 * usdtIrt),
      high24h: Math.round(3_240 * usdtIrt),
      low24h: Math.round(3_075 * usdtIrt),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 5,
      hourlyRolloverFeePct: 0.008,
    },
    {
      id: 103,
      marketName: 'SOL/IRT',
      baseSymbol: 'SOL',
      baseFaName: 'سولانا',
      quoteSymbol: 'IRT',
      category: 'CRYPTO',
      eachPrice: Math.round(194.5 * usdtIrt),
      change24hPct: 4.15,
      volume24hBase: 1920,
      volume24hQuote: Math.round(1920 * 194.5 * usdtIrt),
      high24h: Math.round(199 * usdtIrt),
      low24h: Math.round(185 * usdtIrt),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 4,
      hourlyRolloverFeePct: 0.009,
    },
    {
      id: 104,
      marketName: 'TON/IRT',
      baseSymbol: 'TON',
      baseFaName: 'تون‌کوین',
      quoteSymbol: 'IRT',
      category: 'CRYPTO',
      eachPrice: Math.round(5.42 * usdtIrt),
      change24hPct: -0.84,
      volume24hBase: 42_500,
      volume24hQuote: Math.round(42_500 * 5.42 * usdtIrt),
      high24h: Math.round(5.58 * usdtIrt),
      low24h: Math.round(5.31 * usdtIrt),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: false,
      maxLeverage: 1,
      hourlyRolloverFeePct: 0.01,
    },
    {
      id: 105,
      marketName: 'XRP/IRT',
      baseSymbol: 'XRP',
      baseFaName: 'ریپل',
      quoteSymbol: 'IRT',
      category: 'CRYPTO',
      eachPrice: Math.round(2.48 * usdtIrt),
      change24hPct: 1.95,
      volume24hBase: 135_000,
      volume24hQuote: Math.round(135_000 * 2.48 * usdtIrt),
      high24h: Math.round(2.55 * usdtIrt),
      low24h: Math.round(2.41 * usdtIrt),
      minOrderQuote: 250_000,
      spotActive: true,
      marginActive: true,
      maxLeverage: 3,
      hourlyRolloverFeePct: 0.009,
    },
  ];
}

export function generateRealisticCandles(
  market: Bit24MarketInfo,
  count = 140
): OhlcvCandle[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const stepSec = 3600;
  const targetLastPrice = market.eachPrice;
  const volFactor =
    market.category === 'GOLD'
      ? 0.0042
      : market.category === 'MEME'
        ? 0.0135
        : 0.0085;

  const seed = market.marketName
    .split('')
    .reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 3), 0);

  const rawPath: number[] = [];
  const phaseOffset = (seed % 17) * 0.35;

  for (let i = 0; i < count; i++) {
    let val = 100;

    if (market.category === 'MEME') {
      if (market.change24hPct > 12) {
        // Overextended late pump trajectory (NOT/IRT: sharp parabolic spike at the end -> RSI > 75)
        const base = 100 + Math.sin(i * 0.35 + phaseOffset) * 2.2;
        const spike = i > count - 10 ? (i - (count - 10)) * 2.1 : 0;
        val = base + spike;
      } else if (market.baseSymbol === 'PEPE' || market.baseSymbol === 'BONK') {
        // Multi-wave meme cycle troughing 3 bars ago & bouncing right off support!
        const wave1 = Math.sin(((i - (count - 8.5)) / 18) * Math.PI * 2) * 3.6;
        val = 100 + i * 0.022 + wave1;
      } else if (market.baseSymbol === 'DOGE' || market.baseSymbol === 'WIF') {
        // Healthy consolidation then fresh early pump breakout (RSI ~58-65, volume surge!)
        const wave1 = Math.sin(((i - (count - 6)) / 20) * Math.PI * 2) * 1.9;
        const ignition = i >= count - 2 ? (i - (count - 3)) * 0.65 : 0;
        val = 100 + i * 0.025 + wave1 + ignition;
      } else {
        // Quiet ranging watch (SHIB / FLOKI)
        val = 100 + Math.sin(i * 0.42 + phaseOffset) * 1.6 + Math.cos(i * 0.9) * 0.5;
      }
    } else if (market.category === 'GOLD') {
      // Smooth institutional gold waves (~1.1% amplitude) with gentle uptrend
      const wave = Math.sin(((i - (count - 18)) / 22) * Math.PI * 2) * 1.15;
      const bounce = i >= count - 3 ? (i - (count - 4)) * 0.36 : 0;
      val = 100 + i * 0.025 + wave + bounce;
    } else {
      // Major Spot Crypto (BTC, ETH, SOL, XRP bullish waves; TON mild chop)
      if (market.change24hPct < 0) {
        val = 100 - i * 0.02 + Math.sin(i * 0.4 + phaseOffset) * 1.8;
      } else {
        const wave = Math.sin(((i - (count - 20)) / 20) * Math.PI * 2) * 2.1;
        const thrust = i >= count - 3 ? (i - (count - 4)) * 0.68 : 0;
        val = 100 + i * 0.038 + wave + thrust;
      }
    }

    rawPath.push(Math.max(20, val));
  }

  const scale = targetLastPrice / rawPath[rawPath.length - 1];
  const candles: OhlcvCandle[] = [];

  for (let i = 0; i < count; i++) {
    const closeRaw = rawPath[i] * scale;
    const openRaw = i === 0 ? closeRaw * 0.998 : rawPath[i - 1] * scale;
    const wickAmp = closeRaw * volFactor * (0.55 + ((i * 7 + seed) % 10) / 18);
    const highRaw = Math.max(openRaw, closeRaw) + wickAmp * 0.65;
    const lowRaw = Math.min(openRaw, closeRaw) - wickAmp * 0.6;

    const baseVol = Math.max(1, market.volume24hBase / 24);
    const isHistoricalBounce =
      i >= 3 && closeRaw > openRaw && rawPath[i - 1] >= rawPath[i - 2] && rawPath[i - 2] < rawPath[i - 3];
    const pumpVolSpike =
      market.category === 'MEME' && (i >= count - 3 || isHistoricalBounce) && closeRaw >= openRaw
        ? 1.92
        : (i >= count - 3 || isHistoricalBounce) && closeRaw > openRaw
          ? 1.48
          : 0.85 + ((i + seed) % 7) * 0.08;

    candles.push({
      t: nowSec - (count - 1 - i) * stepSec,
      o: smartRoundMarketPrice(openRaw, market.quoteSymbol),
      h: smartRoundMarketPrice(highRaw, market.quoteSymbol),
      l: smartRoundMarketPrice(lowRaw, market.quoteSymbol),
      c: smartRoundMarketPrice(closeRaw, market.quoteSymbol),
      v: Number((baseVol * pumpVolSpike).toFixed(4)),
    });
  }

  return candles;
}

export function generateRealisticOrderBook(
  market: Bit24MarketInfo,
  targetOrderQuoteSize: number
): OrderBookSnapshot {
  const mid = market.eachPrice;
  const halfSpreadFraction =
    market.baseSymbol === 'BTC' || market.baseSymbol === 'PAXG'
      ? 0.00085
      : market.baseSymbol === 'XAUT' || market.baseSymbol === 'ETH'
        ? 0.00105
        : market.category === 'MEME'
          ? 0.00165 // ~0.33% full spread on active Bit24 meme coins
          : 0.00145;

  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (let lvl = 0; lvl < 8; lvl++) {
    const step = halfSpreadFraction + lvl * 0.00055;
    const bidPrice = smartRoundMarketPrice(mid * (1 - step), market.quoteSymbol);
    const askPrice = smartRoundMarketPrice(mid * (1 + step), market.quoteSymbol);

    const levelQuoteDepth =
      market.quoteSymbol === 'IRT'
        ? 38_000_000 * (1 + lvl * 0.45)
        : 480 * (1 + lvl * 0.45);

    const bidAmt = Number((levelQuoteDepth / Math.max(1e-8, bidPrice)).toFixed(4));
    const askAmt = Number((levelQuoteDepth / Math.max(1e-8, askPrice)).toFixed(4));

    bids.push({
      price: bidPrice,
      amount: bidAmt,
      total: Math.round(bidAmt * bidPrice * 100) / 100,
    });
    asks.push({
      price: askPrice,
      amount: askAmt,
      total: Math.round(askAmt * askPrice * 100) / 100,
    });
  }

  return buildOrderBookSnapshot(market.marketName, bids, asks, targetOrderQuoteSize);
}
