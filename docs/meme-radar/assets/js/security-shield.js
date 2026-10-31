/**
 * MEME HUNTER RADAR PRO — 6-Layer Anti-Fake, Anti-Honeypot & Anti-Rug Security Shield
 * Blocks counterfeit clones, honeypots, high sell-tax traps, mint/freeze risks & fake liquidity.
 */
(function () {
  'use strict';

  // Canonical official meme-coin contracts to catch counterfeit copycat tickers
  const OFFICIAL_MEME_CONTRACTS = {
    PEPE: ['0x6982508145454ce325ddbe47a25d4ec3d2311933'],
    SHIB: ['0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce'],
    BONK: ['dezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'.toLowerCase()],
    WIF: ['EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'.toLowerCase()],
    POPCAT: ['7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'.toLowerCase()],
    BRETT: ['0x532f27101965dd16442e59d40670faf5ebb142e4'],
    FLOKI: [
      '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e',
      '0xfb5b838b6cfeceddbc2873a367c6072579373d67'
    ],
    MEW: ['MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5'.toLowerCase()],
    BOME: ['ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82'.toLowerCase()],
    PNUT: ['2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'.toLowerCase()],
    TURBO: ['0xa35923162c49cf95e6bf26623385eb431ad920d3'],
    MOG: ['0xaaee1a9723aadb7afa2810263653a34ba2c21c7a'],
    DOGE: ['0xba2ae424d960c26247dd6c32edc70b295c744c43']
  };

  const CHAIN_GOPLUS_ID = {
    ethereum: '1',
    bsc: '56',
    base: '8453',
    arbitrum: '42161',
    solana: 'solana'
  };

  // Cache on-chain contract audit results for 5 minutes
  const deepAuditCache = new Map();

  function evaluateHeuristicShield(pair, minLiquidityUsd) {
    const minLiq = typeof minLiquidityUsd === 'number' ? minLiquidityUsd : 15000;
    const reasons = [];
    const passedChecks = [];
    let score = 100;
    let hardBlocked = false;

    const symbol = ((pair.baseToken && pair.baseToken.symbol) || '').trim().toUpperCase();
    const name = ((pair.baseToken && pair.baseToken.name) || '').trim();
    const addr = ((pair.baseToken && pair.baseToken.address) || '').trim().toLowerCase();
    const liqUsd = Number((pair.liquidity && pair.liquidity.usd) || 0);
    const fdv = Number(pair.fdv || pair.marketCap || 0);
    const vol24 = Number((pair.volume && pair.volume.h24) || 0);
    const vol1h = Number((pair.volume && pair.volume.h1) || 0);
    const vol5m = Number((pair.volume && pair.volume.m5) || 0);

    const buys5m = Number((pair.txns && pair.txns.m5 && pair.txns.m5.buys) || 0);
    const sells5m = Number((pair.txns && pair.txns.m5 && pair.txns.m5.sells) || 0);
    const buys1h = Number((pair.txns && pair.txns.h1 && pair.txns.h1.buys) || 0);
    const sells1h = Number((pair.txns && pair.txns.h1 && pair.txns.h1.sells) || 0);
    const buys24h = Number((pair.txns && pair.txns.h24 && pair.txns.h24.buys) || 0);
    const sells24h = Number((pair.txns && pair.txns.h24 && pair.txns.h24.sells) || 0);

    const chg5m = Number((pair.priceChange && pair.priceChange.m5) || 0);
    const chg1h = Number((pair.priceChange && pair.priceChange.h1) || 0);
    const createdAt = Number(pair.pairCreatedAt || 0);
    const ageHours = createdAt > 0 ? Math.max(0.1, (Date.now() - createdAt) / 3600000) : 72;

    // Gate 1: Counterfeit / Copycat Impersonator Check
    if (OFFICIAL_MEME_CONTRACTS[symbol]) {
      const allowedList = OFFICIAL_MEME_CONTRACTS[symbol];
      if (!allowedList.includes(addr) && liqUsd < 450000) {
        hardBlocked = true;
        score -= 75;
        reasons.push('توکن تقلبی کپی‌شده با نماد مشابه ' + symbol + ' (قرارداد غیراصلی)');
      } else {
        passedChecks.push('اصالت قرارداد رسمی تأیید شد');
      }
    }

    // Suspicious scam keywords in token name
    if (/honeypot|test\s*token|rug|airdrop\s*claim|free\s*claim/i.test(name)) {
      hardBlocked = true;
      score -= 80;
      reasons.push('نام قرارداد حاوی الگوی فیشینگ / تست مشکوک است');
    }

    // Gate 2: Real Pool Liquidity Floor
    if (liqUsd < minLiq) {
      hardBlocked = true;
      score -= 55;
      reasons.push('نقدینگی استخر ناکافی ($' + Math.round(liqUsd).toLocaleString() + ') — خطر راگ‌پول');
    } else if (liqUsd >= 80000) {
      passedChecks.push('نقدینگی عمیق و امن ($' + Math.round(liqUsd / 1000) + 'K)');
    } else {
      score -= 8;
      passedChecks.push('حداقل نقدینگی استخر تأیید شد');
    }

    // Gate 3: Zero-Seller Honeypot Pattern
    const total1h = buys1h + sells1h;
    const total24h = buys24h + sells24h;
    if ((buys1h >= 20 && sells1h === 0) || (total1h >= 35 && sells1h / total1h < 0.04 && vol1h > 3000)) {
      hardBlocked = true;
      score -= 80;
      reasons.push('تله هانی‌پات شناسایی شد (فروش قفل است — تقریباً بدون تراکنش فروش!)');
    } else if (total24h >= 40 && sells24h / total24h >= 0.25) {
      passedChecks.push('امکان فروش دوطرفه در استخر فعال است');
    }

    // Gate 4: Fake Market-Cap / Thin Liquidity Manipulation (applies to low/mid liquidity pools < $250k)
    if (liqUsd < 250000 && fdv > 400000 && liqUsd > 0 && liqUsd / fdv < 0.016) {
      hardBlocked = true;
      score -= 50;
      reasons.push('حباب جعلی ارزش بازار نسبت به نقدینگی واقعی (' + ((liqUsd / fdv) * 100).toFixed(2) + '%)');
    } else if (liqUsd >= 250000 || (fdv > 0 && liqUsd / fdv >= 0.03)) {
      passedChecks.push('تناسب سالم نقدینگی به ارزش بازار');
    }

    // Gate 5: Active Dev Dump / Rug Crash
    if (chg1h <= -52 || (chg5m <= -26 && sells5m > buys5m * 2.5)) {
      hardBlocked = true;
      score -= 60;
      reasons.push('ریزش ناگهانی نهنگ / تخلیه مشکوک استخر (' + chg1h.toFixed(1) + '% در ۱ ساعت)');
    }

    // Gate 6: Wash-Trading / Bot Spoofed Volume + Ultra-New Unproven Pool
    if (vol24 > liqUsd * 30 && total24h < 25) {
      hardBlocked = true;
      score -= 55;
      reasons.push('حجم معاملات ساختگی رباتی با تعداد معامله‌گر بسیار کم');
    }
    if (ageHours < 0.5 && liqUsd < 35000) {
      hardBlocked = true;
      score -= 40;
      reasons.push('توکن زیر ۳۰ دقیقه بدون تثبیت امنیت اولیه');
    } else if (ageHours >= 6) {
      passedChecks.push('سابقه معاملاتی و پایداری استخر تأیید شد');
    }

    // Cached deep smart-contract audit overlay (if already fetched)
    const cacheKey = (pair.chainId || '') + ':' + addr;
    const cachedDeep = deepAuditCache.get(cacheKey);
    if (cachedDeep && Date.now() - cachedDeep.ts < 300000) {
      if (cachedDeep.blocked) {
        hardBlocked = true;
        score = Math.min(score, 18);
        cachedDeep.reasons.forEach((r) => {
          if (!reasons.includes(r)) reasons.unshift(r);
        });
      } else {
        score = Math.min(100, score + cachedDeep.bonus);
        cachedDeep.badges.forEach((b) => {
          if (!passedChecks.includes(b)) passedChecks.unshift(b);
        });
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    if (score < 62) hardBlocked = true;

    return {
      safe: !hardBlocked && score >= 65,
      hardBlocked: hardBlocked,
      score: score,
      grade: score >= 85 ? 'A+' : score >= 74 ? 'A' : score >= 65 ? 'B' : 'D (خطرناک)',
      reasons: reasons,
      passedChecks: passedChecks,
      deepVerified: Boolean(cachedDeep),
      sellTaxPct: cachedDeep ? cachedDeep.sellTaxPct : 0,
      buyTaxPct: cachedDeep ? cachedDeep.buyTaxPct : 0
    };
  }

  /**
   * Live Smart-Contract Security Audit via RugCheck (Solana) or GoPlus (EVM: BSC/Base/ETH)
   */
  async function runDeepContractAudit(chainId, tokenAddress) {
    if (!chainId || !tokenAddress) return null;
    const normAddr = tokenAddress.trim();
    const cacheKey = chainId + ':' + normAddr.toLowerCase();
    const existing = deepAuditCache.get(cacheKey);
    if (existing && Date.now() - existing.ts < 300000) {
      return existing;
    }

    const result = {
      ts: Date.now(),
      blocked: false,
      bonus: 0,
      sellTaxPct: 0,
      buyTaxPct: 0,
      reasons: [],
      badges: [],
      source: 'heuristic'
    };

    try {
      if (chainId === 'solana') {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4500);
        const res = await fetch(
          'https://api.rugcheck.xyz/v1/tokens/' + encodeURIComponent(normAddr) + '/report/summary',
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          result.source = 'RugCheck.xyz';
          const risks = Array.isArray(data.risks) ? data.risks : [];
          const dangerRisks = risks.filter((r) => r.level === 'danger' || (r.score && r.score >= 500));
          for (const rk of dangerRisks) {
            const nm = String(rk.name || '');
            if (/mint authority/i.test(nm)) {
              result.blocked = true;
              result.reasons.push('قابلیت چاپ نامحدود توکن باز است (Mint Authority فعال)');
            } else if (/freeze authority/i.test(nm)) {
              result.blocked = true;
              result.reasons.push('قابلیت مسدودسازی کیف‌پول خریدار فعال است (Freeze Authority)');
            } else if (/copycat|scam|honeypot|rugged/i.test(nm)) {
              result.blocked = true;
              result.reasons.push('هشدار مستقیم RugCheck: ' + nm);
            }
          }
          if (!result.blocked) {
            result.bonus = 6;
            result.badges.push('تأیید قرارداد هوشمند سولانا توسط RugCheck');
          }
        }
      } else if (CHAIN_GOPLUS_ID[chainId] && CHAIN_GOPLUS_ID[chainId] !== 'solana') {
        const cid = CHAIN_GOPLUS_ID[chainId];
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4500);
        const res = await fetch(
          'https://api.gopluslabs.io/api/v1/token_security/' + cid + '?contract_addresses=' + encodeURIComponent(normAddr.toLowerCase()),
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          const info = json && json.result && json.result[normAddr.toLowerCase()];
          if (info) {
            result.source = 'GoPlus Security';
            const isHoneypot = info.is_honeypot === '1';
            const cannotSellAll = info.cannot_sell_all === '1';
            const isMintable = info.is_mintable === '1';
            const sellTax = parseFloat(info.sell_tax || '0') * 100;
            const buyTax = parseFloat(info.buy_tax || '0') * 100;
            result.sellTaxPct = isFinite(sellTax) ? Number(sellTax.toFixed(1)) : 0;
            result.buyTaxPct = isFinite(buyTax) ? Number(buyTax.toFixed(1)) : 0;

            if (isHoneypot || cannotSellAll) {
              result.blocked = true;
              result.reasons.push('تأیید هانی‌پات توسط GoPlus — فروش توکن مسدود است!');
            }
            if (result.sellTaxPct > 6 || result.buyTaxPct > 6) {
              result.blocked = true;
              result.reasons.push('مالیات مخفی سنگین قرارداد (خرید ' + result.buyTaxPct + '% / فروش ' + result.sellTaxPct + '%)');
            }
            if (isMintable && info.owner_address && info.owner_address !== '0x0000000000000000000000000000000000000000') {
              result.blocked = true;
              result.reasons.push('مالک قرارداد امکان ضرب توکن جدید دارد (Mintable)');
            }
            if (!result.blocked) {
              result.bonus = 7;
              result.badges.push('تست هانی‌پات GoPlus امن (مالیات فروش ' + result.sellTaxPct + '%)');
            }
          }
        }
      }
    } catch (_) {
      // Network timeout or offline fallback: heuristic layers still strictly enforce safety
    }

    deepAuditCache.set(cacheKey, result);
    return result;
  }

  window.MemeSecurityShield = {
    evaluateHeuristicShield: evaluateHeuristicShield,
    runDeepContractAudit: runDeepContractAudit,
    OFFICIAL_MEME_CONTRACTS: OFFICIAL_MEME_CONTRACTS
  };
})();
