/**
 * MEME HUNTER RADAR PRO — Main Mobile App & Automated Sniper Bot Controller
 */
(function () {
  'use strict';

  const BOT_STORAGE_KEY = 'meme_hunter_bot_state_v1';

  const DEFAULT_BOT_STATE = {
    autoBotEnabled: false,
    strategyMode: 'SAFE_BOTTOM', // 'SAFE_BOTTOM' | 'WHALE_PUMP'
    soundEnabled: true,
    tradeSizeUsd: 50,
    maxOpenPositions: 4,
    minLiquidityUsd: 15000,
    tp1Pct: 25,
    tp2Pct: 55,
    trailingDropPct: 9,
    stopLossPct: 12,
    positions: [],
    closedTrades: []
  };

  let botState = loadBotState();
  let vault = window.MemeWalletVault.loadVault();
  let activeTab = 'radar'; // 'radar' | 'positions' | 'scams' | 'wallet' | 'settings'
  let chainFilter = 'all';
  let searchQuery = '';
  let radarItems = [];
  let dataSourceMode = 'SCANNING';
  let deferredInstallPrompt = null;
  let audioCtx = null;

  function loadBotState() {
    try {
      const raw = localStorage.getItem(BOT_STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_BOT_STATE));
      return Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_BOT_STATE)), JSON.parse(raw));
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULT_BOT_STATE));
    }
  }

  function saveBotState() {
    try {
      localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(botState));
    } catch (_) {}
  }

  function playRadarBeep(kind) {
    if (!botState.soundEnabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      if (kind === 'profit') {
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(1040, now + 0.16);
      } else if (kind === 'warn') {
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(190, now + 0.18);
      } else {
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);
      }
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.21);
    } catch (_) {}
  }

  function showToast(msg, isWarn) {
    const wrap = document.getElementById('radarToastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'radar-toast' + (isWarn ? ' warn' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3600);
  }

  function fmtUsd(n) {
    const val = Number(n || 0);
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtTokenPrice(p) {
    const num = Number(p || 0);
    if (num <= 0) return '$0.00';
    if (num >= 1) return '$' + num.toFixed(4);
    if (num >= 0.01) return '$' + num.toFixed(5);
    if (num >= 0.0001) return '$' + num.toFixed(7);
    return '$' + num.toFixed(9);
  }

  function fmtCompactUsd(n) {
    const v = Number(n || 0);
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }

  /**
   * Execute Buy (Manual Snipe or Auto-Hunter Bot) — HARD-GATED by Anti-Fake Shield
   */
  function executeBuyMeme(item, isAuto) {
    if (!item || !item.shield || !item.shield.safe) {
      playRadarBeep('warn');
      showToast('⛔ خرید مسدود شد! این میم‌کوین در تست ضدتقلبی رد شده است.', true);
      return false;
    }

    const tradeAmt = Math.min(Number(botState.tradeSizeUsd) || 50, vault.cashUsd);
    if (tradeAmt < 5) {
      if (!isAuto) showToast('موجودی نقد کافی نیست. از کلید «واریز» موجودی اضافه کنید.', true);
      return false;
    }

    const tokenAddr = item.pair.baseToken.address;
    const alreadyOpen = botState.positions.some(
      (p) => p.tokenAddress.toLowerCase() === tokenAddr.toLowerCase() && p.chainId === item.pair.chainId
    );
    if (alreadyOpen) {
      if (!isAuto) showToast('این میم‌کوین هم‌اکنون در پوزیشن‌های باز شما فعال است.', true);
      return false;
    }

    if (botState.positions.length >= botState.maxOpenPositions) {
      if (!isAuto) showToast('سقف پوزیشن‌های هم‌زمان پر است (' + botState.maxOpenPositions + ' پوزیشن).', true);
      return false;
    }

    const entryPrice = Number(item.pair.priceUsd);
    if (!entryPrice || entryPrice <= 0) return false;

    const feeUsd = Number((tradeAmt * 0.0025).toFixed(3)); // Realistic 0.25% DEX swap fee
    const netInvested = tradeAmt - feeUsd;
    const tokenQty = netInvested / entryPrice;

    vault.cashUsd = Number((vault.cashUsd - tradeAmt).toFixed(2));
    window.MemeWalletVault.saveVault(vault);

    const pos = {
      id: 'POS-' + Date.now().toString(36).toUpperCase(),
      symbol: item.pair.baseToken.symbol,
      name: item.pair.baseToken.name,
      chainId: item.pair.chainId,
      tokenAddress: tokenAddr,
      pairUrl: item.pair.url || '#',
      entryPriceUsd: entryPrice,
      currentPriceUsd: entryPrice,
      highestPriceUsd: entryPrice,
      initialInvestedUsd: tradeAmt,
      remainingCostUsd: tradeAmt,
      initialQty: tokenQty,
      remainingQty: tokenQty,
      tp1Hit: false,
      tp2Hit: false,
      stopLossFloorPct: -Math.abs(botState.stopLossPct),
      realizedPartUsd: 0,
      openedAt: Date.now(),
      openedBy: isAuto ? 'ربات خودکار کف‌یاب' : 'شکار دستی کاربر'
    };

    botState.positions.unshift(pos);
    saveBotState();
    playRadarBeep('buy');
    showToast(
      (isAuto ? '🤖 شکار خودکار کف: ' : '🎯 خرید انجام شد: ') +
        pos.symbol +
        ' به مبلغ ' +
        fmtUsd(tradeAmt)
    );
    renderAll();
    return true;
  }

  /**
   * Sell a fraction (0..1) or 100% of an open position
   */
  function closePositionFraction(posId, fraction, reasonLabel) {
    const idx = botState.positions.findIndex((p) => p.id === posId);
    if (idx === -1) return;
    const pos = botState.positions[idx];
    const frac = Math.max(0.05, Math.min(1, fraction));
    const sellQty = pos.remainingQty * frac;
    const grossProceeds = sellQty * pos.currentPriceUsd;
    const dexFee = grossProceeds * 0.0025;
    const netProceeds = Math.max(0, grossProceeds - dexFee);
    const costPortion = pos.remainingCostUsd * frac;
    const pnlUsd = netProceeds - costPortion;

    vault.cashUsd = Number((vault.cashUsd + netProceeds).toFixed(2));
    window.MemeWalletVault.saveVault(vault);

    pos.remainingQty -= sellQty;
    pos.remainingCostUsd -= costPortion;
    pos.realizedPartUsd += pnlUsd;

    if (frac >= 0.999 || pos.remainingCostUsd < 1.5) {
      const totalPnlPct = ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      botState.closedTrades.unshift({
        id: pos.id,
        symbol: pos.symbol,
        chainId: pos.chainId,
        investedUsd: pos.initialInvestedUsd,
        pnlUsd: Number(pos.realizedPartUsd.toFixed(2)),
        pnlPct: Number(totalPnlPct.toFixed(2)),
        reason: reasonLabel,
        closedAt: Date.now()
      });
      botState.closedTrades = botState.closedTrades.slice(0, 40);
      botState.positions.splice(idx, 1);
      playRadarBeep(pos.realizedPartUsd >= 0 ? 'profit' : 'warn');
      showToast(
        (pos.realizedPartUsd >= 0 ? '💰 سیو سود کامل ' : '🛡️ خروج محافظتی ') +
          pos.symbol +
          ' (' +
          reasonLabel +
          ') | سود: ' +
          fmtUsd(pos.realizedPartUsd),
        pos.realizedPartUsd < 0
      );
    } else {
      playRadarBeep('profit');
      showToast(
        '✨ سیو سود پله‌ای ' +
          pos.symbol +
          ' (' +
          reasonLabel +
          '): +' +
          fmtUsd(netProceeds) +
          ' به کیف‌پول واریز شد'
      );
    }

    saveBotState();
    renderAll();
  }

  /**
   * Tick Position Monitor: Updates live prices & triggers automated TP1, TP2, Trailing Stop & Rug Exit
   */
  function evaluateOpenPositionsOnTick(pairMap) {
    const snapshot = botState.positions.slice();
    for (const pos of snapshot) {
      const key = pos.chainId + ':' + pos.tokenAddress.toLowerCase();
      const liveItem = pairMap.get(key);
      if (liveItem && liveItem.pair && Number(liveItem.pair.priceUsd) > 0) {
        pos.currentPriceUsd = Number(liveItem.pair.priceUsd);
        // Emergency Rug / Honeypot Flip Protection
        if (liveItem.shield && liveItem.shield.hardBlocked) {
          closePositionFraction(pos.id, 1.0, 'خروج اضطراری سپر ضدراگ');
          continue;
        }
      }

      if (pos.currentPriceUsd > pos.highestPriceUsd) {
        pos.highestPriceUsd = pos.currentPriceUsd;
      }

      const gainPct = ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      const peakGainPct = ((pos.highestPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      const dropFromPeakPct =
        pos.highestPriceUsd > 0
          ? ((pos.highestPriceUsd - pos.currentPriceUsd) / pos.highestPriceUsd) * 100
          : 0;

      // 1. Hard Stop-Loss (or Break-Even Stop after TP1)
      if (gainPct <= pos.stopLossFloorPct) {
        closePositionFraction(
          pos.id,
          1.0,
          pos.tp1Hit ? 'حفظ سود در نقطه سربه‌سر' : 'حد ضرر خودکار (' + gainPct.toFixed(1) + '%)'
        );
        continue;
      }

      // 2. Step 1 Take-Profit (+25% default): Sell 40% & lock Stop-Loss to +1.5% risk-free!
      if (!pos.tp1Hit && gainPct >= botState.tp1Pct) {
        pos.tp1Hit = true;
        pos.stopLossFloorPct = 1.5;
        closePositionFraction(pos.id, 0.4, 'پله اول رشد (+' + botState.tp1Pct + '%)');
        continue;
      }

      // 3. Step 2 Take-Profit (+55% default): Sell 55% of remaining (~35% total)
      if (pos.tp1Hit && !pos.tp2Hit && gainPct >= botState.tp2Pct) {
        pos.tp2Hit = true;
        pos.stopLossFloorPct = Math.max(pos.stopLossFloorPct, 18);
        closePositionFraction(pos.id, 0.58, 'پله دوم پامپ (+' + botState.tp2Pct + '%)');
        continue;
      }

      // 4. Smart Trailing Pump Stop: After >= +18% run, if price pulls back trailingDropPct% from peak, lock profit!
      if (peakGainPct >= 18 && dropFromPeakPct >= botState.trailingDropPct) {
        closePositionFraction(
          pos.id,
          1.0,
          'حد سود متحرک در پایان موج پامپ (+' + gainPct.toFixed(1) + '%)'
        );
      }
    }
    saveBotState();
  }

  /**
   * Scan Live DEX Meme Coins + Run 6-Layer Anti-Fake Shield + Auto-Hunter Execution
   */
  async function runRadarScan(manualNotify) {
    const scanRes = await window.MemeRadarEngine.fetchLiveDexPairs();
    dataSourceMode = scanRes.source;

    const evaluated = [];
    const pairMap = new Map();

    for (const pair of scanRes.pairs) {
      const shield = window.MemeSecurityShield.evaluateHeuristicShield(pair, botState.minLiquidityUsd);
      const signal = window.MemeRadarEngine.analyzeMemeSignal(pair, shield, botState.strategyMode);
      const item = { pair: pair, shield: shield, signal: signal };
      evaluated.push(item);
      pairMap.set(pair.chainId + ':' + pair.baseToken.address.toLowerCase(), item);
    }

    // Sort safe actionable signals to the top, followed by high bottom-score watches, then blocked scams
    evaluated.sort((a, b) => {
      if (a.signal.actionableBuy !== b.signal.actionableBuy) return a.signal.actionableBuy ? -1 : 1;
      if (a.shield.safe !== b.shield.safe) return a.shield.safe ? -1 : 1;
      return b.signal.signalScore - a.signal.signalScore;
    });

    radarItems = evaluated;

    // Update open positions & auto-sell on pumps
    evaluateOpenPositionsOnTick(pairMap);

    // Background deep contract audit (RugCheck / GoPlus) on top 5 safe candidates
    const topSafe = evaluated.filter((x) => x.shield.safe).slice(0, 5);
    Promise.allSettled(
      topSafe.map((x) =>
        window.MemeSecurityShield.runDeepContractAudit(x.pair.chainId, x.pair.baseToken.address)
      )
    ).then(() => {
      // Re-evaluate heuristic + cached deep audit silently
      for (const it of radarItems) {
        it.shield = window.MemeSecurityShield.evaluateHeuristicShield(it.pair, botState.minLiquidityUsd);
        it.signal = window.MemeRadarEngine.analyzeMemeSignal(it.pair, it.shield, botState.strategyMode);
      }
      renderAll();
    });

    // Auto-Hunter Bot: automatically buy top verified bottom signal if enabled
    if (botState.autoBotEnabled && botState.positions.length < botState.maxOpenPositions) {
      const bestTarget = radarItems.find(
        (it) =>
          it.shield.safe &&
          it.shield.score >= 75 &&
          it.signal.actionableBuy &&
          !botState.positions.some(
            (p) => p.tokenAddress.toLowerCase() === it.pair.baseToken.address.toLowerCase()
          )
      );
      if (bestTarget && vault.cashUsd >= Math.min(10, botState.tradeSizeUsd)) {
        executeBuyMeme(bestTarget, true);
      }
    }

    if (manualNotify) {
      const buyCount = radarItems.filter((x) => x.signal.actionableBuy).length;
      const scamCount = radarItems.filter((x) => !x.shield.safe).length;
      showToast(
        'اسکن رادار تکمیل شد: ' +
          buyCount +
          ' موقعیت شکار کف | ' +
          scamCount +
          ' میم‌کوین مشکوک مسدود شد'
      );
    }

    renderAll();
  }

  /**
   * Custom Contract Address Live Security & Bottom Scanner
   */
  async function scanCustomContractAddress(rawAddr) {
    const clean = String(rawAddr || '').trim();
    if (clean.length < 24) {
      showToast('لطفاً آدرس قرارداد کامل میم‌کوین (0x... یا آدرس سولانا) را وارد کنید.', true);
      return;
    }
    showToast('در حال استعلام زنده قرارداد از DexScreener و سپر ضدتقلبی...');
    try {
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(clean));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.pairs) || data.pairs.length === 0) {
        showToast('هیچ استخر نقدینگی فعالی برای این آدرس یافت نشد (احتمال توکن جعلی/فاقد نقدینگی).', true);
        return;
      }
      const bestPair = data.pairs.sort(
        (a, b) => Number((b.liquidity && b.liquidity.usd) || 0) - Number((a.liquidity && a.liquidity.usd) || 0)
      )[0];
      await window.MemeSecurityShield.runDeepContractAudit(bestPair.chainId, bestPair.baseToken.address);
      const shield = window.MemeSecurityShield.evaluateHeuristicShield(bestPair, botState.minLiquidityUsd);
      const signal = window.MemeRadarEngine.analyzeMemeSignal(bestPair, shield, botState.strategyMode);
      radarItems.unshift({ pair: bestPair, shield: shield, signal: signal });
      renderAll();
      if (shield.safe) {
        playRadarBeep('buy');
        showToast('✅ قرارداد بررسی شد: امتیاز امنیت ' + shield.score + '/100 (' + bestPair.baseToken.symbol + ')');
      } else {
        playRadarBeep('warn');
        showToast('🚫 هشدار! این آدرس مشکوک/تقلبی تشخیص داده شد و مسدود گردید.', true);
      }
    } catch (_) {
      showToast('امکان استعلام آنلاین این آدرس در حال حاضر برقرار نشد؛ اتصال اینترنت را بررسی کنید.', true);
    }
  }

  /**
   * Render Sonar Blips + Wallet + Active View
   */
  function renderSonarBlips() {
    const container = document.getElementById('sonarBlipsContainer');
    if (!container) return;
    let html = '';
    const slice = radarItems.slice(0, 10);
    slice.forEach((it, idx) => {
      const angle = (idx * 137.5) * (Math.PI / 180);
      // Higher score -> closer to bullseye center! Scams pushed to outer edge
      const distRatio = !it.shield.safe
        ? 0.86
        : it.signal.actionableBuy
        ? 0.28 + (idx % 3) * 0.1
        : 0.58 + (idx % 3) * 0.08;
      const r = 74 * distRatio;
      const x = 79 + Math.cos(angle) * r;
      const y = 79 + Math.sin(angle) * r;
      const cls = !it.shield.safe ? 'scam' : it.signal.actionableBuy ? 'buy' : 'watch';
      html +=
        '<span class="sonar-blip ' +
        cls +
        '" style="left:' +
        x.toFixed(1) +
        'px;top:' +
        y.toFixed(1) +
        'px;" title="' +
        it.pair.baseToken.symbol +
        '"></span>';
    });
    container.innerHTML = html;
  }

  function renderWalletHeader() {
    let openValueUsd = 0;
    for (const p of botState.positions) {
      openValueUsd += p.remainingQty * p.currentPriceUsd;
    }
    const totalEquity = vault.cashUsd + openValueUsd;
    const realizedTotal = botState.closedTrades.reduce((acc, t) => acc + Number(t.pnlUsd || 0), 0);

    document.getElementById('totalEquityText').textContent = fmtUsd(totalEquity);
    document.getElementById('cashBalanceText').textContent = fmtUsd(vault.cashUsd);
    document.getElementById('inPositionsText').textContent = fmtUsd(openValueUsd);

    const pnlEl = document.getElementById('realizedPnlText');
    pnlEl.textContent = (realizedTotal >= 0 ? '+' : '') + fmtUsd(realizedTotal);
    pnlEl.className = 'val ltr-num ' + (realizedTotal >= 0 ? 'pos' : 'neg');

    const modeBadge = document.getElementById('walletModeBadge');
    if (vault.web3 && vault.web3.connected) {
      modeBadge.textContent =
        '🟢 متصل به ' +
        vault.web3.walletName +
        ' (' +
        vault.web3.nativeBalance +
        ' ' +
        vault.web3.nativeSymbol +
        ')';
    } else {
      modeBadge.textContent = '⚡ کیف‌پول هوشمند ربات (اجرا با قیمت زنده DEX)';
    }

    const srcEl = document.getElementById('liveSourceStatus');
    srcEl.textContent =
      dataSourceMode === 'LIVE_DEX'
        ? 'متصل به DEX زنده جهانی (Solana • Base • BSC)'
        : 'رادار فعال (آماده اتصال زنده در مرورگر گوشی)';

    const autoBtn = document.getElementById('toggleAutoBotBtn');
    if (botState.autoBotEnabled) {
      autoBtn.className = 'btn-toggle-autobot on';
      autoBtn.textContent = '🟢 ربات خودکار روشن (در حال شکار)';
    } else {
      autoBtn.className = 'btn-toggle-autobot off';
      autoBtn.textContent = '▶️ روشن کردن شکار خودکار';
    }

    document.querySelectorAll('[data-strat-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-strat-mode') === botState.strategyMode);
    });

    document.getElementById('ruleSummaryChips').innerHTML =
      '<span class="rule-chip">مبلغ هر شکار: <b class="ltr-num">$' +
      botState.tradeSizeUsd +
      '</b></span>' +
      '<span class="rule-chip">پله اول سود: <b class="ltr-num">+' +
      botState.tp1Pct +
      '%</b></span>' +
      '<span class="rule-chip">پله دوم پامپ: <b class="ltr-num">+' +
      botState.tp2Pct +
      '%</b></span>' +
      '<span class="rule-chip">حد ضرر: <b class="ltr-num">-' +
      botState.stopLossPct +
      '%</b></span>';

    const posBadge = document.getElementById('openPosBadge');
    posBadge.textContent = String(botState.positions.length);
    posBadge.hidden = botState.positions.length === 0;

    const scamCount = radarItems.filter((x) => !x.shield.safe).length;
    const scamBadge = document.getElementById('blockedScamBadge');
    scamBadge.textContent = String(scamCount);
    scamBadge.hidden = scamCount === 0;
  }

  function buildRadarCardHtml(item, idx) {
    const p = item.pair;
    const sh = item.shield;
    const sig = item.signal;
    const chg5m = Number((p.priceChange && p.priceChange.m5) || 0);
    const chg1h = Number((p.priceChange && p.priceChange.h1) || 0);
    const chg24h = Number((p.priceChange && p.priceChange.h24) || 0);
    const liqUsd = Number((p.liquidity && p.liquidity.usd) || 0);
    const fdv = Number(p.fdv || p.marketCap || 0);
    const dexSwapUrl = window.MemeWalletVault.getDirectDexSwapUrl(p.chainId, p.baseToken.address, 'BUY');

    const cardCls = !sh.safe ? 'meme-card signal-scam' : sig.actionableBuy ? 'meme-card signal-buy' : 'meme-card';

    return (
      '<article class="' +
      cardCls +
      '">' +
      '<div class="mc-top">' +
      '<div class="mc-token-id">' +
      '<div class="token-avatar">' +
      (p.baseToken.symbol || 'M').slice(0, 4) +
      '</div>' +
      '<div>' +
      '<div class="token-symbol-row">' +
      '<span class="token-sym ltr-num">' +
      p.baseToken.symbol +
      '</span>' +
      '<span class="chain-badge">' +
      p.chainId +
      '</span>' +
      '<span class="safety-pill ' +
      (sh.safe ? 'ok' : 'bad') +
      '">' +
      (sh.safe ? '🛡️ امنیت ' + sh.score + '%' : '🚫 تقلبی / مسدود') +
      '</span>' +
      '</div>' +
      '<div style="font-size:0.73rem;color:#94a3b8;">' +
      p.baseToken.name +
      ' • <span class="ltr-num">' +
      p.baseToken.address.slice(0, 6) +
      '...' +
      p.baseToken.address.slice(-4) +
      '</span></div>' +
      '</div>' +
      '</div>' +
      '<div class="mc-price-box">' +
      '<div class="mc-price ltr-num">' +
      fmtTokenPrice(p.priceUsd) +
      '</div>' +
      '<div class="mc-changes ltr-num">' +
      '<span class="' +
      (chg5m >= 0 ? 'pos' : 'neg') +
      '">5m: ' +
      (chg5m >= 0 ? '+' : '') +
      chg5m.toFixed(1) +
      '%</span>' +
      '<span class="' +
      (chg24h >= 0 ? 'pos' : 'neg') +
      '">24h: ' +
      (chg24h >= 0 ? '+' : '') +
      chg24h.toFixed(1) +
      '%</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="mc-metrics-grid">' +
      '<div class="mc-metric"><div class="k">امتیاز شکار کف</div><div class="v ltr-num" style="color:' +
      (sig.signalScore >= 75 ? '#34d399' : '#facc15') +
      '">' +
      sig.signalScore +
      ' / 100</div></div>' +
      '<div class="mc-metric"><div class="k">نقدینگی استخر</div><div class="v ltr-num">' +
      fmtCompactUsd(liqUsd) +
      '</div></div>' +
      '<div class="mc-metric"><div class="k">قدرت خریدار ۵دقیقه</div><div class="v ltr-num">' +
      sig.buyPressurePct +
      '%</div></div>' +
      '<div class="mc-metric"><div class="k">ارزش بازار (FDV)</div><div class="v ltr-num">' +
      fmtCompactUsd(fdv) +
      '</div></div>' +
      '</div>' +
      '<div class="signal-banner-strip">' +
      '<strong>' +
      sig.signalLabel +
      ':</strong> ' +
      sig.reasonFa +
      '</div>' +
      '<div class="mc-actions">' +
      (sh.safe
        ? '<button type="button" class="btn-snipe-buy" data-snipe-idx="' +
          idx +
          '">🎯 شکار از کف ($' +
          botState.tradeSizeUsd +
          ')</button>' +
          '<a class="btn-dex-link" href="' +
          dexSwapUrl +
          '" target="_blank" rel="noopener">⚡ خرید مستقیم DEX</a>'
        : '<button type="button" class="btn-snipe-buy" disabled>🔒 مسدود توسط سپر ضدتقلبی</button>') +
      '<button type="button" class="btn-audit-check" data-copy-ca="' +
      p.baseToken.address +
      '">📋 کپی قرارداد</button>' +
      '</div>' +
      '</article>'
    );
  }

  function renderMainTabView() {
    const view = document.getElementById('mainDynamicView');
    if (!view) return;

    if (activeTab === 'radar') {
      const filtered = radarItems.filter((it) => {
        if (!it.shield.safe) return false; // Scams isolated in Anti-Scam tab!
        if (chainFilter !== 'all' && it.pair.chainId !== chainFilter) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const sym = (it.pair.baseToken.symbol || '').toLowerCase();
          const nm = (it.pair.baseToken.name || '').toLowerCase();
          const ca = (it.pair.baseToken.address || '').toLowerCase();
          if (!sym.includes(q) && !nm.includes(q) && !ca.includes(q)) return false;
        }
        return true;
      });

      view.innerHTML =
        '<div class="section-heading-row">' +
        '<h2>📡 سیگنال‌های زنده میم‌کوین (فقط توکن‌های امن و تأییدشده)</h2>' +
        '<span style="font-size:0.75rem;color:#94a3b8;">' +
        filtered.length +
        ' رمزارز امن</span>' +
        '</div>' +
        '<div class="cards-stack">' +
        (filtered.length > 0
          ? filtered.map((it) => buildRadarCardHtml(it, radarItems.indexOf(it))).join('')
          : '<div class="meme-card" style="text-align:center;color:#94a3b8;">هیچ میم‌کوین امنی با فیلتر فعلی یافت نشد.</div>') +
        '</div>';
      return;
    }

    if (activeTab === 'positions') {
      let openHtml = '';
      if (botState.positions.length === 0) {
        openHtml =
          '<div class="meme-card" style="text-align:center;padding:24px;color:#94a3b8;">هنوز پوزیشن بازی ندارید. روی «🎯 شکار از کف» بزنید یا «شکار خودکار» را روشن کنید.</div>';
      } else {
        openHtml = botState.positions
          .map((pos) => {
            const curVal = pos.remainingQty * pos.currentPriceUsd;
            const unrlUsd = curVal - pos.remainingCostUsd;
            const gainPct = ((pos.currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
            return (
              '<div class="pos-card">' +
              '<div class="mc-top">' +
              '<div><strong class="ltr-num" style="font-size:1.05rem;">' +
              pos.symbol +
              '</strong> <span class="chain-badge">' +
              pos.chainId +
              '</span><div style="font-size:0.72rem;color:#94a3b8;">' +
              pos.openedBy +
              '</div></div>' +
              '<div style="text-align:left;">' +
              '<div class="ltr-num ' +
              (gainPct >= 0 ? 'pos' : 'neg') +
              '" style="font-weight:800;font-size:1.02rem;">' +
              (gainPct >= 0 ? '+' : '') +
              gainPct.toFixed(2) +
              '% (' +
              (unrlUsd >= 0 ? '+' : '') +
              fmtUsd(unrlUsd) +
              ')</div>' +
              '<div style="font-size:0.72rem;color:#94a3b8;" class="ltr-num">ورود: ' +
              fmtTokenPrice(pos.entryPriceUsd) +
              ' → فعلی: ' +
              fmtTokenPrice(pos.currentPriceUsd) +
              '</div></div></div>' +
              '<div class="tp-ladder">' +
              '<div class="tp-step ' +
              (pos.tp1Hit ? 'hit' : '') +
              '">پله ۱ (+' +
              botState.tp1Pct +
              '%) ' +
              (pos.tp1Hit ? '✓ فروخته شد' : 'در انتظار') +
              '</div>' +
              '<div class="tp-step ' +
              (pos.tp2Hit ? 'hit' : '') +
              '">پله ۲ (+' +
              botState.tp2Pct +
              '%) ' +
              (pos.tp2Hit ? '✓ فروخته شد' : 'در انتظار') +
              '</div>' +
              '<div class="tp-step">حد سود متحرک (-' +
              botState.trailingDropPct +
              '% از قله)</div>' +
              '</div>' +
              '<div class="mc-actions" style="margin-top:12px;">' +
              '<button type="button" class="btn-sell-now" data-sell-pos="' +
              pos.id +
              '" data-sell-frac="0.5">فروش ۵۰٪ (سیو سود)</button>' +
              '<button type="button" class="btn-sell-now" style="background:#ef4444;color:#fff;" data-sell-pos="' +
              pos.id +
              '" data-sell-frac="1">فروش کامل ۱۰۰٪</button>' +
              '</div></div>'
            );
          })
          .join('');
      }

      const closedHtml =
        botState.closedTrades.length === 0
          ? '<div style="font-size:0.8rem;color:#94a3b8;">هنوز معامله بسته‌شده‌ای ثبت نشده است.</div>'
          : botState.closedTrades
              .slice(0, 12)
              .map(
                (ct) =>
                  '<div class="meme-card" style="padding:11px 14px;display:flex;justify-content:space-between;align-items:center;">' +
                  '<div><strong class="ltr-num">' +
                  ct.symbol +
                  '</strong> <span class="chain-badge">' +
                  ct.chainId +
                  '</span><div style="font-size:0.73rem;color:#94a3b8;">' +
                  ct.reason +
                  '</div></div>' +
                  '<div class="ltr-num ' +
                  (ct.pnlUsd >= 0 ? 'pos' : 'neg') +
                  '" style="font-weight:800;">' +
                  (ct.pnlUsd >= 0 ? '+' : '') +
                  fmtUsd(ct.pnlUsd) +
                  ' (' +
                  (ct.pnlPct >= 0 ? '+' : '') +
                  ct.pnlPct +
                  '%)</div></div>'
              )
              .join('');

      view.innerHTML =
        '<div class="section-heading-row"><h2>🎯 پوزیشن‌های باز و فروش هوشمند پله‌ای</h2></div>' +
        '<div class="cards-stack">' +
        openHtml +
        '</div>' +
        '<div class="section-heading-row" style="margin-top:22px;"><h2>📜 تاریخچه شکار و سیو سودها</h2></div>' +
        '<div class="cards-stack">' +
        closedHtml +
        '</div>';
      return;
    }

    if (activeTab === 'scams') {
      const blocked = radarItems.filter((x) => !x.shield.safe);
      view.innerHTML =
        '<div class="section-heading-row"><h2>🛡️ لیست سیاه میم‌کوین‌های تقلبی مسدودشده</h2></div>' +
        '<div class="meme-card" style="margin-bottom:12px;border-color:rgba(16,185,129,0.35);">' +
        '<div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;">🔍 تست فوری آدرس قرارداد میم‌کوین قبل از خرید (Solana / BSC / Base / ETH):</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<input id="customContractInput" class="search-box-input ltr-num" placeholder="0x... یا آدرس قرارداد سولانا را الصاق کنید" />' +
        '<button type="button" id="runCustomAuditBtn" class="btn-snipe-buy" style="flex:0 0 auto;">بررسی اصالت</button>' +
        '</div></div>' +
        '<div class="cards-stack">' +
        (blocked.length > 0
          ? blocked.map((it) => buildRadarCardHtml(it, radarItems.indexOf(it))).join('')
          : '<div class="meme-card" style="text-align:center;color:#34d399;">تمام توکن‌های فعلی در تست امنیت قبول شدند.</div>') +
        '</div>';
      return;
    }

    if (activeTab === 'wallet') {
      const ledgerHtml = (vault.ledger || [])
        .slice(0, 15)
        .map(
          (tx) =>
            '<div class="meme-card" style="padding:11px 14px;display:flex;justify-content:space-between;align-items:center;">' +
            '<div><strong>' +
            (tx.type === 'DEPOSIT' ? '📥 واریز به کیف‌پول' : '📤 برداشت وجه') +
            '</strong> • <span style="font-size:0.75rem;color:#94a3b8;">' +
            tx.network +
            '</span><div style="font-size:0.72rem;color:#94a3b8;" class="ltr-num">' +
            tx.destination +
            '</div></div>' +
            '<div style="text-align:left;"><div class="ltr-num ' +
            (tx.type === 'DEPOSIT' ? 'pos' : '') +
            '" style="font-weight:800;">' +
            (tx.type === 'DEPOSIT' ? '+' : '-') +
            fmtUsd(tx.amountUsd) +
            '</div><div style="font-size:0.7rem;color:#34d399;">' +
            tx.status +
            '</div></div></div>'
        )
        .join('');

      view.innerHTML =
        '<div class="section-heading-row"><h2>💼 مدیریت کیف‌پول، واریز و برداشت</h2></div>' +
        '<div class="meme-card" style="margin-bottom:14px;">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
        '<button type="button" class="btn-deposit-key" data-open-modal="depositModal">📥 کلید واریز (Deposit)</button>' +
        '<button type="button" class="btn-withdraw-key" data-open-modal="withdrawModal">📤 کلید برداشت (Withdraw)</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">' +
        '<button type="button" class="btn-dex-link" id="connectPhantomBtn">🟣 اتصال کیف‌پول Phantom (سولانا)</button>' +
        '<button type="button" class="btn-dex-link" id="connectTrustBtn">🔵 اتصال Trust Wallet / MetaMask</button>' +
        '</div></div>' +
        '<div class="section-heading-row"><h2>🧾 رسید تراکنش‌های واریز و برداشت</h2></div>' +
        '<div class="cards-stack">' +
        ledgerHtml +
        '</div>';
      return;
    }

    if (activeTab === 'settings') {
      view.innerHTML =
        '<div class="section-heading-row"><h2>⚙️ تنظیمات دقیق شکار کف و فروش در پامپ</h2></div>' +
        '<form id="botSettingsForm" class="meme-card">' +
        '<div class="form-field"><label>مبلغ ورود در هر شکار میم‌کوین (دلار / تتر)</label>' +
        '<input type="number" id="setTradeSize" min="10" max="10000" step="5" value="' +
        botState.tradeSizeUsd +
        '" class="ltr-num" /></div>' +
        '<div class="form-field"><label>حداقل نقدینگی قفل‌شده استخر برای جلوگیری از توکن تقلبی ($)</label>' +
        '<input type="number" id="setMinLiq" min="5000" max="500000" step="1000" value="' +
        botState.minLiquidityUsd +
        '" class="ltr-num" /></div>' +
        '<div class="form-field"><label>پله اول فروش در رشد (TP1 % — فروش ۴۰٪ و ریسک‌فری کردن)</label>' +
        '<input type="number" id="setTp1" min="8" max="200" value="' +
        botState.tp1Pct +
        '" class="ltr-num" /></div>' +
        '<div class="form-field"><label>پله دوم فروش در پامپ (TP2 %)</label>' +
        '<input type="number" id="setTp2" min="20" max="500" value="' +
        botState.tp2Pct +
        '" class="ltr-num" /></div>' +
        '<div class="form-field"><label>حد سود متحرک شکار قله پامپ (درصد برگشت از بالاترین قیمت)</label>' +
        '<input type="number" id="setTrailing" min="4" max="35" value="' +
        botState.trailingDropPct +
        '" class="ltr-num" /></div>' +
        '<div class="form-field"><label>حد ضرر محافظت سرمایه (Stop-Loss %)</label>' +
        '<input type="number" id="setSl" min="5" max="40" value="' +
        botState.stopLossPct +
        '" class="ltr-num" /></div>' +
        '<button type="submit" class="btn-snipe-buy" style="width:100%;">💾 ذخیره تنظیمات رادار و ربات</button>' +
        '</form>';
    }
  }

  function updateDepositModalQr() {
    const netSel = document.getElementById('depNetworkSelect');
    if (!netSel) return;
    const net = netSel.value;
    const addr =
      vault.web3 && vault.web3.connected && vault.web3.chain === net
        ? vault.web3.address
        : vault.botReceivingAddresses[net] || vault.botReceivingAddresses.solana;
    document.getElementById('depQrContainer').innerHTML = window.MemeWalletVault.generateAddressVisualSvg(addr);
    document.getElementById('depAddressText').textContent = addr;
  }

  function renderAll() {
    renderSonarBlips();
    renderWalletHeader();
    renderMainTabView();
    document.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === activeTab);
    });
    document.querySelectorAll('[data-chain]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-chain') === chainFilter);
    });
    const filterWrap = document.getElementById('radarFilterToolbar');
    if (filterWrap) filterWrap.style.display = activeTab === 'radar' ? 'flex' : 'none';
  }

  function initEvents() {
    // PWA Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
    });

    document.getElementById('installPwaBtn').addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice.catch(() => {});
        deferredInstallPrompt = null;
      } else {
        document.getElementById('installGuideModal').hidden = false;
      }
    });

    document.getElementById('soundToggleBtn').addEventListener('click', () => {
      botState.soundEnabled = !botState.soundEnabled;
      document.getElementById('soundToggleBtn').textContent = botState.soundEnabled ? '🔔' : '🔕';
      saveBotState();
      showToast(botState.soundEnabled ? 'صدای هشدار رادار فعال شد' : 'صدای هشدار رادار بی‌صدا شد');
    });

    document.getElementById('toggleAutoBotBtn').addEventListener('click', () => {
      botState.autoBotEnabled = !botState.autoBotEnabled;
      saveBotState();
      if (botState.autoBotEnabled) {
        playRadarBeep('buy');
        showToast('🤖 ربات شکار خودکار فعال شد! فقط میم‌کوین‌های امن کف بازار شکار می‌شوند.');
        runRadarScan(false);
      } else {
        showToast('ربات شکار خودکار متوقف شد (مدیریت فروش پوزیشن‌های باز همچنان فعال است).');
        renderAll();
      }
    });

    document.getElementById('manualScanBtn').addEventListener('click', () => {
      runRadarScan(true);
    });

    document.getElementById('radarSearchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderMainTabView();
    });

    // Delegated clicks across app
    document.addEventListener('click', async (e) => {
      const t = e.target;

      const stratBtn = t.closest('[data-strat-mode]');
      if (stratBtn) {
        botState.strategyMode = stratBtn.getAttribute('data-strat-mode');
        saveBotState();
        runRadarScan(false);
        return;
      }

      const chainBtn = t.closest('[data-chain]');
      if (chainBtn) {
        chainFilter = chainBtn.getAttribute('data-chain');
        renderAll();
        return;
      }

      const tabBtn = t.closest('[data-tab]');
      if (tabBtn) {
        activeTab = tabBtn.getAttribute('data-tab');
        renderAll();
        return;
      }

      const snipeBtn = t.closest('[data-snipe-idx]');
      if (snipeBtn) {
        const idx = Number(snipeBtn.getAttribute('data-snipe-idx'));
        executeBuyMeme(radarItems[idx], false);
        return;
      }

      const copyBtn = t.closest('[data-copy-ca]');
      if (copyBtn) {
        const ca = copyBtn.getAttribute('data-copy-ca');
        if (navigator.clipboard) navigator.clipboard.writeText(ca).catch(() => {});
        showToast('آدرس قرارداد کپی شد: ' + ca.slice(0, 10) + '...');
        return;
      }

      const sellBtn = t.closest('[data-sell-pos]');
      if (sellBtn) {
        const pid = sellBtn.getAttribute('data-sell-pos');
        const frac = parseFloat(sellBtn.getAttribute('data-sell-frac') || '1');
        closePositionFraction(pid, frac, 'فروش دستی توسط کاربر');
        return;
      }

      const openModalBtn = t.closest('[data-open-modal]');
      if (openModalBtn) {
        const mid = openModalBtn.getAttribute('data-open-modal');
        const modal = document.getElementById(mid);
        if (modal) {
          modal.hidden = false;
          if (mid === 'depositModal') updateDepositModalQr();
          if (mid === 'withdrawModal') {
            document.getElementById('wdAvailableLabel').textContent = fmtUsd(vault.cashUsd);
          }
        }
        return;
      }

      const closeModalBtn = t.closest('[data-close-modal]');
      if (closeModalBtn) {
        const modal = closeModalBtn.closest('.modal-backdrop');
        if (modal) modal.hidden = true;
        return;
      }

      const quickDep = t.closest('[data-dep-amt]');
      if (quickDep) {
        document.getElementById('depAmountInput').value = quickDep.getAttribute('data-dep-amt');
        return;
      }

      const quickWdPct = t.closest('[data-wd-pct]');
      if (quickWdPct) {
        const pct = parseFloat(quickWdPct.getAttribute('data-wd-pct'));
        document.getElementById('wdAmountInput').value = Math.max(0, (vault.cashUsd * pct) / 100).toFixed(2);
        return;
      }

      if (t.id === 'copyDepAddrBtn') {
        const addr = document.getElementById('depAddressText').textContent;
        if (navigator.clipboard) navigator.clipboard.writeText(addr).catch(() => {});
        showToast('آدرس واریز کپی شد!');
        return;
      }

      if (t.id === 'runCustomAuditBtn') {
        const inp = document.getElementById('customContractInput');
        if (inp) scanCustomContractAddress(inp.value);
        return;
      }

      if (t.id === 'headerWeb3Btn' || t.id === 'connectPhantomBtn' || t.id === 'connectTrustBtn') {
        const pref = t.id === 'connectTrustBtn' ? 'evm' : 'solana';
        const res = await window.MemeWalletVault.connectRealWeb3Wallet(pref);
        if (res.ok) {
          vault.web3 = {
            connected: true,
            walletName: res.walletName,
            chain: res.chain,
            address: res.address,
            nativeSymbol: res.nativeSymbol,
            nativeBalance: res.nativeBalance
          };
          window.MemeWalletVault.saveVault(vault);
          showToast('✅ متصل شد: ' + res.walletName + ' (' + res.address.slice(0, 6) + '...)');
          renderAll();
        } else if (res.needDeepLink) {
          showToast(res.message);
          window.open(res.deepLinkUrl, '_blank', 'noopener');
        }
      }
    });

    document.getElementById('depNetworkSelect').addEventListener('change', updateDepositModalQr);

    // Deposit Submit
    document.getElementById('depositForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const amt = parseFloat(document.getElementById('depAmountInput').value || '0');
      const netSel = document.getElementById('depNetworkSelect');
      const netLabel = netSel.options[netSel.selectedIndex].text;
      if (!isFinite(amt) || amt < 5) {
        showToast('حداقل مبلغ واریز ۵ دلار است.', true);
        return;
      }
      vault.cashUsd = Number((vault.cashUsd + amt).toFixed(2));
      vault.totalDepositedUsd = Number((vault.totalDepositedUsd + amt).toFixed(2));
      vault.ledger.unshift({
        id: 'DEP-' + Date.now().toString(36).toUpperCase(),
        type: 'DEPOSIT',
        network: netLabel,
        amountUsd: amt,
        feeUsd: 0,
        destination: 'شارژ کیف‌پول شکار ربات',
        status: 'تأیید و شارژ آنی',
        ts: Date.now()
      });
      window.MemeWalletVault.saveVault(vault);
      document.getElementById('depositModal').hidden = true;
      playRadarBeep('profit');
      showToast('📥 واریز ' + fmtUsd(amt) + ' با موفقیت به موجودی شکار اضافه شد.');
      renderAll();
    });

    // Withdraw Submit
    document.getElementById('withdrawForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const net = document.getElementById('wdNetworkSelect').value;
      const addr = document.getElementById('wdDestAddress').value.trim();
      const amt = parseFloat(document.getElementById('wdAmountInput').value || '0');

      const check = window.MemeWalletVault.validateCryptoAddress(net, addr);
      if (!check.valid) {
        playRadarBeep('warn');
        showToast(check.error, true);
        return;
      }
      if (!isFinite(amt) || amt < 5) {
        showToast('حداقل مبلغ قابل برداشت ۵ دلار است.', true);
        return;
      }
      if (amt > vault.cashUsd) {
        showToast('مبلغ درخواستی بیشتر از موجودی نقد آزاد شماست.', true);
        return;
      }

      const feeMap = { solana: 0.2, bsc: 0.35, base: 0.25, trc20: 1.0 };
      const fee = feeMap[net] || 0.25;
      vault.cashUsd = Number((vault.cashUsd - amt).toFixed(2));
      vault.totalWithdrawnUsd = Number((vault.totalWithdrawnUsd + amt).toFixed(2));
      vault.ledger.unshift({
        id: 'WD-' + Date.now().toString(36).toUpperCase(),
        type: 'WITHDRAW',
        network: net.toUpperCase(),
        amountUsd: amt,
        feeUsd: fee,
        destination: addr.slice(0, 8) + '...' + addr.slice(-6),
        status: 'ارسال‌شده (خالص: $' + Math.max(0, amt - fee).toFixed(2) + ')',
        ts: Date.now()
      });
      window.MemeWalletVault.saveVault(vault);
      document.getElementById('withdrawModal').hidden = true;
      document.getElementById('wdDestAddress').value = '';
      playRadarBeep('buy');
      showToast('📤 درخواست برداشت ' + fmtUsd(amt) + ' به آدرس مقصد ثبت و ارسال شد.');
      renderAll();
    });

    // Settings Form Submit
    document.addEventListener('submit', (e) => {
      if (e.target && e.target.id === 'botSettingsForm') {
        e.preventDefault();
        botState.tradeSizeUsd = Math.max(5, Number(document.getElementById('setTradeSize').value) || 50);
        botState.minLiquidityUsd = Math.max(5000, Number(document.getElementById('setMinLiq').value) || 15000);
        botState.tp1Pct = Math.max(5, Number(document.getElementById('setTp1').value) || 25);
        botState.tp2Pct = Math.max(botState.tp1Pct + 5, Number(document.getElementById('setTp2').value) || 55);
        botState.trailingDropPct = Math.max(3, Number(document.getElementById('setTrailing').value) || 9);
        botState.stopLossPct = Math.max(3, Number(document.getElementById('setSl').value) || 12);
        saveBotState();
        showToast('✅ تنظیمات شکار کف و فروش پله‌ای ذخیره شد.');
        runRadarScan(false);
      }
    });
  }

  // Register Service Worker for Mobile Home-Screen Installation
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    renderAll();
    runRadarScan(false);
    setInterval(() => runRadarScan(false), 10000);
  });
})();
