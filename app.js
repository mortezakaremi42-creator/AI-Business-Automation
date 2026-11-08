if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

(() => {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#action-dialog');
  const toastNode = $('#toast');
  const amountInput = $('#amount-input');
  const sideField = $('#side-field');
  const confirmButton = $('#dialog-confirm');
  let currentAction = '';
  let snapshot = null;
  let toastTimer;

  const faNumber = (n, digits = 2) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number(n || 0));
  const usd = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const showToast = (message) => {
    toastNode.textContent = message;
    toastNode.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastNode.classList.remove('show'), 3600);
  };
  const api = async (url, body, method = 'POST') => {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `خطای سرور (${response.status})`);
    return data;
  };
  const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
  const signedNumber = (value) => `${value > 0 ? '+' : ''}${usd(value)}`;
  const setPnlTone = (node, value) => {
    node.classList.toggle('positive', value > 0);
    node.classList.toggle('negative', value < 0);
    node.classList.toggle('neutral-text', value === 0);
  };
  const reasonFa = (reason) => ({
    MANUAL: 'بستن دستی', TRAILING_STOP: 'حد ضرر متحرک', PROTECTIVE_STOP: 'حد ضرر محافظ',
    DAILY_DRAWDOWN_CUTOFF: 'سقف زیان روزانه', PANIC_STOP: 'توقف اضطراری',
    'TAKE_PROFIT_10%': 'سود پله‌ای ۱۰٪', 'TAKE_PROFIT_20%': 'سود پله‌ای ۲۰٪',
  }[reason] || reason || '—');

  function renderPosition(position) {
    const row = document.createElement('div');
    row.className = 'position-row';
    const asset = document.createElement('div'); asset.className = 'asset-name';
    const icon = document.createElement('span'); icon.className = 'coin-icon'; icon.textContent = position.symbol.split('/')[0].slice(0, 1);
    const name = document.createElement('b'); name.textContent = position.symbol; asset.append(icon, name);
    const side = document.createElement('span'); side.className = 'type-pill long'; side.textContent = 'خرید';
    const entry = document.createElement('span'); entry.textContent = usd(position.entryPrice);
    const pnlValue = (position.markPrice - position.entryPrice) * position.remainingQty - position.remainingQty * position.markPrice * 0.002;
    const pnl = document.createElement('span'); pnl.className = pnlValue >= 0 ? 'positive' : 'negative'; pnl.textContent = signedNumber(pnlValue);
    const close = document.createElement('button'); close.className = 'close-position'; close.type = 'button'; close.setAttribute('aria-label', 'بستن موقعیت دمو'); close.textContent = '×';
    close.addEventListener('click', async () => {
      try {
        await api(`/api/positions/${encodeURIComponent(position.id)}/close`, { price: position.markPrice });
        showToast('موقعیت دمو بسته شد؛ سود و کارمزد در آمار نهایی ثبت شد.');
        await refreshStatus();
      } catch (error) { showToast(error.message); }
    });
    row.append(asset, side, entry, pnl, close);
    return row;
  }

  function renderClosedTrade(trade) {
    const row = document.createElement('div'); row.className = 'history-row';
    const asset = document.createElement('b'); asset.textContent = trade.symbol;
    const prices = document.createElement('span'); prices.textContent = `${usd(trade.entryPrice)} ← ${usd(trade.exitPrice)}`;
    const pnl = document.createElement('span'); pnl.className = trade.netPnl > 0 ? 'positive' : trade.netPnl < 0 ? 'negative' : 'neutral-text'; pnl.textContent = signedNumber(trade.netPnl);
    const reason = document.createElement('span'); reason.textContent = reasonFa(trade.reason);
    row.append(asset, prices, pnl, reason);
    return row;
  }

  async function refreshStatus() {
    const data = await api('/api/status', undefined, 'GET');
    snapshot = data;
    setText('#balance', usd(data.cash));
    const dailyPnl = Number(data.dailyPnl || 0);
    const pnlNode = $('#pnl'); pnlNode.textContent = signedNumber(dailyPnl); setPnlTone(pnlNode, dailyPnl);
    const dayReturn = data.dayStartEquity ? (dailyPnl / data.dayStartEquity) * 100 : 0;
    setText('#daily-return', `${dayReturn > 0 ? '+' : ''}${faNumber(dayReturn, 2)}٪`);
    setText('#open-count', faNumber(data.openPositions, 0));
    setText('#open-label', faNumber(data.openPositions, 0));
    setText('#closed-count', faNumber(data.closedTrades, 0));
    setText('#wins-losses', `${faNumber(data.winningTrades, 0)} / ${faNumber(data.losingTrades, 0)}`);
    setText('#win-rate', `${faNumber(data.winRate, 2)}٪`);
    const netNode = $('#net-profit'); netNode.textContent = signedNumber(data.netProfit); setPnlTone(netNode, data.netProfit);
    setText('#total-fees', usd(data.fees));
    setText('#market-mode', data.mode === 'PAPER' ? 'دمو · بدون اتصال صرافی' : data.mode);
    const start = $('#bot-toggle');
    start.dataset.running = String(Boolean(data.botRunning));
    start.innerHTML = data.botRunning ? '<span>Ⅱ</span> توقف موتور دمو' : '<span>▶</span> شروع موتور دمو';
    setText('#bot-status', data.botRunning ? 'فعال · دمو' : data.killLatched ? 'قفل اضطراری' : data.cooldownUntil ? 'توقف ریسک' : 'متوقف');
    const statusDot = $('.bot-stat .status-dot');
    if (statusDot) { statusDot.style.background = data.botRunning ? '#38d6a1' : data.killLatched ? '#f07882' : '#7f8b96'; statusDot.style.boxShadow = data.botRunning ? '0 0 9px #38d6a188' : 'none'; }
    const rows = $('#position-rows'); rows.replaceChildren(...(data.positions || []).map(renderPosition));
    $('#empty-positions').classList.toggle('hidden', (data.positions || []).length > 0);
    const history = $('#closed-rows'); history.replaceChildren(...(data.recentClosedTrades || []).map(renderClosedTrade));
    $('#empty-history').classList.toggle('hidden', (data.recentClosedTrades || []).length > 0);
    $('#panic-button').disabled = !(data.openPositions || data.botRunning || data.killLatched);
    $('#reset-panic').classList.toggle('hidden', !data.killLatched);
    return data;
  }

  const openAction = (action) => {
    currentAction = action;
    amountInput.value = '';
    sideField.classList.toggle('hidden', action !== 'trade');
    const config = {
      deposit: ['افزایش موجودی دمو', 'این مبلغ فقط به حساب کاغذی اضافه می‌شود؛ واریز واقعی وجود ندارد.', 'افزودن به دمو'],
      withdraw: ['برداشت از حساب دمو', `فقط موجودی مجازی برداشت می‌شود. موجودی فعلی: ${usd(snapshot?.cash)} USDT.`, 'برداشت دمو'],
      trade: ['خرید نقدی آزمایشی', 'سفارش خرید Spot فقط در موتور دمو ثبت می‌شود. مبلغ ورودی بر حسب USDT است؛ قیمت نمایشی BTC/USDT بوده و داده بازار زنده نیست.', 'ثبت سفارش دمو'],
    }[action];
    $('#dialog-title').textContent = config[0];
    $('#dialog-copy').textContent = config[1];
    confirmButton.textContent = config[2];
    dialog.showModal();
    setTimeout(() => amountInput.focus(), 50);
  };

  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => openAction(button.dataset.action)));
  $('#manual-trade').addEventListener('click', () => openAction('trade'));
  document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.scroll).scrollIntoView({ behavior: 'smooth' })));
  $('.notice-close').addEventListener('click', () => $('.notice-bar').remove());
  $('#pair-select').addEventListener('click', () => showToast('بازار نمونه BTC/USDT است؛ دادهٔ زنده متصل نیست.'));
  document.querySelectorAll('.timeframes button').forEach((button) => button.addEventListener('click', () => {
    document.querySelector('.timeframes .selected')?.classList.remove('selected'); button.classList.add('selected');
    showToast(`بازه ${button.textContent} انتخاب شد؛ نمودار نمونه تغییر داده نمی‌شود.`);
  }));
  $('#upload-trigger').addEventListener('click', () => $('#chart-upload').click());
  $('#chart-upload').addEventListener('change', (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    const preview = $('#image-preview'); preview.querySelector('img').src = URL.createObjectURL(file); preview.classList.remove('hidden');
    $('#price-chart').classList.add('hidden'); $('.chart-watermark').classList.add('hidden');
    document.querySelectorAll('.chart-overlay-label').forEach((node) => node.classList.add('hidden'));
    $('#upload-message').classList.remove('hidden'); showToast('تصویر دریافت شد؛ این نسخه تصویر را تحلیل نمی‌کند.');
  });
  $('#remove-image').addEventListener('click', () => {
    $('#chart-upload').value = ''; $('#image-preview').classList.add('hidden'); $('#price-chart').classList.remove('hidden');
    $('.chart-watermark').classList.remove('hidden'); document.querySelectorAll('.chart-overlay-label').forEach((node) => node.classList.remove('hidden'));
    $('#upload-message').classList.add('hidden');
  });

  $('#bot-toggle').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      const isRunning = button.dataset.running === 'true';
      const data = await api(isRunning ? '/api/bot/stop' : '/api/bot/start', {});
      showToast(data.botRunning ? 'موتور دمو فعال شد؛ فید قیمت و API صرافی متصل نیست.' : 'موتور دمو متوقف شد.');
      await refreshStatus();
    } catch (error) { showToast(error.message); }
  });

  $('#reset-panic').addEventListener('click', async () => {
    if (!window.confirm('قفل توقف اضطراری برداشته شود؟ این کار معامله را شروع نمی‌کند.')) return;
    try { await api('/api/panic/reset', {}); await refreshStatus(); showToast('قفل اضطراری بازنشانی شد؛ موتور همچنان متوقف است.'); }
    catch (error) { showToast(error.message); }
  });

  $('#mode-toggle').addEventListener('click', async () => {
    try { await api('/api/mode', { mode: 'REAL' }); }
    catch (error) { showToast(`حالت واقعی قفل است: ${error.message}`); }
  });

  $('#panic-button').addEventListener('click', async () => {
    if (!window.confirm('توقف اضطراری دمو؟ همه موقعیت‌های کاغذی با آخرین قیمت شبیه‌سازی‌شده بسته می‌شوند، سفارش‌های معلق پاک و موتور قفل می‌شود.')) return;
    try {
      const result = await api('/api/panic', {});
      showToast(`توقف اضطراری دمو انجام شد؛ ${faNumber(result.closed.length, 0)} موقعیت بسته و ${faNumber(result.cancelledOrders, 0)} سفارش معلق لغو شد.`);
      await refreshStatus();
    } catch (error) { showToast(error.message); }
  });
  $('#refresh-stats').addEventListener('click', async () => { try { await refreshStatus(); showToast('آمار از موتور سمت سرور دریافت شد.'); } catch (error) { showToast(error.message); } });

  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'confirm') return;
    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) { showToast('لطفاً مبلغی معتبر و بزرگ‌تر از صفر وارد کنید.'); return; }
    try {
      if (currentAction === 'deposit' || currentAction === 'withdraw') {
        await api('/api/demo/cash', { direction: currentAction, amount });
        showToast(currentAction === 'deposit' ? 'موجودی حساب دمو افزایش یافت.' : 'موجودی حساب دمو کاهش یافت.');
      } else if (currentAction === 'trade') {
        const price = 67_842.5;
        await api('/api/trades', { symbol: 'BTC/USDT', side: 'BUY', quantity: amount / price, price, referencePrice: price }, 'POST');
        showToast('خرید Spot در موتور دمو ثبت شد. برای مدیریت حدها، قیمت بسته‌شده باید به موتور برسد.');
      }
      await refreshStatus();
    } catch (error) { showToast(error.message); }
  });

  refreshStatus().catch((error) => {
    showToast(`اتصال به موتور دمو برقرار نشد: ${error.message}`);
    $('#panic-button').disabled = true;
    $('#bot-toggle').disabled = true;
  });
})();
