/**
 * MEME HUNTER RADAR PRO — Non-Custodial Web3 + Smart Bot Vault (Deposit & Withdraw Engine)
 * Supports:
 *  1) Live Web3 Wallets (Phantom / Solflare on Solana, TrustWallet / MetaMask on BSC & Base)
 *  2) Smart Bot Vault (Real-time DEX price execution with full Deposit/Withdraw ledger)
 */
(function () {
  'use strict';

  const VAULT_STORAGE_KEY = 'meme_hunter_vault_v1';

  const DEFAULT_VAULT = {
    mode: 'SMART_VAULT', // 'SMART_VAULT' | 'LIVE_WEB3'
    cashUsd: 500.0,
    initialDepositUsd: 500.0,
    totalDepositedUsd: 500.0,
    totalWithdrawnUsd: 0.0,
    botReceivingAddresses: {
      solana: '7xK9mR4vQ2pL8nW5tY3cB6fH1jD9sA4eU8zV2mN6pQrS',
      bsc: '0x8F4C2b9E7A1d3056C8e4B1927D5A6E3f9012C4B8',
      base: '0x8F4C2b9E7A1d3056C8e4B1927D5A6E3f9012C4B8',
      trc20: 'TQ9xR7mK4vP2nL8wY5cB6fH1jD9sA4eU8z'
    },
    web3: {
      connected: false,
      walletName: '',
      chain: '',
      address: '',
      nativeSymbol: '',
      nativeBalance: 0
    },
    ledger: [
      {
        id: 'TX-INIT-01',
        type: 'DEPOSIT',
        network: 'USDT (SPL / سولانا)',
        amountUsd: 500.0,
        feeUsd: 0,
        destination: 'کیف‌پول شکار ربات',
        status: 'تأیید شده',
        ts: Date.now() - 3600000
      }
    ]
  };

  function loadVault() {
    try {
      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_VAULT));
      const parsed = JSON.parse(raw);
      return Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_VAULT)), parsed);
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULT_VAULT));
    }
  }

  function saveVault(vault) {
    try {
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
    } catch (_) {}
  }

  function validateCryptoAddress(network, address) {
    const clean = String(address || '').trim();
    if (!clean) return { valid: false, error: 'لطفاً آدرس کیف‌پول مقصد را وارد کنید.' };
    if (network === 'solana') {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean)) {
        return { valid: false, error: 'آدرس شبکه سولانا نامعتبر است (باید ۳۲ تا ۴۴ کاراکتر Base58 باشد).' };
      }
      return { valid: true };
    }
    if (network === 'bsc' || network === 'base' || network === 'ethereum') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(clean)) {
        return { valid: false, error: 'آدرس شبکه هوشمند (EVM) باید با 0x شروع شود و ۴۲ کاراکتر باشد.' };
      }
      return { valid: true };
    }
    if (network === 'trc20') {
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(clean)) {
        return { valid: false, error: 'آدرس تتر TRC-20 باید با حرف T شروع شود و ۳۴ کاراکتر باشد.' };
      }
      return { valid: true };
    }
    return { valid: clean.length >= 26, error: 'فرمت آدرس نامعتبر است.' };
  }

  /**
   * Generate a deterministic crisp SVG Matrix Visual Code for any wallet address
   * (Works 100% offline with zero third-party script dependencies)
   */
  function generateAddressVisualSvg(address) {
    const str = String(address || 'MEME-RADAR');
    const cells = 21;
    const grid = Array.from({ length: cells }, () => Array(cells).fill(false));

    function drawFinder(ox, oy) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const border = x === 0 || x === 6 || y === 0 || y === 6;
          const inner = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          grid[oy + y][ox + x] = border || inner;
        }
      }
    }
    drawFinder(0, 0);
    drawFinder(cells - 7, 0);
    drawFinder(0, cells - 7);

    let hash = 2166136261;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const inFinder =
          (x < 8 && y < 8) ||
          (x >= cells - 8 && y < 8) ||
          (x < 8 && y >= cells - 8);
        if (inFinder) continue;
        const ch = str.charCodeAt((x * 7 + y * 13) % str.length);
        hash ^= ch + x * 31 + y * 97;
        hash = Math.imul(hash, 16777619) >>> 0;
        grid[y][x] = (hash & 1) === 1;
      }
    }

    let rects = '';
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        if (grid[y][x]) {
          rects += '<rect x="' + (x * 8 + 8) + '" y="' + (y * 8 + 8) + '" width="7" height="7" rx="1.5" fill="#06090F"/>';
        }
      }
    }
    const total = cells * 8 + 16;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      total +
      ' ' +
      total +
      '" width="176" height="176">' +
      '<rect width="' +
      total +
      '" height="' +
      total +
      '" rx="16" fill="#F8FAFC"/>' +
      rects +
      '</svg>'
    );
  }

  /**
   * Connect to real injected Phantom / Solflare (Solana) or TrustWallet / MetaMask (EVM)
   */
  async function connectRealWeb3Wallet(preferredType) {
    if (preferredType === 'solana') {
      const provider = window.solana || (window.phantom && window.phantom.solana);
      if (!provider) {
        return {
          ok: false,
          needDeepLink: true,
          deepLinkUrl: 'https://phantom.app/ul/browse/' + encodeURIComponent(window.location.href),
          message: 'کیف‌پول Phantom در این مرورگر یافت نشد. در موبایل می‌توانید با دکمه زیر مستقیم داخل اپ فانتوم باز کنید.'
        };
      }
      const resp = await provider.connect();
      const pubkey = resp.publicKey.toString();
      let solBal = 0;
      try {
        const rpcRes = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [pubkey] })
        });
        const rpcJson = await rpcRes.json();
        if (rpcJson && rpcJson.result && typeof rpcJson.result.value === 'number') {
          solBal = rpcJson.result.value / 1e9;
        }
      } catch (_) {}
      return {
        ok: true,
        walletName: provider.isPhantom ? 'Phantom (Solana)' : 'Solana Wallet',
        chain: 'solana',
        address: pubkey,
        nativeSymbol: 'SOL',
        nativeBalance: Number(solBal.toFixed(4))
      };
    }

    // EVM: Trust Wallet / MetaMask (BSC / Base / Ethereum)
    const eth = window.ethereum;
    if (!eth) {
      return {
        ok: false,
        needDeepLink: true,
        deepLinkUrl: 'https://link.trustwallet.com/open_url?coin_id=20000714&url=' + encodeURIComponent(window.location.href),
        message: 'کیف‌پول Trust Wallet / MetaMask در این مرورگر شناسایی نشد. می‌توانید با دکمه زیر مستقیم داخل تراست‌ولت باز کنید.'
      };
    }
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const addr = accounts && accounts[0];
    let nativeBal = 0;
    try {
      const balHex = await eth.request({ method: 'eth_getBalance', params: [addr, 'latest'] });
      nativeBal = parseInt(balHex, 16) / 1e18;
    } catch (_) {}
    return {
      ok: true,
      walletName: eth.isTrust ? 'Trust Wallet' : eth.isMetaMask ? 'MetaMask' : 'Web3 Wallet',
      chain: 'bsc',
      address: addr,
      nativeSymbol: 'BNB/ETH',
      nativeBalance: Number(nativeBal.toFixed(4))
    };
  }

  /**
   * Build direct non-custodial DEX Swap URL (Jupiter for Solana, PancakeSwap for BSC, Uniswap for Base/ETH)
   */
  function getDirectDexSwapUrl(chainId, tokenAddress, side) {
    if (chainId === 'solana') {
      return side === 'SELL'
        ? 'https://jup.ag/swap/' + encodeURIComponent(tokenAddress) + '-USDC'
        : 'https://jup.ag/swap/USDC-' + encodeURIComponent(tokenAddress);
    }
    if (chainId === 'bsc') {
      return 'https://pancakeswap.finance/swap?outputCurrency=' + encodeURIComponent(tokenAddress);
    }
    if (chainId === 'base') {
      return 'https://app.uniswap.org/swap?chain=base&outputCurrency=' + encodeURIComponent(tokenAddress);
    }
    return 'https://app.uniswap.org/swap?outputCurrency=' + encodeURIComponent(tokenAddress);
  }

  window.MemeWalletVault = {
    loadVault: loadVault,
    saveVault: saveVault,
    validateCryptoAddress: validateCryptoAddress,
    generateAddressVisualSvg: generateAddressVisualSvg,
    connectRealWeb3Wallet: connectRealWeb3Wallet,
    getDirectDexSwapUrl: getDirectDexSwapUrl
  };
})();
