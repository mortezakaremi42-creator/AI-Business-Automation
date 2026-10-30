import { Bit24PlatformOrchestrator } from '../../core/platformRuntime';
import { clearEncryptedBrowserCredentials } from './browserBit24Vault';

const SETTINGS_STORAGE_KEY = 'bit24_ai_gold_settings_v2';

export class StandaloneAndroidRuntime {
  public readonly orchestrator: Bit24PlatformOrchestrator;

  constructor() {
    // Stage 8 Security Policy: Never store or retain real API keys inside browser localStorage!
    try {
      clearEncryptedBrowserCredentials();
    } catch {
      // ignore if storage unavailable
    }

    let savedSettings: any = undefined;
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) savedSettings = JSON.parse(raw);
    } catch {
      savedSettings = undefined;
    }

    this.orchestrator = new Bit24PlatformOrchestrator(undefined, {
      initialSettings: savedSettings,
      serverBackendConnected: false,
      adminAuthProtected: false,
    });
  }

  public persistSettings(): void {
    try {
      const snap = this.orchestrator.getSnapshot(navigator.onLine);
      const safeCopy = {
        ...snap.settings,
        liveTradingConfirmedThisSession: false,
        environmentMode:
          snap.settings.environmentMode === 'LIVE' ? 'PAPER' : snap.settings.environmentMode,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(safeCopy));
    } catch {
      // ignore storage quota errors
    }
  }

  public async refreshPublicReferenceFeeds(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const symbols = encodeURIComponent(
        JSON.stringify([
          'PAXGUSDT',
          'BTCUSDT',
          'ETHUSDT',
          'SOLUSDT',
          'TONUSDT',
          'XRPUSDT',
          'DOGEUSDT',
          'PEPEUSDT',
          'SHIBUSDT',
          'WIFUSDT',
          'BONKUSDT',
          'FLOKIUSDT',
          'NOTUSDT',
        ])
      );
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return;
      const arr = await res.json();
      if (!Array.isArray(arr)) return;

      const map: Record<string, { usd: number; change24hPct: number }> = {};
      let paxgUsd = 0;
      let paxgChange = 0;

      for (const item of arr) {
        const sym = String(item.symbol || '').replace('USDT', '');
        const last = Number(item.lastPrice || 0);
        const chg = Number(item.priceChangePercent || 0);
        if (last > 0) {
          map[sym] = { usd: last, change24hPct: chg };
          if (sym === 'PAXG') {
            paxgUsd = last;
            paxgChange = chg;
            map['XAUT'] = { usd: Number((last * 0.9988).toFixed(2)), change24hPct: chg * 0.97 };
          }
        }
      }

      this.orchestrator.updateGlobalReferencePrices({
        globalGoldUsd: paxgUsd > 800 ? Number((paxgUsd * 0.9992).toFixed(2)) : undefined,
        globalGoldChange24hPct: paxgUsd > 800 ? paxgChange : undefined,
        spotPricesUsd: map,
      });
    } catch {
      // Fall back to internal simulator ticks when offline
    }
  }
}
