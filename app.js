if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

(() => {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#action-dialog');
  const title = $('#dialog-title');
  const copy = $('#dialog-copy');
  const amountInput = $('#amount-input');
  const sideField = $('#side-field');
  const confirmButton = $('#dialog-confirm');
  const balanceNode = $('#balance');
  const toastNode = $('#toast');
  let balance = 10000;
  let currentAction = '';
  let toastTimer;

  const faNumber = (n) => new Intl.NumberFormat('fa-IR').format(n);
  const showToast = (message) => {
    toastNode.textContent = message;
    toastNode.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastNode.classList.remove('show'), 2800);
  };
  const formatBalance = () => {
    balanceNode.textContent = balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const openAction = (action) => {
    currentAction = action;
    amountInput.value = '';
    sideField.classList.toggle('hidden', action !== 'trade');
    const config = {
      deposit: ['افزایش موجودی دمو', 'مبلغ انتخابی فقط به موجودی آزمایشی اضافه می‌شود؛ هیچ واریز واقعی انجام نمی‌شود.', 'افزودن به حساب دمو'],
      withdraw: ['برداشت از حساب دمو', `فقط موجودی مجازی برداشت می‌شود. موجودی فعلی: ${balance.toLocaleString('en-US')} USDT.`, 'برداشت آزمایشی'],
      trade: ['ثبت سفارش کاغذی', 'این سفارش فقط در فهرست معاملات آزمایشی ثبت می‌شود و به صرافی ارسال نخواهد شد.', 'ثبت سفارش آزمایشی'],
    }[action];
    title.textContent = config[0];
    copy.textContent = config[1];
    confirmButton.textContent = config[2];
    dialog.showModal();
    setTimeout(() => amountInput.focus(), 50);
  };

  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => openAction(button.dataset.action)));
  $('#manual-trade').addEventListener('click', () => openAction('trade'));
  document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.scroll).scrollIntoView({ behavior: 'smooth' })));
  $('.notice-close').addEventListener('click', () => $('.notice-bar').remove());
  $('#pair-select').addEventListener('click', () => showToast('در نسخه دمو، فقط بازار نمونه BTC / USDT نمایش داده می‌شود.'));
  document.querySelectorAll('.timeframes button').forEach((button) => button.addEventListener('click', () => {
    document.querySelector('.timeframes .selected')?.classList.remove('selected');
    button.classList.add('selected');
    showToast(`بازه ${button.textContent} انتخاب شد؛ نمودار همچنان داده نمونه است.`);
  }));
  $('#upload-trigger').addEventListener('click', () => $('#chart-upload').click());
  $('#chart-upload').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const preview = $('#image-preview');
    const image = preview.querySelector('img');
    image.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    $('#price-chart').classList.add('hidden');
    $('.chart-watermark').classList.add('hidden');
    document.querySelectorAll('.chart-overlay-label').forEach((node) => node.classList.add('hidden'));
    $('#upload-message').classList.remove('hidden');
    showToast('تصویر آماده شد؛ تحلیل خودکار تصویر در این نسخه فعال نیست.');
  });
  $('#remove-image').addEventListener('click', () => {
    $('#chart-upload').value = '';
    $('#image-preview').classList.add('hidden');
    $('#price-chart').classList.remove('hidden');
    $('.chart-watermark').classList.remove('hidden');
    document.querySelectorAll('.chart-overlay-label').forEach((node) => node.classList.remove('hidden'));
    $('#upload-message').classList.add('hidden');
  });

  $('#bot-toggle').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const isRunning = button.dataset.running === 'true';
    button.dataset.running = String(!isRunning);
    button.innerHTML = isRunning ? '<span>▶</span> شروع شبیه‌سازی' : '<span>Ⅱ</span> توقف ربات';
    $('#bot-status').textContent = isRunning ? 'متوقف' : 'در حال اجرا';
    $('.bot-stat .status-dot').style.background = isRunning ? '#7f8b96' : '#38d6a1';
    $('.bot-stat .status-dot').style.boxShadow = isRunning ? 'none' : '0 0 9px #38d6a188';
    showToast(isRunning ? 'ربات آزمایشی متوقف شد.' : 'ربات در حالت شبیه‌سازی فعال شد؛ سفارش واقعی ارسال نمی‌شود.');
  });

  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'confirm') return;
    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('لطفاً مبلغی معتبر و بیشتر از صفر وارد کنید.');
      return;
    }
    if (currentAction === 'deposit') {
      balance += amount;
      formatBalance();
      showToast(`${amount.toLocaleString('en-US')} USDT به موجودی آزمایشی اضافه شد.`);
    } else if (currentAction === 'withdraw') {
      if (amount > balance) return showToast('مبلغ برداشت از موجودی آزمایشی بیشتر است.');
      balance -= amount;
      formatBalance();
      showToast(`${amount.toLocaleString('en-US')} USDT از موجودی آزمایشی کم شد.`);
    } else if (currentAction === 'trade') {
      const side = $('#trade-side').value;
      const row = document.createElement('div');
      row.className = 'position-row';
      row.innerHTML = `<div class="asset-name"><span class="coin-icon">₿</span><b>BTC / USDT</b></div><span class="type-pill ${side === 'خرید' ? 'long' : 'short'}">${side}</span><span>67,842</span><span class="neutral-text">—</span><button class="close-position" aria-label="بستن موقعیت آزمایشی">×</button>`;
      $('.position-table').appendChild(row);
      row.querySelector('.close-position').addEventListener('click', () => closePosition(row));
      updateOpenCount(1);
      showToast(`سفارش ${side} به مبلغ ${amount} USDT در محیط کاغذی ثبت شد.`);
    }
  });

  const closePosition = (row) => {
    row.remove();
    updateOpenCount(-1);
    showToast('موقعیت آزمایشی بسته شد؛ این عملیات اثری بر حساب واقعی ندارد.');
  };
  const updateOpenCount = (delta) => {
    const node = $('#open-count');
    const current = Number(node.dataset.count || 2) + delta;
    node.dataset.count = String(Math.max(0, current));
    node.textContent = faNumber(Math.max(0, current));
  };
  document.querySelectorAll('.close-position').forEach((button) => button.addEventListener('click', () => closePosition(button.closest('.position-row'))));
})();
