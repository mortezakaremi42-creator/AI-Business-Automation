/**
 * MEME HUNTER RADAR PRO — Real-Time DEX Meme Coin Scanner, Bottom Detector & Smart Pump-Exit Engine
 * Exclusively tracks Meme Coins across Solana, Base, BSC & Ethereum.
 */
(function () {
  'use strict';

  // Core liquid + active meme coins seeded alongside dynamic DexScreener trending/boost discovery
  const SEED_MEME_TOKENS = [
    // Solana Meme Coins
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
    '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
    'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',  // MEW
    'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',  // BOME
    '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', // PNUT
    // Base / Ethereum / BSC Meme Coins
    '0x532f27101965dd16442e59d40670faf5ebb142e4',   // BRETT (Base)
    '0x6982508145454ce325ddbe47a25d4ec3d2311933',   // PEPE (ETH)
    '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e',   // FLOKI
    '0xa35923162c49cf95e6bf26623385eb431ad920d3',   // TURBO
    '0xaaee1a9723aadb7afa2810263653a34ba2c21c7a',   // MOG
    '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce'    // SHIB
  ];

  const SUPPORTED_CHAINS = ['solana', 'base', 'bsc', 'ethereum'];

  // Offline fallback pairs ONLY used when browser has no outbound internet access (e.g. sandbox preview)
  function buildFallbackPairs() {
    const now = Date.now();
    const wave = Math.sin(now / 14000);
    const wave2 = Math.cos(now / 11000);
    return [
      {
        chainId: 'solana',
        dexId: 'raydium',
        pairAddress: 'sol-popcat-usdc',
        url: 'https://dexscreener.com/solana/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
        baseToken: { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', name: 'Popcat', symbol: 'POPCAT' },
        priceUsd: String((0.412 + wave * 0.008).toFixed(5)),
        liquidity: { usd: 14850000 },
        fdv: 403000000,
        volume: { m5: 192000, h1: 1420000, h24: 38400000 },
        txns: { m5: { buys: 164, sells: 78 }, h1: { buys: 1480, sells: 990 }, h24: { buys: 24100, sells: 21800 } },
        priceChange: { m5: 2.45, h1: -6.8, h6: -14.2, h24: -18.5 },
        pairCreatedAt: now - 86400000 * 180
      },
      {
        chainId: 'solana',
        dexId: 'raydium',
        pairAddress: 'sol-bonk-sol',
        url: 'https://dexscreener.com/solana/dezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        baseToken: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', name: 'Bonk', symbol: 'BONK' },
        priceUsd: String((0.0000184 + wave2 * 0.0000004).toFixed(8)),
        liquidity: { usd: 22400000 },
        fdv: 1380000000,
        volume: { m5: 245000, h1: 1890000, h24: 54000000 },
        txns: { m5: { buys: 218, sells: 109 }, h1: { buys: 2150, sells: 1540 }, h24: { buys: 39200, sells: 35600 } },
        priceChange: { m5: 1.85, h1: -4.2, h6: -11.6, h24: -13.4 },
        pairCreatedAt: now - 86400000 * 320
      },
      {
        chainId: 'base',
        dexId: 'uniswap',
        pairAddress: 'base-brett-weth',
        url: 'https://dexscreener.com/base/0x532f27101965dd16442e59d40670faf5ebb142e4',
        baseToken: { address: '0x532f27101965dd16442e59d40670faf5ebb142e4', name: 'Brett', symbol: 'BRETT' },
        priceUsd: String((0.0845 + wave * 0.0019).toFixed(5)),
        liquidity: { usd: 9650000 },
        fdv: 836000000,
        volume: { m5: 134000, h1: 980000, h24: 22900000 },
        txns: { m5: { buys: 138, sells: 64 }, h1: { buys: 1120, sells: 840 }, h24: { buys: 18400, sells: 16900 } },
        priceChange: { m5: 3.12, h1: -8.4, h6: -16.9, h24: -21.0 },
        pairCreatedAt: now - 86400000 * 210
      },
      {
        chainId: 'solana',
        dexId: 'pumpswap',
        pairAddress: 'sol-pnut-sol',
        url: 'https://dexscreener.com/solana/2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump',
        baseToken: { address: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', name: 'Peanut the Squirrel', symbol: 'PNUT' },
        priceUsd: String((0.219 + wave2 * 0.006).toFixed(5)),
        liquidity: { usd: 11200000 },
        fdv: 219000000,
        volume: { m5: 310000, h1: 1750000, h24: 41200000 },
        txns: { m5: { buys: 290, sells: 112 }, h1: { buys: 2340, sells: 1490 }, h24: { buys: 41200, sells: 36800 } },
        priceChange: { m5: 4.9, h1: 9.6, h6: -7.5, h24: -12.1 },
        pairCreatedAt: now - 86400000 * 95
      },
      {
        chainId: 'solana',
        dexId: 'raydium',
        pairAddress: 'sol-wif-sol',
        url: 'https://dexscreener.com/solana/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        baseToken: { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', name: 'dogwifhat', symbol: 'WIF' },
        priceUsd: String((1.18 + wave * 0.02).toFixed(4)),
        liquidity: { usd: 31500000 },
        fdv: 1180000000,
        volume: { m5: 295000, h1: 2850000, h24: 76000000 },
        txns: { m5: { buys: 190, sells: 162 }, h1: { buys: 1920, sells: 1850 }, h24: { buys: 44100, sells: 43200 } },
        priceChange: { m5: 0.45, h1: -2.9, h6: -9.4, h24: -10.8 },
        pairCreatedAt: now - 86400000 * 300
      },
      {
        chainId: 'ethereum',
        dexId: 'uniswap',
        pairAddress: 'eth-pepe-weth',
        url: 'https://dexscreener.com/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933',
        baseToken: { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', name: 'Pepe', symbol: 'PEPE' },
        priceUsd: String((0.00000942 + wave2 * 0.00000018).toFixed(8)),
        liquidity: { usd: 46800000 },
        fdv: 3960000000,
        volume: { m5: 420000, h1: 3650000, h24: 98000000 },
        txns: { m5: { buys: 145, sells: 92 }, h1: { buys: 1380, sells: 1090 }, h24: { buys: 26800, sells: 24900 } },
        priceChange: { m5: 1.62, h1: -5.1, h6: -11.3, h24: -14.7 },
        pairCreatedAt: now - 86400000 * 420
      },
      {
        chainId: 'solana',
        dexId: 'raydium',
        pairAddress: 'sol-mew-sol',
        url: 'https://dexscreener.com/solana/MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',
        baseToken: { address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', name: 'cat in a dogs world', symbol: 'MEW' },
        priceUsd: String((0.00582 + wave * 0.00014).toFixed(6)),
        liquidity: { usd: 16200000 },
        fdv: 517000000,
        volume: { m5: 118000, h1: 1210000, h24: 29400000 },
        txns: { m5: { buys: 112, sells: 104 }, h1: { buys: 1140, sells: 1190 }, h24: { buys: 21500, sells: 22100 } },
        priceChange: { m5: -0.35, h1: -6.1, h6: -12.0, h24: -15.3 },
        pairCreatedAt: now - 86400000 * 200
      },
      {
        chainId: 'bsc',
        dexId: 'pancakeswap',
        pairAddress: 'bsc-floki-wbnb',
        url: 'https://dexscreener.com/bsc/0xfb5b838b6cfeceddbc2873a367c6072579373d67',
        baseToken: { address: '0xfb5b838b6cfeceddbc2873a367c6072579373d67', name: 'FLOKI', symbol: 'FLOKI' },
        priceUsd: String((0.000138 + wave2 * 0.000003).toFixed(7)),
        liquidity: { usd: 19100000 },
        fdv: 1320000000,
        volume: { m5: 155000, h1: 1190000, h24: 31000000 },
        txns: { m5: { buys: 132, sells: 86 }, h1: { buys: 1260, sells: 980 }, h24: { buys: 23400, sells: 21000 } },
        priceChange: { m5: 1.4, h1: 28.5, h6: 46.0, h24: 62.4 },
        pairCreatedAt: now - 86400000 * 500
      },
      // Authentic Counterfeit / Honeypot Scam Samples to demonstrate the 6-Layer Anti-Fake Blocker!
      {
        chainId: 'bsc',
        dexId: 'pancakeswap',
        pairAddress: 'bsc-fake-pepe2-trap',
        url: '#',
        baseToken: { address: '0x0000deadbeef9999fakepepe0000000000001234', name: 'PEPE 2.0 AI Honeypot', symbol: 'PEPE' },
        priceUsd: '0.00000042',
        liquidity: { usd: 4200 },
        fdv: 19500000,
        volume: { m5: 48000, h1: 112000, h24: 190000 },
        txns: { m5: { buys: 64, sells: 0 }, h1: { buys: 198, sells: 0 }, h24: { buys: 310, sells: 1 } },
        priceChange: { m5: 88.0, h1: 420.0, h6: 910.0, h24: 910.0 },
        pairCreatedAt: now - 3600000 * 3
      },
      {
        chainId: 'solana',
        dexId: 'raydium',
        pairAddress: 'sol-fake-bonk-rug',
        url: '#',
        baseToken: { address: 'FakeBonkMint9999999999999999999999999999pump', name: 'Super Bonk Airdrop Claim', symbol: 'BONK' },
        priceUsd: '0.00019',
        liquidity: { usd: 6800 },
        fdv: 8400000,
        volume: { m5: 19000, h1: 55000, h24: 72000 },
        txns: { m5: { buys: 8, sells: 49 }, h1: { buys: 42, sells: 138 }, h24: { buys: 95, sells: 160 } },
        priceChange: { m5: -38.5, h1: -67.2, h6: -74.0, h24: -74.0 },
        pairCreatedAt: now - 3600000 * 1.5
      }
    ];
  }

  /**
   * Quantitative Market-Bottom & Whale-Momentum Signal Calculator
   */
  function analyzeMemeSignal(pair, shield, strategyMode) {
    const mode = strategyMode || 'SAFE_BOTTOM'; // 'SAFE_BOTTOM' | 'WHALE_PUMP'
    const chg5m = Number((pair.priceChange && pair.priceChange.m5) || 0);
    const chg1h = Number((pair.priceChange && pair.priceChange.h1) || 0);
    const chg6h = Number((pair.priceChange && pair.priceChange.h6) || chg1h * 1.5);
    const chg24h = Number((pair.priceChange && pair.priceChange.h24) || 0);

    const vol5m = Number((pair.volume && pair.volume.m5) || 0);
    const vol1h = Number((pair.volume && pair.volume.h1) || 1);
    const buys5m = Number((pair.txns && pair.txns.m5 && pair.txns.m5.buys) || 0);
    const sells5m = Number((pair.txns && pair.txns.m5 && pair.txns.m5.sells) || 0);
    const buys1h = Number((pair.txns && pair.txns.h1 && pair.txns.h1.buys) || 0);
    const sells1h = Number((pair.txns && pair.txns.h1 && pair.txns.h1.sells) || 0);

    const total5m = buys5m + sells5m;
    const buyRatio5m = total5m > 0 ? buys5m / total5m : 0.5;
    const total1h = buys1h + sells1h;
    const buyRatio1h = total1h > 0 ? buys1h / total1h : 0.5;

    // Volume acceleration: current 5m pace vs 1h average 5m pace
    const avg5mVol = Math.max(100, vol1h / 12);
    const volSurge = vol5m / avg5mVol;

    // Estimate Discount-from-24h-High ("موقعیت نسبت به کف")
    const deepestDip = Math.min(chg24h, chg6h, chg1h);

    if (!shield.safe) {
      return {
        signalType: 'BLOCKED_SCAM',
        signalLabel: 'مسدود (تقلبی / پرخطر)',
        actionableBuy: false,
        signalScore: 0,
        bottomScore: 0,
        buyPressurePct: Math.round(buyRatio5m * 100),
        volSurge: Number(volSurge.toFixed(2)),
        reasonFa: shield.reasons[0] || 'رد شده توسط سپر امنیتی ضدتقلبی'
      };
    }

    // Overbought Top Guard: Never buy FOMO tops when already pumped > +38% in 1h/24h in Safe Bottom Mode!
    if (mode === 'SAFE_BOTTOM' && (chg1h > 22 || chg24h > 45)) {
      return {
        signalType: 'OVERBOUGHT_WAIT',
        signalLabel: 'سقف قیمتی (ورود ممنوع — صبر برای اصلاح)',
        actionableBuy: false,
        signalScore: 42,
        bottomScore: 24,
        buyPressurePct: Math.round(buyRatio5m * 100),
        volSurge: Number(volSurge.toFixed(2)),
        reasonFa: 'رشد شدید اخیر (+' + Math.round(Math.max(chg1h, chg24h)) + '%)؛ ربات در اوج نمی‌خرد و منتظر کف بعدی می‌ماند'
      };
    }

    // Bottom Accumulation Score (0-100)
    let bottomScore = 40;
    // 1. Healthy pullback from peak (-38% to -4%) = prime discount zone
    if (deepestDip <= -5 && deepestDip >= -38) {
      bottomScore += 24;
    } else if (deepestDip > -5 && deepestDip <= 8) {
      bottomScore += 14; // Tight floor consolidation
    }

    // 2. Micro-reversal bounce in 5m (chg5m turning positive out of dip!)
    if (chg5m >= 0.6 && chg5m <= 11) {
      bottomScore += 18;
    } else if (chg5m > 0 && chg5m < 0.6) {
      bottomScore += 9;
    } else if (chg5m < -3) {
      bottomScore -= 16; // Still falling knife — wait for turn!
    }

    // 3. Buyer absorption dominance in 5m
    if (buyRatio5m >= 0.63) {
      bottomScore += 16;
    } else if (buyRatio5m >= 0.56) {
      bottomScore += 10;
    } else if (buyRatio5m < 0.45) {
      bottomScore -= 15;
    }

    // 4. Smart-money volume inflow acceleration
    if (volSurge >= 1.45) {
      bottomScore += 12;
    } else if (volSurge >= 1.1) {
      bottomScore += 6;
    }

    // 5. Security confidence bonus
    if (shield.score >= 85) bottomScore += 6;

    bottomScore = Math.max(5, Math.min(99, Math.round(bottomScore)));

    // Momentum Pump Score (for WHALE_PUMP mode)
    let pumpScore = 38;
    if (chg5m >= 1.8 && chg5m <= 24) pumpScore += 22;
    if (buyRatio5m >= 0.64) pumpScore += 20;
    if (volSurge >= 1.5) pumpScore += 16;
    if (buyRatio1h >= 0.56) pumpScore += 8;
    pumpScore = Math.max(5, Math.min(99, Math.round(pumpScore)));

    const activeScore = mode === 'WHALE_PUMP' ? Math.max(bottomScore, pumpScore) : bottomScore;

    if (mode === 'SAFE_BOTTOM' && bottomScore >= 76 && chg5m > 0 && buyRatio5m >= 0.56) {
      return {
        signalType: 'BOTTOM_BUY',
        signalLabel: '🎯 شکار قطعی کف بازار (ورود کم‌ریسک)',
        actionableBuy: true,
        signalScore: bottomScore,
        bottomScore: bottomScore,
        buyPressurePct: Math.round(buyRatio5m * 100),
        volSurge: Number(volSurge.toFixed(2)),
        reasonFa:
          'اصلاح به کف حمایتی (' +
          deepestDip.toFixed(1) +
          '%) + چرخش مثبت ۵ دقیقه (+' +
          chg5m.toFixed(2) +
          '%) با ' +
          Math.round(buyRatio5m * 100) +
          '% قدرت خریدار'
      };
    }

    if (mode === 'WHALE_PUMP' && activeScore >= 75 && chg5m >= 1.0 && buyRatio5m >= 0.58) {
      return {
        signalType: 'MOMENTUM_BUY',
        signalLabel: '⚡ شکار موج ورود نهنگ (پامپ تاییدشده)',
        actionableBuy: true,
        signalScore: activeScore,
        bottomScore: bottomScore,
        buyPressurePct: Math.round(buyRatio5m * 100),
        volSurge: Number(volSurge.toFixed(2)),
        reasonFa:
          'جهش حجم ' +
          volSurge.toFixed(1) +
          ' برابری + غلبه خریداران (' +
          Math.round(buyRatio5m * 100) +
          '%) در ابتدای موج صعودی'
      };
    }

    return {
      signalType: 'WATCHING_BOTTOM',
      signalLabel: 'در رصد رادار (انتظار تأیید چرخش کف)',
      actionableBuy: false,
      signalScore: activeScore,
      bottomScore: bottomScore,
      buyPressurePct: Math.round(buyRatio5m * 100),
      volSurge: Number(volSurge.toFixed(2)),
      reasonFa:
        chg5m <= 0
          ? 'در محدوده اصلاحی است؛ ربات منتظر کندل چرخش خریدار در ۵ دقیقه می‌ماند'
          : 'فشار خرید ' + Math.round(buyRatio5m * 100) + '% — در یک‌قدمی حد نصاب شکار کف'
    };
  }

  /**
   * Fetch real live meme coin pairs from DexScreener CORS API
   */
  async function fetchLiveDexPairs() {
    const collected = new Map();

    function ingestPairs(pairs) {
      if (!Array.isArray(pairs)) return;
      for (const p of pairs) {
        if (!p || !p.baseToken || !p.baseToken.address || !p.priceUsd) continue;
        if (!SUPPORTED_CHAINS.includes(p.chainId)) continue;
        const key = p.chainId + ':' + p.baseToken.address.toLowerCase();
        const existing = collected.get(key);
        const curLiq = Number((p.liquidity && p.liquidity.usd) || 0);
        const prevLiq = existing ? Number((existing.liquidity && existing.liquidity.usd) || 0) : -1;
        if (curLiq > prevLiq) {
          collected.set(key, p);
        }
      }
    }

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 7000);

      // 1. Seeded high-liquidity meme coins batch query
      const batchUrl = 'https://api.dexscreener.com/latest/dex/tokens/' + SEED_MEME_TOKENS.join(',');
      // 2. Dynamic trending meme / pump search for newly active pairs + scam filtering demo
      const searchUrl = 'https://api.dexscreener.com/latest/dex/search?q=pepe%20solana';
      const boostUrl = 'https://api.dexscreener.com/latest/dex/search?q=bonk%20doge';

      const responses = await Promise.allSettled([
        fetch(batchUrl, { signal: ctrl.signal }),
        fetch(searchUrl, { signal: ctrl.signal }),
        fetch(boostUrl, { signal: ctrl.signal })
      ]);
      clearTimeout(timeout);

      let anyOk = false;
      for (const r of responses) {
        if (r.status === 'fulfilled' && r.value && r.value.ok) {
          const json = await r.value.json();
          if (json && Array.isArray(json.pairs) && json.pairs.length > 0) {
            anyOk = true;
            ingestPairs(json.pairs.slice(0, 35));
          }
        }
      }

      if (anyOk && collected.size >= 4) {
        return {
          source: 'LIVE_DEX',
          pairs: Array.from(collected.values())
        };
      }
    } catch (_) {
      // Fall through to offline resilience dataset if network blocked
    }

    return {
      source: 'OFFLINE_SIM',
      pairs: buildFallbackPairs()
    };
  }

  window.MemeRadarEngine = {
    fetchLiveDexPairs: fetchLiveDexPairs,
    analyzeMemeSignal: analyzeMemeSignal,
    SUPPORTED_CHAINS: SUPPORTED_CHAINS
  };
})();
