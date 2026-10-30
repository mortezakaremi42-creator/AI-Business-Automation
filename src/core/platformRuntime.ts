import {
  ActivityLogItem,
  AntiRugDashboardSummary,
  ApiAndNetworkHealth,
  BacktestSummary,
  Bit24MarketInfo,
  BlockedBuyIncident,
  BotRuntimeStatus,
  CapitalShieldSettings,
  CircuitBreakerState,
  ClosedTradeRecord,
  EquityChartPoint,
  ExchangeErrorCategory,
  IncompleteFeatureNotice,
  ManagedPosition,
  ModuleId,
  ModulePerformanceReport,
  OhlcvCandle,
  OrderBookSnapshot,
  PeriodPerformanceBreakdown,
  PlatformSettings,
  PlatformSnapshot,
  RejectedOrderAuditItem,
  SmartSignal,
  TokenSecurityReport,
  TradingEnvironmentMode,
  VerifiedWalletBalance,
} from '../shared/types.js';
import {
  buildTelemetryFromMarket,
  createDefaultCapitalShieldSettings,
  createPhantomDexSecurityWatchlist,
  evaluateTokenSecurity,
} from './antiRugEngine.js';
import { runHistoricalBacktest } from './backtester.js';
import { analyzeGoldMarket, evaluateGoldEarlyExit } from './goldAnalyzer.js';
import { analyzeLeverageMarket } from './leverageAnalyzer.js';
import {
  createInitialBit24Markets,
  generateRealisticCandles,
  generateRealisticOrderBook,
  OFFICIAL_BIT24_CAPABILITIES,
  smartRoundMarketPrice,
} from './marketSimulator.js';
import { analyzeMemePumpMarket, evaluateMemeEarlyExit } from './memeAnalyzer.js';
import {
  calculateSafePositionSize,
  computeTotalOpenPositionsRiskIrt,
  createDefaultPlatformSettings,
  isDailyLossLimitReached,
  stepPositionLifecycle,
} from './riskManager.js';
import { analyzeSpotCryptoMarket, evaluateSpotEarlyExit } from './spotCryptoAnalyzer.js';

export const INCOMPLETE_FEATURES_REGISTRY: IncompleteFeatureNotice[] = [
  {
    id: 'global-xauusd-broker',
    titleFa: 'اتصال مستقیم معاملاتی به کارگزار جهانی فارکس (XAU/USD)',
    badgeFa: 'تکمیل نشده',
    detailFa:
      'نرخ انس جهانی (XAU/USD) صرفاً به‌عنوان مرجع تحلیلی مقایسه حباب توکن‌های طلای بیت‌۲۴ دریافت می‌شود؛ اجرای سفارش واقعی طلا منحصراً روی PAXG و XAUT در اسپات بیت‌۲۴ انجام می‌گیرد و اتصال کارگزار فارکس/متاتریدر در این نسخه پیاده‌سازی نشده است.',
  },
  {
    id: 'native-apk-binary',
    titleFa: 'فایل باینری امضاشده APK اندروید در محیط سندباکس',
    badgeFa: 'تکمیل نشده',
    detailFa:
      'وب‌اپلیکیشن پیش‌رونده (PWA) قابل نصب مستقیم روی اندروید کامل و فعال است؛ کامپایل فایل باینری .apk نیازمند Android SDK / Gradle محلی است که راهنمای دقیق ساخت آن با Bubblewrap/Capacitor در مستندات درج شده است.',
  },
  {
    id: 'futures-perpetual-v1',
    titleFa: 'معاملات فیوچرز دائمی و اهرم بالا در نسخه اول',
    badgeFa: 'تکمیل نشده',
    detailFa:
      'طبق سیاست مدیریت ریسک مرحله پنجم، معاملات فیوچرز در صرافی بیت‌۲۴ وجود ندارد و ربات اهرمی مارجین نیز در نسخه اول به‌طور پیش‌فرض غیرفعال (خاموش) نگه داشته شده است.',
  },
];

export interface LiveExchangeAdapter {
  isConfigured(): boolean;
  getMaskedKey(): string | null;
  getRateLimitUsed(): number;
  redactText?(text: string): string;
  fetchLiveMarkets(): Promise<{
    ok: boolean;
    latencyMs: number;
    errorCategory?: ExchangeErrorCategory;
    markets: Bit24MarketInfo[];
    errorFa?: string;
  }>;
  fetchVerifiedWallet?(): Promise<VerifiedWalletBalance>;
  fetchOhlcv(
    baseSymbol: string,
    quoteSymbol: 'IRT' | 'USDT'
  ): Promise<OhlcvCandle[] | null>;
  fetchOrderBook(
    baseSymbol: string,
    quoteSymbol: 'IRT' | 'USDT',
    targetQuoteSize: number
  ): Promise<OrderBookSnapshot | null>;
  verifyOrderStatus?(
    orderId: number,
    baseSymbol: string,
    quoteSymbol: 'IRT' | 'USDT'
  ): Promise<{ verified: boolean; filledPercent: number }>;
  submitLiveOrder(params: {
    module: ModuleId;
    baseSymbol: string;
    quoteSymbol: 'IRT' | 'USDT';
    side: 'LONG' | 'SHORT';
    amount: number;
    price: number;
    leverage: number;
    takeProfit: number;
    stopLoss: number;
  }): Promise<{
    ok: boolean;
    orderId?: number;
    errorCategory?: ExchangeErrorCategory;
    errorFa?: string;
  }>;
  cancelAllOpenOrders(): Promise<{ ok: boolean; errorFa?: string }>;
  liquidateSpotAsset?(params: {
    baseSymbol: string;
    quoteSymbol: 'IRT' | 'USDT';
    amount: number;
  }): Promise<{ ok: boolean; errorFa?: string }>;
}

const ORDER_IDEMPOTENCY_COOLDOWN_MS = 45_000;

export class Bit24PlatformOrchestrator {
  private settings: PlatformSettings;
  private markets: Bit24MarketInfo[];
  private candlesMap = new Map<string, OhlcvCandle[]>();
  private orderBooksMap = new Map<string, OrderBookSnapshot>();
  private inFlightOrders = new Set<string>();
  private lastOrderAttemptAt = new Map<string, number>();
  private liveDepthRotationIdx = 0;

  private signals: SmartSignal[] = [];
  private openPositions: ManagedPosition[] = [];
  private tradeHistory: ClosedTradeRecord[] = [];
  private rejectedAudit: RejectedOrderAuditItem[] = [];
  private performanceCurve: EquityChartPoint[] = [];
  private logs: ActivityLogItem[] = [];

  // ==================== ANTI-RUG & SMART SECURITY / CAPITAL SHIELD ====================
  private securityServiceOnline = true;
  private simulatedFeedStale = false;
  private lastMarketFeedTimestampMs = Date.now();
  private liveTradingLockedUntilApproval = true;
  private tokenSecurityReports: TokenSecurityReport[] = [];
  private customInspectedReports: TokenSecurityReport[] = [];
  private blockedBuysLog: BlockedBuyIncident[] = [];
  private duplicateBlocksCount = 0;
  private staleOrOfflineBlocksCount = 0;
  private systemErrorHaltsCount = 0;

  private emergencyStopped = false;
  private paperReadinessPassed = true;
  private verifiedWallet: VerifiedWalletBalance = {
    confirmedByOfficialApi: false,
    totalIrt: null,
    totalUsdt: null,
    spotFreeIrt: null,
    spotFreeUsdt: null,
    assets: [],
    fetchedAt: null,
    noteFa:
      'کلید API بیت‌۲۴ متصل نیست؛ موجودی واقعی حساب نمایش داده نمی‌شود و ارقام فعلی مربوط به بودجه آزمایشی (Paper) است.',
  };
  private circuitBreaker: CircuitBreakerState = {
    tripped: false,
    reasonFa: null,
    consecutiveApiErrors: 0,
    lastAnomalyAt: null,
  };

  private globalGoldUsd = 2948.4;
  private globalGoldChange24hPct = 1.16;
  private usdtIrtRate = 88_500;
  private serverBackendConnected: boolean;
  private adminAuthProtected: boolean;
  private bit24ConnectionState: ApiAndNetworkHealth['bit24ConnectionState'] = 'KEY_NOT_SET';
  private lastErrorCategory: ExchangeErrorCategory = 'NONE';
  private bit24LatencyMs: number | null = null;
  private lastSyncAt: number | null = null;
  private statusMessageFa =
    'در حالت امن آزمایشی (DEMO / Paper Trading) آماده به کار است — ماژول ANTI-RUG & SMART SECURITY فعال و معاملات واقعی قفل است.';

  constructor(
    private adapter?: LiveExchangeAdapter,
    options?: {
      initialSettings?: Partial<PlatformSettings>;
      serverBackendConnected?: boolean;
      adminAuthProtected?: boolean;
      allowLiveTradingForTest?: boolean;
    }
  ) {
    const defaults = createDefaultPlatformSettings();
    this.liveTradingLockedUntilApproval = !(options?.allowLiveTradingForTest ?? false);
    this.settings = {
      ...defaults,
      ...options?.initialSettings,
      antiRugConfig: {
        ...createDefaultCapitalShieldSettings(),
        ...options?.initialSettings?.antiRugConfig,
        blockOnMissingDataOrApiDown: true,
      },
      liveTradingConfirmedThisSession: false,
      pauseNewTrades: options?.initialSettings?.pauseNewTrades ?? false,
      modules: {
        DIGITAL_GOLD: {
          ...defaults.modules.DIGITAL_GOLD,
          ...options?.initialSettings?.modules?.DIGITAL_GOLD,
          risk: {
            ...defaults.modules.DIGITAL_GOLD.risk,
            ...options?.initialSettings?.modules?.DIGITAL_GOLD?.risk,
            allowLossAveragingDca: false,
          },
        },
        SPOT_CRYPTO: {
          ...defaults.modules.SPOT_CRYPTO,
          ...options?.initialSettings?.modules?.SPOT_CRYPTO,
          risk: {
            ...defaults.modules.SPOT_CRYPTO.risk,
            ...options?.initialSettings?.modules?.SPOT_CRYPTO?.risk,
            allowLossAveragingDca: false,
          },
        },
        MEME_HUNTER: {
          ...defaults.modules.MEME_HUNTER,
          ...options?.initialSettings?.modules?.MEME_HUNTER,
          risk: {
            ...defaults.modules.MEME_HUNTER.risk,
            ...options?.initialSettings?.modules?.MEME_HUNTER?.risk,
            allowLossAveragingDca: false,
          },
        },
        LEVERAGE_MARGIN: {
          ...defaults.modules.LEVERAGE_MARGIN,
          ...options?.initialSettings?.modules?.LEVERAGE_MARGIN,
          enabled: options?.initialSettings?.modules?.LEVERAGE_MARGIN?.enabled ?? false,
          risk: {
            ...defaults.modules.LEVERAGE_MARGIN.risk,
            ...options?.initialSettings?.modules?.LEVERAGE_MARGIN?.risk,
            allowLossAveragingDca: false,
          },
        },
      },
    };

    if (this.settings.environmentMode === 'LIVE') {
      this.settings.environmentMode = 'PAPER';
    }

    this.serverBackendConnected = options?.serverBackendConnected ?? true;
    this.adminAuthProtected = options?.adminAuthProtected ?? false;
    this.markets = createInitialBit24Markets(this.usdtIrtRate, this.globalGoldUsd).map((m) => ({
      ...m,
      dataSource: 'SIMULATED_DEMO',
    }));

    for (const m of this.markets) {
      this.candlesMap.set(m.marketName, generateRealisticCandles(m, 140));
    }

    this.recordPerformancePoint();

    this.addLog(
      'INFO',
      'SECURITY',
      'Phantom Dip Hunter Pro + ماژول ANTI-RUG & SMART SECURITY راه‌اندازی شد: حالت DEMO / Paper Trading فعال، معاملات واقعی قفل، هیچ کلید خصوصی درخواست نمی‌شود.'
    );

    this.recomputeAllSignals();
    // Initial Paper-Trading security interception pass on DEX trap watchlist
    this.runInitialDexTrapInterceptionAudit();
  }

  public addLog(
    level: ActivityLogItem['level'],
    module: ActivityLogItem['module'],
    rawMessageFa: string
  ): void {
    const safeMsg = this.adapter?.redactText
      ? this.adapter.redactText(rawMessageFa)
      : rawMessageFa.replace(/[A-Za-z0-9_-]{36,}/g, '[REDACTED_TOKEN]');

    this.logs.unshift({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      level,
      module,
      messageFa: safeMsg,
    });
    if (this.logs.length > 140) {
      this.logs.length = 140;
    }
  }

  private recordRejectedAudit(module: ModuleId, marketName: string, reasonFa: string): void {
    const recentSame = this.rejectedAudit.find(
      (r) => r.marketName === marketName && Date.now() - r.timestamp < 30_000
    );
    if (recentSame) return;

    this.rejectedAudit.unshift({
      id: `rej-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      module,
      marketName,
      reasonFa,
    });
    if (this.rejectedAudit.length > 60) {
      this.rejectedAudit.length = 60;
    }
  }

  private recordPerformancePoint(): void {
    const totalAllocated = this.getTotalAllocatedIrt();
    const goldRep = this.buildModuleReport('DIGITAL_GOLD', 'طلا', false);
    const spotRep = this.buildModuleReport('SPOT_CRYPTO', 'اسپات', false);
    const memeRep = this.buildModuleReport('MEME_HUNTER', 'میم‌کوین', false);
    const levRep = this.buildModuleReport('LEVERAGE_MARGIN', 'اهرم', false);

    const goldPnl = goldRep.totalNetPnlIrt;
    const cryptoPnl =
      spotRep.totalNetPnlIrt + memeRep.totalNetPnlIrt + levRep.totalNetPnlIrt;
    const equityIrt = totalAllocated + goldPnl + cryptoPnl;

    const now = new Date();
    const labelFa = now.toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    this.performanceCurve.push({
      timestamp: Date.now(),
      labelFa,
      equityIrt: Math.round(equityIrt),
      goldPnlIrt: Math.round(goldPnl),
      cryptoPnlIrt: Math.round(cryptoPnl),
    });

    if (this.performanceCurve.length > 40) {
      this.performanceCurve.shift();
    }
  }

  public updateGlobalReferencePrices(params: {
    globalGoldUsd?: number;
    globalGoldChange24hPct?: number;
    usdtIrtRate?: number;
    spotPricesUsd?: Record<string, { usd: number; change24hPct: number }>;
  }): void {
    if (params.globalGoldUsd && params.globalGoldUsd > 800) {
      this.globalGoldUsd = params.globalGoldUsd;
    }
    if (typeof params.globalGoldChange24hPct === 'number') {
      this.globalGoldChange24hPct = params.globalGoldChange24hPct;
    }
    if (params.usdtIrtRate && params.usdtIrtRate > 10_000) {
      this.usdtIrtRate = params.usdtIrtRate;
      this.settings.usdtIrtReference = params.usdtIrtRate;
    }

    if (this.bit24ConnectionState !== 'CONNECTED_VERIFIED') {
      this.lastMarketFeedTimestampMs = Date.now();
      this.markets = this.markets.map((m) => {
        const refSpot = params.spotPricesUsd?.[m.baseSymbol];
        let nextPrice = m.eachPrice;
        let nextChange = m.change24hPct;
        let dataSource = m.dataSource || 'SIMULATED_DEMO';

        if (refSpot && refSpot.usd > 0) {
          nextPrice = smartRoundMarketPrice(
            m.quoteSymbol === 'IRT' ? refSpot.usd * this.usdtIrtRate : refSpot.usd,
            m.quoteSymbol
          );
          nextChange = Number(refSpot.change24hPct.toFixed(2));
          dataSource = 'PUBLIC_REFERENCE_FEED';
        } else {
          const microDrift =
            (Math.random() - 0.482) *
            (m.category === 'GOLD' ? 0.0024 : m.category === 'MEME' ? 0.0068 : 0.0042);
          nextPrice = smartRoundMarketPrice(m.eachPrice * (1 + microDrift), m.quoteSymbol);
          nextChange = Number((m.change24hPct + microDrift * 45).toFixed(2));
        }

        // Stage 5: Abnormal price jump detection (>28% single tick anomaly)
        if (m.eachPrice > 0) {
          const singleTickJump = Math.abs(nextPrice - m.eachPrice) / m.eachPrice;
          if (singleTickJump > 0.28 || nextPrice <= 0) {
            this.tripCircuitBreaker(
              `داده قیمتی غیرعادی در بازار ${m.marketName} شناسایی شد؛ توقف خودکار معاملات جدید فعال گردید.`
            );
            return m;
          }
        }

        const candles = this.candlesMap.get(m.marketName);
        if (candles && candles.length > 0) {
          const last = { ...candles[candles.length - 1] };
          last.c = nextPrice;
          if (nextPrice > last.h) last.h = nextPrice;
          if (nextPrice < last.l) last.l = nextPrice;
          candles[candles.length - 1] = last;
        }

        return {
          ...m,
          eachPrice: nextPrice,
          change24hPct: nextChange,
          dataSource,
        };
      });
    }
  }

  private tripCircuitBreaker(reasonFa: string): void {
    if (!this.circuitBreaker.tripped) {
      this.circuitBreaker = {
        tripped: true,
        reasonFa,
        consecutiveApiErrors: this.circuitBreaker.consecutiveApiErrors,
        lastAnomalyAt: Date.now(),
      };
      this.addLog('ERROR', 'SECURITY', `مدارقطع‌کن خودکار ریسک (Circuit Breaker): ${reasonFa}`);
    }
  }

  public resetCircuitBreaker(): void {
    this.circuitBreaker = {
      tripped: false,
      reasonFa: null,
      consecutiveApiErrors: 0,
      lastAnomalyAt: null,
    };
    this.addLog('INFO', 'SECURITY', 'قفل مدارقطع‌کن خودکار پس از بررسی کاربر بازنشانی شد.');
  }

  /**
   * Pulls live Bit24 OHLCV & OrderBook in small batches (respecting 250 req/min limit)
   * when officially connected to Bit24 CAPI v2.
   */
  private async refreshLiveDepthAndCandlesBatch(): Promise<void> {
    if (!this.adapter || this.bit24ConnectionState !== 'CONNECTED_VERIFIED') return;
    if (this.markets.length === 0) return;

    const batchSize = Math.min(2, this.markets.length);
    for (let k = 0; k < batchSize; k++) {
      const idx = (this.liveDepthRotationIdx + k) % this.markets.length;
      const mkt = this.markets[idx];
      try {
        const [liveCandles, liveBook] = await Promise.all([
          this.adapter.fetchOhlcv(mkt.baseSymbol, mkt.quoteSymbol),
          this.adapter.fetchOrderBook(
            mkt.baseSymbol,
            mkt.quoteSymbol,
            mkt.quoteSymbol === 'IRT' ? 12_500_000 : 150
          ),
        ]);
        if (liveCandles && liveCandles.length >= 30) {
          this.candlesMap.set(mkt.marketName, liveCandles);
        }
        if (liveBook && liveBook.bestAsk > 0) {
          this.orderBooksMap.set(mkt.marketName, liveBook);
        }
      } catch {
        // Resilient per-market fetch
      }
    }
    this.liveDepthRotationIdx = (this.liveDepthRotationIdx + batchSize) % this.markets.length;
  }

  public async tickCycle(): Promise<PlatformSnapshot> {
    // 1. Sync from official Bit24 CAPI v2 if API key is configured
    if (this.adapter?.isConfigured()) {
      const res = await this.adapter.fetchLiveMarkets();
      this.bit24LatencyMs = res.latencyMs;

      if (res.ok && res.markets.length > 0) {
        this.bit24ConnectionState = 'CONNECTED_VERIFIED';
        this.lastErrorCategory = 'NONE';
        this.circuitBreaker.consecutiveApiErrors = 0;
        this.lastSyncAt = Date.now();
        this.lastMarketFeedTimestampMs = Date.now();
        this.statusMessageFa = `متصل به API رسمی بیت‌۲۴ (${res.markets.length} بازار فعال | پینگ ${res.latencyMs}ms)`;

        const usdtMarket = res.markets.find((m) => m.marketName === 'USDT/IRT');
        if (usdtMarket && usdtMarket.eachPrice > 10_000) {
          this.usdtIrtRate = usdtMarket.eachPrice;
        }
        const filteredMarkets = res.markets.filter((m) => m.baseSymbol !== 'USDT');
        if (filteredMarkets.length > 0) {
          // Anomaly check before accepting new live prices
          let anomalyDetected = false;
          for (const nextMkt of filteredMarkets) {
            const prevMkt = this.markets.find((p) => p.marketName === nextMkt.marketName);
            if (prevMkt && prevMkt.eachPrice > 0 && nextMkt.eachPrice > 0) {
              const jump = Math.abs(nextMkt.eachPrice - prevMkt.eachPrice) / prevMkt.eachPrice;
              if (jump > 0.35) {
                anomalyDetected = true;
                this.tripCircuitBreaker(
                  `جهش غیرعادی داده قیمت (${(jump * 100).toFixed(1)}٪) در ${nextMkt.marketName}`
                );
              }
            }
          }
          if (!anomalyDetected) {
            this.markets = filteredMarkets;
          }
        }

        // Fetch verified real wallet balance & live orderbook/OHLCV batch
        if (this.adapter.fetchVerifiedWallet) {
          this.verifiedWallet = await this.adapter.fetchVerifiedWallet();
        }
        await this.refreshLiveDepthAndCandlesBatch();
      } else {
        this.lastErrorCategory = res.errorCategory || 'NETWORK_TIMEOUT_OR_OFFLINE';
        this.circuitBreaker.consecutiveApiErrors += 1;
        this.bit24ConnectionState =
          this.lastErrorCategory === 'AUTH_OR_IP_ERROR' ? 'AUTH_ERROR' : 'UNREACHABLE';
        this.statusMessageFa =
          res.errorFa ||
          'عدم پاسخ سرور بیت‌۲۴؛ سفارش واقعی جدیدی ثبت نمی‌شود و حالت ایمن تحلیل فعال است.';

        if (
          this.circuitBreaker.consecutiveApiErrors >= 3 &&
          this.settings.environmentMode === 'LIVE'
        ) {
          this.tripCircuitBreaker(
            `تکرار خطای ارتباطی با API بیت‌۲۴ (${this.circuitBreaker.consecutiveApiErrors} خطای متوالی)؛ معاملات جدید به‌طور خودکار متوقف شد.`
          );
        }
      }
    } else {
      this.bit24ConnectionState = 'KEY_NOT_SET';
      this.lastErrorCategory = 'NONE';
      this.verifiedWallet = {
        confirmedByOfficialApi: false,
        totalIrt: null,
        totalUsdt: null,
        spotFreeIrt: null,
        spotFreeUsdt: null,
        assets: [],
        fetchedAt: null,
        noteFa:
          'کلید API بیت‌۲۴ متصل نیست؛ موجودی واقعی حساب نمایش داده نمی‌شود و ارقام فعلی مربوط به بودجه آزمایشی (Paper) است.',
      };
      this.updateGlobalReferencePrices({});
    }

    try {
      // 2. Step open positions (TP1, TP2, Trailing Stop, SL, and Early Exit)
      await this.evaluateOpenPositions();

      // 3. Recompute signals across Digital Gold, Meme Hunter, Spot Crypto, and Leverage
      this.recomputeAllSignals();

      // 4. Execute confirmed signals ONLY if allowed by all safety & pause gates
      if (
        !this.emergencyStopped &&
        !this.settings.pauseNewTrades &&
        !this.circuitBreaker.tripped &&
        this.settings.environmentMode !== 'ANALYSIS_ONLY'
      ) {
        await this.executeEligibleSignals();
      }
    } catch (sysErr: any) {
      if (this.getAntiRugSettings().autoEmergencyStopOnSystemError) {
        this.systemErrorHaltsCount += 1;
        await this.emergencyStopAll(false);
        this.addLog(
          'ERROR',
          'SECURITY',
          `محافظ سرمایه: خطای سیستمی غیرمنتظره رخ داد (${sysErr?.message || 'System Fault'}) — توقف اضطراری خودکار فعال شد.`
        );
      }
    }

    this.recordPerformancePoint();
    return this.getSnapshot();
  }

  private getOrderBookForSignal(
    market: Bit24MarketInfo,
    targetOrderQuoteSize: number
  ): OrderBookSnapshot {
    const liveBook = this.orderBooksMap.get(market.marketName);
    if (this.bit24ConnectionState === 'CONNECTED_VERIFIED' && liveBook && liveBook.bestAsk > 0) {
      return liveBook;
    }
    return generateRealisticOrderBook(market, targetOrderQuoteSize);
  }

  private getEffectiveFeedTimestampMs(): number {
    if (this.simulatedFeedStale) {
      return Date.now() - 360_000; // 6 minutes old -> triggers stale-data Capital Shield block
    }
    return this.lastMarketFeedTimestampMs;
  }

  private getAntiRugSettings(): CapitalShieldSettings {
    return this.settings.antiRugConfig || createDefaultCapitalShieldSettings();
  }

  private recordBlockedBuyIncident(params: {
    symbol: string;
    marketName: string;
    module: ModuleId | 'DEX_SCANNER';
    securityScore: number;
    verdict: TokenSecurityReport['verdict'];
    primaryReasonFa: string;
    allReasonsFa: string[];
  }): void {
    const duplicateRecent = this.blockedBuysLog.find(
      (b) =>
        b.marketName === params.marketName &&
        b.primaryReasonFa === params.primaryReasonFa &&
        Date.now() - b.timestamp < 20_000
    );
    if (duplicateRecent) return;

    this.blockedBuysLog.unshift({
      id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      symbol: params.symbol,
      marketName: params.marketName,
      module: params.module,
      securityScore: params.securityScore,
      verdict: params.verdict,
      primaryReasonFa: params.primaryReasonFa,
      allReasonsFa: params.allReasonsFa,
    });
    if (this.blockedBuysLog.length > 80) {
      this.blockedBuysLog.length = 80;
    }

    const auditModule: ModuleId =
      params.module === 'DEX_SCANNER' ? 'MEME_HUNTER' : params.module;
    this.recordRejectedAudit(
      auditModule,
      params.marketName,
      `[محافظ سرمایه Anti-Rug | امتیاز ${params.securityScore}/100] ${params.primaryReasonFa}`
    );
  }

  private runInitialDexTrapInterceptionAudit(): void {
    const trapSymbols = ['RUGDOG', 'HONEYCAT', 'FAKEPUMP', 'UNKNOWNX'];
    for (const sym of trapSymbols) {
      const rep = this.tokenSecurityReports.find((r) => r.symbol === sym);
      if (rep && !rep.buyAllowedInDemo) {
        const primary =
          rep.warningReasonsFa[0] || rep.verdictLabelFa || 'رد شده توسط محافظ سرمایه';
        this.recordBlockedBuyIncident({
          symbol: rep.symbol,
          marketName: rep.marketName,
          module: 'DEX_SCANNER',
          securityScore: rep.securityScore,
          verdict: rep.verdict,
          primaryReasonFa: primary,
          allReasonsFa: rep.warningReasonsFa,
        });
      }
    }
  }

  /**
   * Central Capital Shield gate executed BEFORE any Paper or Live buy order.
   */
  public checkCapitalShieldBeforeBuy(params: {
    module: ModuleId | 'DEX_SCANNER';
    marketName: string;
    baseSymbol: string;
    allowManualWarningReview?: boolean;
  }): { allowed: boolean; reasonFa: string; report: TokenSecurityReport } {
    const cfg = this.getAntiRugSettings();
    const sym = params.baseSymbol.toUpperCase();
    const existingReport =
      this.tokenSecurityReports.find(
        (r) => r.marketName === params.marketName || r.symbol.toUpperCase() === sym
      ) ||
      this.customInspectedReports.find((r) => r.symbol.toUpperCase() === sym);

    // Fail-closed fallback report if token has never been security-inspected
    const fallbackReport: TokenSecurityReport =
      existingReport ||
      evaluateTokenSecurity(
        {
          symbol: sym,
          marketName: params.marketName,
          displayNameFa: sym,
          network: 'SOLANA_SPL',
          contractAddress: `UNVERIFIED:${sym}`,
          dataOrigin: 'FAIL_CLOSED_OFFLINE',
          apisConsulted: [],
          securityApiAvailable: this.securityServiceOnline,
          dataComplete: false,
          dataTimestampMs: this.getEffectiveFeedTimestampMs(),
          poolLiquidityUsd: null,
          orderBookDepthIrt: null,
          liquidityChange1hPct: null,
          canSell: null,
          isHoneypot: false,
          buyTaxPct: null,
          sellTaxPct: null,
          hasSuspiciousSellRestriction: false,
          mintAuthorityActive: false,
          freezeAuthorityActive: false,
          ownerDangerousPrivileges: false,
          isUnverifiedOrSuspiciousContract: true,
          tokenAgeHours: null,
          topHoldersConcentrationPct: null,
          priceChange1hPct: 0,
          priceChange24hPct: 0,
          volumeRatio: 0,
          buyToSellRatio: null,
          washTradingSuspected: false,
          priceManipulationRisk: false,
        },
        cfg
      );

    if (!cfg.enabled) {
      return { allowed: true, reasonFa: 'غیرفعال', report: fallbackReport };
    }

    // 1. Security API Offline or Stale Market Data -> Block!
    if (!this.securityServiceOnline || !fallbackReport.securityApiAvailable) {
      this.staleOrOfflineBlocksCount += 1;
      const reasonFa =
        'سرویس امنیتی یا API در دسترس نیست؛ به‌جای تأیید امنیت، خرید توسط محافظ سرمایه مسدود شد.';
      this.recordBlockedBuyIncident({
        symbol: sym,
        marketName: params.marketName,
        module: params.module,
        securityScore: 0,
        verdict: 'BLOCKED_INSUFFICIENT_DATA',
        primaryReasonFa: reasonFa,
        allReasonsFa: [reasonFa, ...fallbackReport.warningReasonsFa],
      });
      return { allowed: false, reasonFa, report: fallbackReport };
    }

    if (!fallbackReport.isDataFresh || this.simulatedFeedStale) {
      this.staleOrOfflineBlocksCount += 1;
      const reasonFa =
        'اطلاعات بازار و نقدینگی قدیمی (Stale) است؛ محافظ سرمایه خرید را متوقف کرد.';
      this.recordBlockedBuyIncident({
        symbol: sym,
        marketName: params.marketName,
        module: params.module,
        securityScore: fallbackReport.securityScore,
        verdict: 'BLOCKED_INSUFFICIENT_DATA',
        primaryReasonFa: reasonFa,
        allReasonsFa: [reasonFa, ...fallbackReport.warningReasonsFa],
      });
      return { allowed: false, reasonFa, report: fallbackReport };
    }

    // 2. Duplicate Token Purchase Guard across ALL pairs/modules
    if (
      cfg.preventDuplicateTokenPurchase &&
      this.openPositions.some((p) => p.baseSymbol.toUpperCase() === sym)
    ) {
      this.duplicateBlocksCount += 1;
      const reasonFa = `جلوگیری از خرید تکراری توکن ${sym}: هم‌اکنون یک موقعیت باز روی همین توکن فعال است.`;
      this.recordBlockedBuyIncident({
        symbol: sym,
        marketName: params.marketName,
        module: params.module,
        securityScore: fallbackReport.securityScore,
        verdict: fallbackReport.verdict,
        primaryReasonFa: reasonFa,
        allReasonsFa: [reasonFa],
      });
      return { allowed: false, reasonFa, report: fallbackReport };
    }

    // 3. Insufficient / Invalid Security Data -> Forbidden!
    if (!fallbackReport.dataComplete || !fallbackReport.liquidity.isDataValid) {
      const reasonFa =
        fallbackReport.warningReasonsFa[0] ||
        'اطلاعات امنیتی یا نقدینگی توکن ناقص است؛ خرید ممنوع می‌باشد.';
      this.recordBlockedBuyIncident({
        symbol: sym,
        marketName: params.marketName,
        module: params.module,
        securityScore: fallbackReport.securityScore,
        verdict: 'BLOCKED_INSUFFICIENT_DATA',
        primaryReasonFa: reasonFa,
        allReasonsFa: fallbackReport.warningReasonsFa,
      });
      return { allowed: false, reasonFa, report: fallbackReport };
    }

    // 4. Score < 60 -> Strictly Forbidden!
    if (fallbackReport.securityScore < cfg.blockBelowScore) {
      const reasonFa = `امتیاز امنیت ${fallbackReport.securityScore}/100 (زیر ${cfg.blockBelowScore} — ممنوعیت خرید): ${
        fallbackReport.warningReasonsFa[0] || 'توکن پرخطر شناسایی شد.'
      }`;
      this.recordBlockedBuyIncident({
        symbol: sym,
        marketName: params.marketName,
        module: params.module,
        securityScore: fallbackReport.securityScore,
        verdict: 'BLOCKED',
        primaryReasonFa: reasonFa,
        allReasonsFa: fallbackReport.warningReasonsFa,
      });
      return { allowed: false, reasonFa, report: fallbackReport };
    }

    // 5. Score 60..79 -> Warning & Needs Review (Blocked in unattended auto-buy)
    if (
      fallbackReport.securityScore < cfg.minScoreForAutoDemoBuy &&
      !params.allowManualWarningReview
    ) {
      const reasonFa = `امتیاز امنیت ${fallbackReport.securityScore}/100 (بازه ۶۰ تا ۷۹ — هشدار و نیاز به بررسی): ${
        fallbackReport.warningReasonsFa[0] || 'ورود خودکار بدون بازبینی مجاز نیست.'
      }`;
      this.recordBlockedBuyIncident({
        symbol: sym,
        marketName: params.marketName,
        module: params.module,
        securityScore: fallbackReport.securityScore,
        verdict: 'WARNING_REVIEW',
        primaryReasonFa: reasonFa,
        allReasonsFa: fallbackReport.warningReasonsFa,
      });
      return { allowed: false, reasonFa, report: fallbackReport };
    }

    return {
      allowed: true,
      reasonFa: `تایید امنیت دمو (${fallbackReport.securityScore}/100)`,
      report: fallbackReport,
    };
  }

  private recomputeAllSignals(): void {
    const nextSignals: SmartSignal[] = [];
    const cfg = this.getAntiRugSettings();
    const feedTs = this.getEffectiveFeedTimestampMs();
    const uniqueTokenReports = new Map<string, TokenSecurityReport>();

    for (const market of this.markets) {
      const candles =
        this.candlesMap.get(market.marketName) || generateRealisticCandles(market, 140);
      this.candlesMap.set(market.marketName, candles);

      let primarySig: SmartSignal;
      let primaryBook: OrderBookSnapshot;
      let primaryMod: ModuleId;

      if (market.category === 'GOLD') {
        primaryMod = 'DIGITAL_GOLD';
        primaryBook = this.getOrderBookForSignal(
          market,
          this.settings.modules.DIGITAL_GOLD.risk.allocatedCapitalIrt * 0.25
        );
        primarySig = analyzeGoldMarket({
          market,
          candles,
          orderBook: primaryBook,
          riskSettings: this.settings.modules.DIGITAL_GOLD.risk,
          feePctPerSide: this.settings.bit24VipFeePct,
          maxAllowedSpreadPct: this.settings.maxAllowedSpreadPct,
          minNetRiskReward: this.settings.minNetRiskReward,
          globalXauUsd: this.globalGoldUsd,
          globalXauChange24hPct: this.globalGoldChange24hPct,
          usdtIrtRate: this.usdtIrtRate,
        });
      } else if (market.category === 'MEME') {
        primaryMod = 'MEME_HUNTER';
        primaryBook = this.getOrderBookForSignal(
          market,
          this.settings.modules.MEME_HUNTER.risk.allocatedCapitalIrt * 0.25
        );
        primarySig = analyzeMemePumpMarket({
          market,
          candles,
          orderBook: primaryBook,
          riskSettings: this.settings.modules.MEME_HUNTER.risk,
          feePctPerSide: this.settings.bit24VipFeePct,
          maxAllowedSpreadPct: this.settings.maxAllowedSpreadPct,
          minNetRiskReward: this.settings.minNetRiskReward,
        });
      } else {
        primaryMod = 'SPOT_CRYPTO';
        primaryBook = this.getOrderBookForSignal(
          market,
          this.settings.modules.SPOT_CRYPTO.risk.allocatedCapitalIrt * 0.25
        );
        primarySig = analyzeSpotCryptoMarket({
          market,
          candles,
          orderBook: primaryBook,
          riskSettings: this.settings.modules.SPOT_CRYPTO.risk,
          feePctPerSide: this.settings.bit24VipFeePct,
          maxAllowedSpreadPct: this.settings.maxAllowedSpreadPct,
          minNetRiskReward: this.settings.minNetRiskReward,
        });
      }

      // Compute ANTI-RUG & SMART SECURITY report for this market/token
      const telemetry = buildTelemetryFromMarket({
        market,
        candles,
        orderBook: primaryBook,
        usdtIrtRate: this.usdtIrtRate,
        securityServiceOnline: this.securityServiceOnline,
        dataTimestampMs: feedTs,
        technicals: primarySig.technicals,
      });
      const secReport = evaluateTokenSecurity(telemetry, cfg);
      primarySig.securityReport = secReport;

      if (!uniqueTokenReports.has(market.baseSymbol) || market.quoteSymbol === 'IRT') {
        uniqueTokenReports.set(market.baseSymbol, secReport);
      }

      // Enforce Anti-Rug gate directly on signal action if enabled
      if (cfg.enabled && primarySig.action === 'BUY_CONFIRMED') {
        if (
          secReport.verdict === 'BLOCKED' ||
          secReport.verdict === 'BLOCKED_INSUFFICIENT_DATA'
        ) {
          primarySig.action = 'AVOID_UNFAVORABLE';
          const blockMsg = `مسدود توسط ANTI-RUG (امتیاز ${secReport.securityScore}/100): ${
            secReport.warningReasonsFa[0] || secReport.verdictLabelFa
          }`;
          primarySig.rejectionReasonsFa.unshift(blockMsg);
          this.recordBlockedBuyIncident({
            symbol: market.baseSymbol,
            marketName: market.marketName,
            module: primaryMod,
            securityScore: secReport.securityScore,
            verdict: secReport.verdict,
            primaryReasonFa: blockMsg,
            allReasonsFa: secReport.warningReasonsFa,
          });
        } else if (secReport.verdict === 'WARNING_REVIEW') {
          primarySig.action = 'HOLD_WATCH';
          const warnMsg = `هشدار امنیتی (امتیاز ${secReport.securityScore}/100 — نیاز به بررسی): ${
            secReport.warningReasonsFa[0] || secReport.verdictLabelFa
          }`;
          primarySig.rejectionReasonsFa.unshift(warnMsg);
        }
      }

      if (primarySig.action === 'AVOID_UNFAVORABLE' && primarySig.rejectionReasonsFa[0]) {
        this.recordRejectedAudit(
          primaryMod,
          market.marketName,
          primarySig.rejectionReasonsFa[0]
        );
      }
      nextSignals.push(primarySig);

      if (market.marginActive) {
        const book = this.getOrderBookForSignal(
          market,
          this.settings.modules.LEVERAGE_MARGIN.risk.allocatedCapitalIrt * 0.25
        );
        const levSig = analyzeLeverageMarket({
          market,
          candles,
          orderBook: book,
          riskSettings: this.settings.modules.LEVERAGE_MARGIN.risk,
          feePctPerSide: this.settings.bit24VipFeePct,
          maxAllowedSpreadPct: this.settings.maxAllowedSpreadPct,
          minNetRiskReward: this.settings.minNetRiskReward,
        });
        levSig.securityReport = secReport;
        nextSignals.push(levSig);
      }
    }

    // Evaluate Phantom Dip Hunter Pro DEX security watchlist tokens as well
    const dexWatchlist = createPhantomDexSecurityWatchlist(this.securityServiceOnline, feedTs);
    for (const dexTel of dexWatchlist) {
      const dexRep = evaluateTokenSecurity(dexTel, cfg);
      uniqueTokenReports.set(dexTel.symbol, dexRep);
    }

    // Merge custom live/user-inspected token contracts
    for (const custom of this.customInspectedReports) {
      uniqueTokenReports.set(`${custom.symbol}:${custom.contractAddress.slice(0, 8)}`, custom);
    }

    this.tokenSecurityReports = Array.from(uniqueTokenReports.values()).sort(
      (a, b) => a.securityScore - b.securityScore
    );

    nextSignals.sort((a, b) => {
      const aConfirmed =
        a.action === 'BUY_CONFIRMED' || a.action === 'SHORT_MARGIN_CONFIRMED' ? 1 : 0;
      const bConfirmed =
        b.action === 'BUY_CONFIRMED' || b.action === 'SHORT_MARGIN_CONFIRMED' ? 1 : 0;
      if (aConfirmed !== bConfirmed) return bConfirmed - aConfirmed;
      return b.confidenceScore - a.confidenceScore;
    });

    this.signals = nextSignals;
  }

  private async evaluateOpenPositions(): Promise<void> {
    const remaining: ManagedPosition[] = [];

    for (const pos of this.openPositions) {
      const market = this.markets.find((m) => m.marketName === pos.marketName);
      const livePrice = market?.eachPrice || pos.currentPrice;
      const modRisk = this.settings.modules[pos.module].risk;

      const stepped = stepPositionLifecycle({
        position: pos,
        newPrice: livePrice,
        feePctPerSide: this.settings.bit24VipFeePct,
        useSteppedTakeProfit: modRisk.useSteppedTakeProfit,
        useTrailingStop: modRisk.useTrailingStop,
      });

      if (stepped.partialRealizedEventFa) {
        this.addLog('SUCCESS', pos.module, stepped.partialRealizedEventFa);
      }

      if (stepped.closedRecord) {
        this.tradeHistory.unshift(stepped.closedRecord);
        this.addLog(
          stepped.closedRecord.netPnlQuote >= 0 ? 'SUCCESS' : 'WARN',
          pos.module,
          `${stepped.closedRecord.exitReasonFa} در ${pos.marketName} | سود/زیان خالص (${stepped.closedRecord.mode === 'LIVE' ? 'قطعی' : 'تخمینی آزمایشی'}): ${stepped.closedRecord.netPnlPct >= 0 ? '+' : ''}${stepped.closedRecord.netPnlPct}٪`
        );
        continue;
      }

      if (modRisk.earlyExitOnTrendWeakness) {
        const candles = this.candlesMap.get(pos.marketName) || [];
        const early =
          pos.module === 'DIGITAL_GOLD'
            ? evaluateGoldEarlyExit(stepped.updated, candles)
            : pos.module === 'MEME_HUNTER'
              ? evaluateMemeEarlyExit(stepped.updated, candles)
              : pos.module === 'SPOT_CRYPTO'
                ? evaluateSpotEarlyExit(stepped.updated, candles)
                : { shouldExit: false, reasonFa: '' };

        if (early.shouldExit) {
          const closed = this.closePositionInternal(
            stepped.updated,
            livePrice,
            'TREND_WEAKNESS_EARLY_EXIT',
            early.reasonFa
          );
          this.tradeHistory.unshift(closed);
          this.addLog('WARN', pos.module, `${early.reasonFa} (${pos.marketName})`);
          continue;
        }
      }

      remaining.push(stepped.updated);
    }

    this.openPositions = remaining;
  }

  private async executeEligibleSignals(): Promise<void> {
    const totalAllocatedIrt = this.getTotalAllocatedIrt();
    const dailyTotalPnlIrt = this.getDailyTotalPnlIrt();

    if (
      isDailyLossLimitReached(
        dailyTotalPnlIrt,
        totalAllocatedIrt,
        this.settings.dailyMaxLossPct
      )
    ) {
      return;
    }

    const canExecuteLive =
      this.settings.environmentMode === 'LIVE' &&
      this.settings.liveTradingConfirmedThisSession &&
      this.paperReadinessPassed &&
      this.bit24ConnectionState === 'CONNECTED_VERIFIED' &&
      this.lastErrorCategory === 'NONE' &&
      Boolean(this.adapter?.isConfigured());

    for (const sig of this.signals) {
      if (sig.action !== 'BUY_CONFIRMED' && sig.action !== 'SHORT_MARGIN_CONFIRMED') continue;

      const modConfig = this.settings.modules[sig.module];
      if (!modConfig.enabled) continue;
      if (
        sig.module === 'LEVERAGE_MARGIN' &&
        !this.settings.modules.LEVERAGE_MARGIN.userAcknowledgedLeverageRisk
      ) {
        continue;
      }

      if (sig.quoteSymbol !== modConfig.risk.quotePreference) continue;

      const market = this.markets.find((m) => m.marketName === sig.marketName);
      if (!market) continue;

      // Capital Shield & ANTI-RUG Security Gate (pre-entry verification)
      const shieldCheck = this.checkCapitalShieldBeforeBuy({
        module: sig.module,
        marketName: sig.marketName,
        baseSymbol: sig.baseSymbol,
        allowManualWarningReview: false,
      });
      if (!shieldCheck.allowed) {
        continue;
      }

      // Stage 5: Do NOT buy if API error active or live connection unverified in LIVE mode
      if (this.settings.environmentMode === 'LIVE' && (!canExecuteLive || !sig.executableOnBit24)) {
        continue;
      }

      // Stage 5: Duplicate-order prevention (idempotency lock on network latency)
      const orderKey = `${sig.module}:${sig.marketName}`;
      const lastAttempt = this.lastOrderAttemptAt.get(orderKey) || 0;
      if (
        this.inFlightOrders.has(orderKey) ||
        Date.now() - lastAttempt < ORDER_IDEMPOTENCY_COOLDOWN_MS
      ) {
        continue;
      }

      const openModPositions = this.openPositions.filter((p) => p.module === sig.module);
      const engagedModIrt = this.getModuleEngagedIrt(sig.module);

      const sizing = calculateSafePositionSize({
        module: sig.module,
        marketName: sig.marketName,
        quoteSymbol: sig.quoteSymbol,
        entryPrice: sig.suggestedEntry,
        stopLossPrice: sig.stopLoss,
        leverage: sig.leverage || 1,
        minOrderQuote: market.minOrderQuote,
        feePctPerSide: this.settings.bit24VipFeePct,
        riskSettings: modConfig.risk,
        openModulePositions: openModPositions,
        allOpenPositions: this.openPositions,
        maxTotalOpenPositions: this.settings.maxTotalOpenPositions,
        maxTotalOpenRiskPct: this.settings.maxTotalOpenRiskPct,
        engagedModuleCapitalIrt: engagedModIrt,
        usdtIrtRate: this.usdtIrtRate,
        dailyTotalPnlIrt,
        totalAllocatedIrt,
        dailyMaxLossPct: this.settings.dailyMaxLossPct,
      });

      if (!sizing.allowed) {
        if (sizing.reasonFa) {
          this.recordRejectedAudit(sig.module, sig.marketName, sizing.reasonFa);
        }
        continue;
      }

      const side: 'LONG' | 'SHORT' =
        sig.action === 'SHORT_MARGIN_CONFIRMED' ? 'SHORT' : 'LONG';
      const execMode: 'PAPER' | 'LIVE' = canExecuteLive ? 'LIVE' : 'PAPER';
      let bit24OrderId: number | undefined;
      let orderStatusVerified = false;

      this.inFlightOrders.add(orderKey);
      this.lastOrderAttemptAt.set(orderKey, Date.now());

      try {
        if (execMode === 'LIVE' && this.adapter) {
          const liveRes = await this.adapter.submitLiveOrder({
            module: sig.module,
            baseSymbol: sig.baseSymbol,
            quoteSymbol: sig.quoteSymbol,
            side,
            amount: sizing.quantityBase,
            price: sig.suggestedEntry,
            leverage: sig.leverage || 1,
            takeProfit: sig.takeProfit2,
            stopLoss: sig.stopLoss,
          });

          // Stage 2: Distinguish Connection Error vs Exchange Trade Rejection & NEVER report unconfirmed order!
          if (!liveRes.ok || !liveRes.orderId || liveRes.orderId <= 0) {
            const cat = liveRes.errorCategory || 'ORDER_REJECTED_BY_EXCHANGE';
            this.lastErrorCategory = cat;
            const errPrefix =
              cat === 'NETWORK_TIMEOUT_OR_OFFLINE'
                ? 'خطای اتصال شبکه هنگام ارسال سفارش'
                : cat === 'AUTH_OR_IP_ERROR'
                  ? 'خطای احراز هویت کلید API'
                  : 'رد سفارش توسط موتور معاملاتی صرافی';

            this.addLog(
              'ERROR',
              sig.module,
              `${errPrefix} (${sig.marketName}): ${liveRes.errorFa || 'بدون شناسه سفارش تاییدشده — هیچ موقعیتی ثبت نشد.'}`
            );
            continue;
          }

          bit24OrderId = liveRes.orderId;
          if (this.adapter.verifyOrderStatus) {
            const ver = await this.adapter.verifyOrderStatus(
              bit24OrderId,
              sig.baseSymbol,
              sig.quoteSymbol
            );
            orderStatusVerified = ver.verified;
          }
        }

        // Paper mode simulates realistic entry half-spread/slippage (0.06%)
        const effectiveEntryPrice =
          execMode === 'PAPER'
            ? smartRoundMarketPrice(sig.suggestedEntry * 1.0006, sig.quoteSymbol)
            : sig.suggestedEntry;

        const entryFeeQuote = sizing.notionalQuote * (this.settings.bit24VipFeePct / 100);
        const newPos: ManagedPosition = {
          id: `pos-${sig.module.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          bit24OrderId,
          orderStatusVerified,
          module: sig.module,
          mode: execMode,
          marketName: sig.marketName,
          baseSymbol: sig.baseSymbol,
          baseFaName: sig.baseFaName,
          quoteSymbol: sig.quoteSymbol,
          side,
          leverage: sig.leverage || 1,
          entryPrice: effectiveEntryPrice,
          currentPrice: effectiveEntryPrice,
          quantity: sizing.quantityBase,
          initialQuantity: sizing.quantityBase,
          notionalQuote: sizing.notionalQuote,
          collateralQuote: sizing.collateralQuote,
          stopLoss: sig.stopLoss,
          initialStopLoss: sig.stopLoss,
          takeProfit1: sig.takeProfit1,
          takeProfit2: sig.takeProfit2,
          tp1Hit: false,
          trailingActive: false,
          trailingDeltaPct: sig.trailingStopDeltaPct,
          highestPrice: effectiveEntryPrice,
          lowestPrice: effectiveEntryPrice,
          liquidationPrice: sig.liquidationPrice,
          paidFeesQuote: entryFeeQuote,
          realizedPartPnlQuote: -entryFeeQuote,
          unrealizedPnlQuote: 0,
          unrealizedPnlPct: Number((-this.settings.bit24VipFeePct).toFixed(2)),
          dcaCount: 0,
          openedAt: Date.now(),
          entryReasonFa: sig.setupTypeFa,
        };

        this.openPositions.unshift(newPos);
        this.addLog(
          'SUCCESS',
          sig.module,
          `ورود ${execMode === 'LIVE' ? `واقعی تاییدشده (سفارش #${bit24OrderId})` : 'آزمایشی (Paper)'} به ${sig.marketName} (${sig.setupTypeFa}) با ریسک حداکثر ${modConfig.risk.riskPerTradePct}٪.`
        );
      } finally {
        this.inFlightOrders.delete(orderKey);
      }
    }
  }

  private closePositionInternal(
    pos: ManagedPosition,
    exitPrice: number,
    exitReason: ClosedTradeRecord['exitReason'],
    exitReasonFa: string
  ): ClosedTradeRecord {
    const isLong = pos.side === 'LONG';
    const remEntry = pos.quantity * pos.entryPrice;
    const remExit = pos.quantity * exitPrice;
    const exitFee = remExit * (this.settings.bit24VipFeePct / 100);
    const rawDiff = isLong ? remExit - remEntry : remEntry - remExit;
    const totalNetPnl = pos.realizedPartPnlQuote + (rawDiff - exitFee);
    const totalFees = pos.paidFeesQuote + exitFee;
    const basis = Math.max(1, (pos.initialQuantity * pos.entryPrice) / Math.max(1, pos.leverage));
    const netPnlPct = Number(((totalNetPnl / basis) * 100).toFixed(2));

    return {
      id: `closed-${pos.id}-${Date.now()}`,
      bit24OrderId: pos.bit24OrderId,
      isConfirmedLiveFill: pos.mode === 'LIVE' && Boolean(pos.bit24OrderId),
      module: pos.module,
      mode: pos.mode,
      marketName: pos.marketName,
      baseSymbol: pos.baseSymbol,
      quoteSymbol: pos.quoteSymbol,
      side: pos.side,
      leverage: pos.leverage,
      entryPrice: pos.entryPrice,
      exitPrice,
      quantity: pos.initialQuantity,
      notionalQuote: pos.initialQuantity * pos.entryPrice,
      feesPaidQuote:
        pos.quoteSymbol === 'IRT' ? Math.round(totalFees) : Number(totalFees.toFixed(2)),
      netPnlQuote:
        pos.quoteSymbol === 'IRT' ? Math.round(totalNetPnl) : Number(totalNetPnl.toFixed(2)),
      netPnlPct,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
      exitReason,
      exitReasonFa,
    };
  }

  // ==================== Public User Control Actions ====================

  public setPauseNewTrades(paused: boolean): void {
    this.settings.pauseNewTrades = paused;
    this.addLog(
      paused ? 'WARN' : 'INFO',
      'SYSTEM',
      paused
        ? 'توقف معاملات جدید فعال شد: ورود به موقعیت جدید متوقف گردید اما مدیریت حد سود و ضرر موقعیت‌های باز ادامه دارد.'
        : 'توقف معاملات جدید لغو شد: اسکن و ورود خودکار مجدداً فعال است.'
    );
  }

  public setModuleEnabled(
    module: ModuleId,
    enabled: boolean,
    acknowledgeLeverageRisk = false
  ): void {
    if (enabled) {
      this.emergencyStopped = false;
    }
    if (module === 'LEVERAGE_MARGIN') {
      if (acknowledgeLeverageRisk) {
        this.settings.modules.LEVERAGE_MARGIN.userAcknowledgedLeverageRisk = true;
      }
      if (enabled && !this.settings.modules.LEVERAGE_MARGIN.userAcknowledgedLeverageRisk) {
        throw new Error(
          'در نسخه اول اهرم خاموش است؛ برای فعال‌سازی ربات مارجین، ابتدا باید هشدار ریسک نوسان و لیکویید شدن را تایید نمایید.'
        );
      }
    }
    this.settings.modules[module].enabled = enabled;
    const names: Record<ModuleId, string> = {
      DIGITAL_GOLD: 'ربات طلای دیجیتال (PAXG / XAUT)',
      SPOT_CRYPTO: 'ربات رمزارز اسپات',
      MEME_HUNTER: 'ربات شکارچی میم‌کوین و موج پامپ',
      LEVERAGE_MARGIN: 'ربات معاملات اهرم‌دار مارجین',
    };
    this.addLog(
      enabled ? 'SUCCESS' : 'WARN',
      module,
      `${names[module]} توسط کاربر ${enabled ? 'فعال شد' : 'متوقف شد'}.`
    );
  }

  public setEnvironmentMode(
    mode: TradingEnvironmentMode,
    explicitLiveConfirmation = false
  ): void {
    if (mode === 'LIVE') {
      if (this.liveTradingLockedUntilApproval) {
        throw new Error(
          'طبق دستور امنیتی شما، معاملات واقعی در حال حاضر غیرفعال و قفل است؛ تمام تست‌ها فقط در حالت DEMO / Paper Trading انجام می‌شوند.'
        );
      }
      if (!explicitLiveConfirmation) {
        throw new Error(
          'فعال‌سازی معاملات واقعی نیازمند تایید صریح دو مرحله‌ای توسط کاربر است.'
        );
      }
      if (!this.paperReadinessPassed) {
        throw new Error(
          'پیش از فعال‌سازی معاملات واقعی، ابتدا باید تست‌های امنیتی و حالت آزمایشی با موفقیت طی شوند.'
        );
      }
      if (!this.adapter?.isConfigured()) {
        throw new Error(
          'پیش از فعال‌سازی معاملات واقعی، ابتدا کلید API و کلید اختصاصی (Secret) بیت‌۲۴ را در محیط امن سرور متصل نمایید.'
        );
      }
      this.emergencyStopped = false;
      this.settings.pauseNewTrades = false;
      this.settings.environmentMode = 'LIVE';
      this.settings.liveTradingConfirmedThisSession = true;
      this.addLog(
        'WARN',
        'SECURITY',
        'حالت «معاملات واقعی در بیت‌۲۴» با تایید صریح شما فعال شد. با بسته شدن یا ری‌استارت برنامه، این حالت به شکل خودکار غیرفعال می‌شود.'
      );
      return;
    }

    this.settings.environmentMode = mode;
    this.settings.liveTradingConfirmedThisSession = false;
    if (mode === 'PAPER') {
      this.emergencyStopped = false;
      this.paperReadinessPassed = true;
    }
    this.addLog(
      'INFO',
      'SYSTEM',
      mode === 'PAPER'
        ? 'حالت «معاملات آزمایشی (DEMO / Paper Trading) بدون ریسک پول واقعی» فعال شد.'
        : 'حالت «فقط تحلیل و سیگنال‌دهی (بدون ثبت معامله)» فعال شد.'
    );
  }

  public updateAntiRugConfig(patch: Partial<CapitalShieldSettings>): void {
    const curr = this.getAntiRugSettings();
    this.settings.antiRugConfig = {
      ...curr,
      ...patch,
      minScoreForAutoDemoBuy:
        patch.minScoreForAutoDemoBuy !== undefined
          ? Math.max(65, Math.min(98, Math.round(Number(patch.minScoreForAutoDemoBuy))))
          : curr.minScoreForAutoDemoBuy,
      blockBelowScore:
        patch.blockBelowScore !== undefined
          ? Math.max(30, Math.min(80, Math.round(Number(patch.blockBelowScore))))
          : curr.blockBelowScore,
      minPoolLiquidityUsd:
        patch.minPoolLiquidityUsd !== undefined
          ? Math.max(1_000, Number(patch.minPoolLiquidityUsd))
          : curr.minPoolLiquidityUsd,
      blockOnMissingDataOrApiDown: true,
    };
    this.recomputeAllSignals();
    this.addLog(
      'INFO',
      'SECURITY',
      'تنظیمات ماژول ANTI-RUG & SMART SECURITY و محافظ سرمایه در حالت دمو بروزرسانی شد.'
    );
  }

  public setSecurityServiceOnline(online: boolean): void {
    this.securityServiceOnline = Boolean(online);
    this.recomputeAllSignals();
    this.addLog(
      online ? 'SUCCESS' : 'ERROR',
      'SECURITY',
      online
        ? 'سرویس بررسی امنیت توکن (ANTI-RUG API) مجدداً در دسترس قرار گرفت.'
        : 'شبیه‌سازی قطع سرویس امنیتی فعال شد: طبق قانون Fail-Closed، تمام خریدها به جای تایید امنیت، مسدود می‌شوند.'
    );
  }

  public setSimulatedFeedStale(stale: boolean): void {
    this.simulatedFeedStale = Boolean(stale);
    this.recomputeAllSignals();
    this.addLog(
      stale ? 'WARN' : 'INFO',
      'SECURITY',
      stale
        ? 'تست قدیمی شدن اطلاعات (Stale Data) فعال شد: محافظ سرمایه خرید روی داده‌های قدیمی را متوقف کرد.'
        : 'فید قیمت و نقدینگی مجدداً به حالت لحظه‌ای بازگشت.'
    );
  }

  public recordCustomInspectedToken(report: TokenSecurityReport): void {
    this.customInspectedReports = [
      report,
      ...this.customInspectedReports.filter(
        (r) => r.contractAddress.toLowerCase() !== report.contractAddress.toLowerCase()
      ),
    ].slice(0, 20);
    if (!report.buyAllowedInDemo) {
      this.recordBlockedBuyIncident({
        symbol: report.symbol,
        marketName: report.marketName,
        module: 'DEX_SCANNER',
        securityScore: report.securityScore,
        verdict: report.verdict,
        primaryReasonFa:
          report.warningReasonsFa[0] || report.verdictLabelFa || 'رد توسط بررسی قرارداد',
        allReasonsFa: report.warningReasonsFa,
      });
    }
    this.recomputeAllSignals();
    this.addLog(
      report.buyAllowedInDemo ? 'SUCCESS' : 'WARN',
      'SECURITY',
      `بررسی امنیتی توکن ${report.symbol} انجام شد: امتیاز ${report.securityScore}/100 (${report.verdictLabelFa}).`
    );
  }

  public async triggerSystemFaultEmergencyTest(): Promise<void> {
    this.systemErrorHaltsCount += 1;
    await this.emergencyStopAll(false);
    this.addLog(
      'ERROR',
      'SECURITY',
      'تست محافظ سرمایه (خطای سیستم): توقف اضطراری خودکار فعال شد و تمام خریدهای جدید متوقف گردید.'
    );
  }

  /**
   * Simulates attempting a Paper/Demo buy on any token (Bit24 or Phantom DEX watchlist)
   * so the user can test blocking high-risk, warning, duplicate, or offline tokens in Paper mode.
   */
  public testDemoBuyThroughAntiRug(symbolOrMarket: string): {
    allowed: boolean;
    reasonFa: string;
    report: TokenSecurityReport;
  } {
    const clean = symbolOrMarket.trim().toUpperCase();
    const matchedRep =
      this.tokenSecurityReports.find(
        (r) => r.symbol.toUpperCase() === clean || r.marketName.toUpperCase() === clean
      ) ||
      this.customInspectedReports.find(
        (r) => r.symbol.toUpperCase() === clean || r.marketName.toUpperCase() === clean
      );

    const sym = matchedRep ? matchedRep.symbol : clean.split('/')[0] || clean;
    const mktName = matchedRep ? matchedRep.marketName : `${sym}/SOL`;

    const res = this.checkCapitalShieldBeforeBuy({
      module: 'MEME_HUNTER',
      marketName: mktName,
      baseSymbol: sym,
      allowManualWarningReview: false,
    });

    this.addLog(
      res.allowed ? 'SUCCESS' : 'WARN',
      'SECURITY',
      res.allowed
        ? `تست خرید دمو ${mktName}: تایید شد (${res.reasonFa}).`
        : `تست خرید دمو ${mktName} توسط محافظ سرمایه مسدود شد: ${res.reasonFa}`
    );
    return res;
  }

  public updateSettings(patch: Partial<PlatformSettings>): void {
    if (patch.pauseNewTrades !== undefined) {
      this.settings.pauseNewTrades = Boolean(patch.pauseNewTrades);
    }
    this.settings = {
      ...this.settings,
      dailyMaxLossPct:
        patch.dailyMaxLossPct !== undefined
          ? Math.max(0.5, Math.min(10, Number(patch.dailyMaxLossPct)))
          : this.settings.dailyMaxLossPct,
      maxTotalOpenRiskPct:
        patch.maxTotalOpenRiskPct !== undefined
          ? Math.max(0.5, Math.min(8, Number(patch.maxTotalOpenRiskPct)))
          : this.settings.maxTotalOpenRiskPct,
      maxTotalOpenPositions:
        patch.maxTotalOpenPositions !== undefined
          ? Math.max(1, Math.min(10, Math.round(Number(patch.maxTotalOpenPositions))))
          : this.settings.maxTotalOpenPositions,
      bit24VipFeePct:
        patch.bit24VipFeePct !== undefined
          ? Math.max(0.05, Math.min(0.4, Number(patch.bit24VipFeePct)))
          : this.settings.bit24VipFeePct,
      maxAllowedSpreadPct:
        patch.maxAllowedSpreadPct !== undefined
          ? Math.max(0.1, Math.min(2.0, Number(patch.maxAllowedSpreadPct)))
          : this.settings.maxAllowedSpreadPct,
      minNetRiskReward:
        patch.minNetRiskReward !== undefined
          ? Math.max(1.2, Math.min(5.0, Number(patch.minNetRiskReward)))
          : this.settings.minNetRiskReward,
      modules: {
        DIGITAL_GOLD: {
          ...this.settings.modules.DIGITAL_GOLD,
          ...patch.modules?.DIGITAL_GOLD,
          risk: {
            ...this.settings.modules.DIGITAL_GOLD.risk,
            ...patch.modules?.DIGITAL_GOLD?.risk,
            allowLossAveragingDca: false,
          },
        },
        SPOT_CRYPTO: {
          ...this.settings.modules.SPOT_CRYPTO,
          ...patch.modules?.SPOT_CRYPTO,
          risk: {
            ...this.settings.modules.SPOT_CRYPTO.risk,
            ...patch.modules?.SPOT_CRYPTO?.risk,
            allowLossAveragingDca: false,
          },
        },
        MEME_HUNTER: {
          ...this.settings.modules.MEME_HUNTER,
          ...patch.modules?.MEME_HUNTER,
          risk: {
            ...this.settings.modules.MEME_HUNTER.risk,
            ...patch.modules?.MEME_HUNTER?.risk,
            allowLossAveragingDca: false,
          },
        },
        LEVERAGE_MARGIN: {
          ...this.settings.modules.LEVERAGE_MARGIN,
          ...patch.modules?.LEVERAGE_MARGIN,
          risk: {
            ...this.settings.modules.LEVERAGE_MARGIN.risk,
            ...patch.modules?.LEVERAGE_MARGIN?.risk,
            allowLossAveragingDca: false,
          },
        },
      },
    };
    this.recomputeAllSignals();
    this.addLog(
      'INFO',
      'SYSTEM',
      'تنظیمات مدیریت ریسک، سقف موقعیت‌های باز و حد سود/ضرر با موفقیت بروزرسانی شد.'
    );
  }

  /**
   * EMERGENCY STOP ALL BOTS (Stage 6 rule):
   * Immediately prevents ALL new orders across every module; does NOT force-sell open assets!
   */
  public async emergencyStopAll(cancelBit24OpenOrders = true): Promise<{
    cancelledOnExchange: boolean;
    messageFa: string;
  }> {
    this.emergencyStopped = true;
    this.settings.pauseNewTrades = true;
    this.settings.liveTradingConfirmedThisSession = false;
    this.settings.modules.DIGITAL_GOLD.enabled = false;
    this.settings.modules.SPOT_CRYPTO.enabled = false;
    this.settings.modules.MEME_HUNTER.enabled = false;
    this.settings.modules.LEVERAGE_MARGIN.enabled = false;
    if (this.settings.environmentMode === 'LIVE') {
      this.settings.environmentMode = 'ANALYSIS_ONLY';
    }

    let cancelledOnExchange = false;
    if (cancelBit24OpenOrders && this.adapter?.isConfigured()) {
      const cancelRes = await this.adapter.cancelAllOpenOrders();
      cancelledOnExchange = cancelRes.ok;
    }

    const msg = cancelledOnExchange
      ? 'توقف اضطراری اجرا شد: ثبت هرگونه سفارش جدید در تمام ماژول‌ها متوقف شد و سفارش‌های باز صرافی لغو گردید (موقعیت‌های فعلی بدون فروش اجباری حفظ شدند).'
      : 'توقف اضطراری اجرا شد: ثبت سفارش‌های جدید در تمام ربات‌ها فوراً متوقف شد (بستن موقعیت‌های باز فقط با انتخاب جداگانه شما انجام می‌شود).';
    this.addLog('ERROR', 'SECURITY', msg);
    return { cancelledOnExchange, messageFa: msg };
  }

  /**
   * Separate Explicit Position Closure after Market Review (Stage 6 rule)
   */
  public async emergencyLiquidateAllPositions(
    explicitSeparateConfirmation: boolean
  ): Promise<{ closedCount: number }> {
    if (!explicitSeparateConfirmation) {
      throw new Error('بستن موقعیت‌های باز نیازمند انتخاب جداگانه و تایید صریح کاربر است.');
    }

    const count = this.openPositions.length;
    for (const pos of this.openPositions) {
      const mkt = this.markets.find((m) => m.marketName === pos.marketName);
      const exitPrice = mkt?.eachPrice || pos.currentPrice;

      if (
        pos.mode === 'LIVE' &&
        this.adapter?.liquidateSpotAsset &&
        pos.module !== 'LEVERAGE_MARGIN'
      ) {
        await this.adapter.liquidateSpotAsset({
          baseSymbol: pos.baseSymbol,
          quoteSymbol: pos.quoteSymbol,
          amount: pos.quantity,
        });
      }

      const closed = this.closePositionInternal(
        pos,
        exitPrice,
        'EMERGENCY_LIQUIDATE',
        'بستن موقعیت باز با انتخاب جداگانه و تایید مستقیم کاربر'
      );
      this.tradeHistory.unshift(closed);
    }

    this.openPositions = [];
    this.recordPerformancePoint();
    this.addLog(
      'WARN',
      'SECURITY',
      `تسویه ${count} موقعیت باز با انتخاب و تایید جداگانه کاربر انجام شد.`
    );
    return { closedCount: count };
  }

  public closeSinglePositionManually(positionId: string): ClosedTradeRecord | null {
    const idx = this.openPositions.findIndex((p) => p.id === positionId);
    if (idx === -1) return null;
    const pos = this.openPositions[idx];
    const mkt = this.markets.find((m) => m.marketName === pos.marketName);
    const closed = this.closePositionInternal(
      pos,
      mkt?.eachPrice || pos.currentPrice,
      'MANUAL_CLOSE',
      'بسته شدن دستی توسط کاربر پس از بررسی بازار'
    );
    this.openPositions.splice(idx, 1);
    this.tradeHistory.unshift(closed);
    this.recordPerformancePoint();
    this.addLog('INFO', pos.module, `معامله ${pos.marketName} به‌صورت دستی بسته شد.`);
    return closed;
  }

  public executeSignalNowInPaper(signalId: string): ManagedPosition {
    const sig = this.signals.find((s) => s.id === signalId);
    if (!sig) {
      throw new Error('سیگنال مورد نظر یافت نشد.');
    }
    const market = this.markets.find((m) => m.marketName === sig.marketName);
    if (!market) {
      throw new Error('بازار مورد نظر یافت نشد.');
    }

    // Enforce ANTI-RUG & SMART SECURITY / Capital Shield before manual Paper entry too!
    const shield = this.checkCapitalShieldBeforeBuy({
      module: sig.module,
      marketName: sig.marketName,
      baseSymbol: sig.baseSymbol,
      allowManualWarningReview: false,
    });
    if (!shield.allowed) {
      throw new Error(shield.reasonFa);
    }

    const modRisk = this.settings.modules[sig.module].risk;
    const sizing = calculateSafePositionSize({
      module: sig.module,
      marketName: sig.marketName,
      quoteSymbol: sig.quoteSymbol,
      entryPrice: sig.suggestedEntry,
      stopLossPrice: sig.stopLoss,
      leverage: sig.leverage || 1,
      minOrderQuote: market.minOrderQuote,
      feePctPerSide: this.settings.bit24VipFeePct,
      riskSettings: modRisk,
      openModulePositions: this.openPositions.filter((p) => p.module === sig.module),
      allOpenPositions: this.openPositions,
      maxTotalOpenPositions: this.settings.maxTotalOpenPositions,
      maxTotalOpenRiskPct: this.settings.maxTotalOpenRiskPct,
      engagedModuleCapitalIrt: this.getModuleEngagedIrt(sig.module),
      usdtIrtRate: this.usdtIrtRate,
      dailyTotalPnlIrt: this.getDailyTotalPnlIrt(),
      totalAllocatedIrt: this.getTotalAllocatedIrt(),
      dailyMaxLossPct: this.settings.dailyMaxLossPct,
    });

    if (!sizing.allowed) {
      throw new Error(sizing.reasonFa || 'شرایط مدیریت ریسک اجازه ثبت این معامله را نمی‌دهد.');
    }

    const effectiveEntry = smartRoundMarketPrice(sig.suggestedEntry * 1.0006, sig.quoteSymbol);
    const entryFee = sizing.notionalQuote * (this.settings.bit24VipFeePct / 100);
    const pos: ManagedPosition = {
      id: `pos-manual-${Date.now()}`,
      module: sig.module,
      mode: 'PAPER',
      marketName: sig.marketName,
      baseSymbol: sig.baseSymbol,
      baseFaName: sig.baseFaName,
      quoteSymbol: sig.quoteSymbol,
      side: sig.action === 'SHORT_MARGIN_CONFIRMED' ? 'SHORT' : 'LONG',
      leverage: sig.leverage || 1,
      entryPrice: effectiveEntry,
      currentPrice: effectiveEntry,
      quantity: sizing.quantityBase,
      initialQuantity: sizing.quantityBase,
      notionalQuote: sizing.notionalQuote,
      collateralQuote: sizing.collateralQuote,
      stopLoss: sig.stopLoss,
      initialStopLoss: sig.stopLoss,
      takeProfit1: sig.takeProfit1,
      takeProfit2: sig.takeProfit2,
      tp1Hit: false,
      trailingActive: false,
      trailingDeltaPct: sig.trailingStopDeltaPct,
      highestPrice: effectiveEntry,
      lowestPrice: effectiveEntry,
      liquidationPrice: sig.liquidationPrice,
      paidFeesQuote: entryFee,
      realizedPartPnlQuote: -entryFee,
      unrealizedPnlQuote: 0,
      unrealizedPnlPct: Number((-this.settings.bit24VipFeePct).toFixed(2)),
      dcaCount: 0,
      openedAt: Date.now(),
      entryReasonFa: `${sig.setupTypeFa} (شبیه‌سازی آزمایشی با احتساب کارمزد و اسلیپیج)`,
    };

    this.openPositions.unshift(pos);
    this.paperReadinessPassed = true;
    this.recordPerformancePoint();
    this.addLog('SUCCESS', sig.module, `معامله آزمایشی (Paper) در ${sig.marketName} ثبت شد.`);
    return pos;
  }

  public runBacktest(
    module: 'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER',
    marketName?: string
  ): BacktestSummary {
    const defaultMarketName =
      module === 'DIGITAL_GOLD'
        ? 'PAXG/IRT'
        : module === 'MEME_HUNTER'
          ? 'DOGE/IRT'
          : 'BTC/IRT';
    const expectedCategory =
      module === 'DIGITAL_GOLD' ? 'GOLD' : module === 'MEME_HUNTER' ? 'MEME' : 'CRYPTO';
    const targetName = marketName || defaultMarketName;
    const market =
      this.markets.find((m) => m.marketName === targetName) ||
      this.markets.find((m) => m.category === expectedCategory) ||
      this.markets[0];

    const candles =
      this.candlesMap.get(market.marketName) || generateRealisticCandles(market, 140);

    return runHistoricalBacktest({
      module,
      market,
      candles,
      riskSettings: this.settings.modules[module].risk,
      feePctPerSide: this.settings.bit24VipFeePct,
      usdtIrtRate: this.usdtIrtRate,
      globalXauUsd: this.globalGoldUsd,
    });
  }

  /**
   * Generates UTF-8 BOM CSV export of trade history + open positions + rejected setups (Stage 6 button #10).
   */
  public exportHistoryCsv(): string {
    const headers = [
      'نوع رکورد',
      'شناسه',
      'ماژول',
      'بازار',
      'حالت اجرا',
      'تاییدیه API',
      'قیمت ورود',
      'قیمت خروج/فعلی',
      'مقدار',
      'ارزش معامله',
      'کارمزد',
      'سود و زیان خالص',
      'درصد سود و زیان',
      'علت ورود/خروج/رد',
      'زمان ثبت',
    ];

    const escapeCsv = (val: unknown): string => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows: string[][] = [headers];

    for (const tr of this.tradeHistory) {
      rows.push([
        'معامله بسته‌شده',
        tr.id,
        tr.module,
        tr.marketName,
        tr.mode === 'LIVE' ? 'واقعی (Bit24)' : 'آزمایشی شبیه‌سازی‌شده (Paper)',
        tr.isConfirmedLiveFill ? `تاییدشده (#${tr.bit24OrderId})` : 'شبیه‌سازی آزمایشی',
        String(tr.entryPrice),
        String(tr.exitPrice),
        String(tr.quantity),
        String(Math.round(tr.notionalQuote)),
        String(tr.feesPaidQuote),
        String(tr.netPnlQuote),
        `${tr.netPnlPct}%`,
        tr.exitReasonFa,
        new Date(tr.closedAt).toISOString(),
      ]);
    }

    for (const pos of this.openPositions) {
      rows.push([
        'موقعیت باز فعلی',
        pos.id,
        pos.module,
        pos.marketName,
        pos.mode === 'LIVE' ? 'واقعی (Bit24)' : 'آزمایشی شبیه‌سازی‌شده (Paper)',
        pos.bit24OrderId ? `سفارش #${pos.bit24OrderId}` : 'شبیه‌سازی آزمایشی',
        String(pos.entryPrice),
        String(pos.currentPrice),
        String(pos.quantity),
        String(Math.round(pos.notionalQuote)),
        String(Math.round(pos.paidFeesQuote)),
        String(Math.round(pos.realizedPartPnlQuote + pos.unrealizedPnlQuote)),
        `${pos.unrealizedPnlPct}%`,
        pos.entryReasonFa,
        new Date(pos.openedAt).toISOString(),
      ]);
    }

    for (const blk of this.blockedBuysLog.slice(0, 30)) {
      rows.push([
        'خرید مسدودشده (ANTI-RUG SECURITY)',
        blk.id,
        blk.module,
        blk.marketName,
        `مسدود (امتیاز ${blk.securityScore}/100)`,
        blk.verdict,
        '—',
        '—',
        '0',
        '0',
        '0',
        '0',
        '0%',
        blk.primaryReasonFa,
        new Date(blk.timestamp).toISOString(),
      ]);
    }

    for (const rej of this.rejectedAudit.slice(0, 25)) {
      rows.push([
        'سیگنال ردشده (مدیریت ریسک)',
        rej.id,
        rej.module,
        rej.marketName,
        'عدم ورود',
        '—',
        '—',
        '—',
        '0',
        '0',
        '0',
        '0',
        '0%',
        rej.reasonFa,
        new Date(rej.timestamp).toISOString(),
      ]);
    }

    // Prepend UTF-8 BOM (\uFEFF) so Excel on Windows/Android renders Persian text cleanly
    return '\uFEFF' + rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
  }

  // ==================== Aggregations & Reports ====================

  private toIrt(amount: number, quote: 'IRT' | 'USDT'): number {
    return quote === 'IRT' ? amount : amount * this.usdtIrtRate;
  }

  private getGoldAllocatedIrt(): number {
    return this.settings.modules.DIGITAL_GOLD.risk.allocatedCapitalIrt;
  }

  private getCryptoAllocatedIrt(): number {
    let sum =
      this.settings.modules.SPOT_CRYPTO.risk.allocatedCapitalIrt +
      this.settings.modules.MEME_HUNTER.risk.allocatedCapitalIrt;
    if (this.settings.modules.LEVERAGE_MARGIN.enabled) {
      sum += this.settings.modules.LEVERAGE_MARGIN.risk.allocatedCapitalIrt;
    }
    return sum;
  }

  private getTotalAllocatedIrt(): number {
    return this.getGoldAllocatedIrt() + this.getCryptoAllocatedIrt();
  }

  private getModuleEngagedIrt(module: ModuleId): number {
    return this.openPositions
      .filter((p) => p.module === module)
      .reduce((acc, p) => acc + this.toIrt(p.collateralQuote, p.quoteSymbol), 0);
  }

  private getDailyTotalPnlIrt(): number {
    const startOfDay = Date.now() - 24 * 3600 * 1000;
    const realizedToday = this.tradeHistory
      .filter((t) => t.closedAt >= startOfDay)
      .reduce((acc, t) => acc + this.toIrt(t.netPnlQuote, t.quoteSymbol), 0);
    const unrealized = this.openPositions.reduce(
      (acc, p) =>
        acc + this.toIrt(p.realizedPartPnlQuote + p.unrealizedPnlQuote, p.quoteSymbol),
      0
    );
    return Math.round(realizedToday + unrealized);
  }

  private buildPeriodBreakdown(
    periodId: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    labelFa: string,
    windowMs: number,
    isEstimatedSimulation: boolean
  ): PeriodPerformanceBreakdown {
    const cutoff = Date.now() - windowMs;
    const slice = this.tradeHistory.filter((t) => t.closedAt >= cutoff);
    const realizedPnlIrt = Math.round(
      slice.reduce((acc, t) => acc + this.toIrt(t.netPnlQuote, t.quoteSymbol), 0) +
        this.openPositions.reduce(
          (acc, p) => acc + this.toIrt(p.realizedPartPnlQuote, p.quoteSymbol),
          0
        )
    );
    const unrealizedPnlIrt = Math.round(
      this.openPositions.reduce(
        (acc, p) => acc + this.toIrt(p.unrealizedPnlQuote, p.quoteSymbol),
        0
      )
    );
    const feesPaidIrt = Math.round(
      slice.reduce((acc, t) => acc + this.toIrt(t.feesPaidQuote, t.quoteSymbol), 0) +
        this.openPositions.reduce((acc, p) => acc + this.toIrt(p.paidFeesQuote, p.quoteSymbol), 0)
    );
    const winningTrades = slice.filter((t) => t.netPnlQuote >= 0).length;
    const losingTrades = slice.filter((t) => t.netPnlQuote < 0).length;

    return {
      periodId,
      labelFa,
      realizedPnlIrt,
      unrealizedPnlIrt,
      feesPaidIrt,
      netPnlIrt: realizedPnlIrt + unrealizedPnlIrt,
      winningTrades,
      losingTrades,
      totalTrades: slice.length,
      isEstimatedSimulation,
    };
  }

  private computeModuleStatus(module: ModuleId, dailyLocked: boolean): BotRuntimeStatus {
    if (this.emergencyStopped) return 'EMERGENCY_STOPPED';
    if (this.circuitBreaker.tripped) return 'CIRCUIT_BREAKER_HALTED';
    if (!this.settings.modules[module].enabled) return 'STOPPED';
    if (dailyLocked) return 'DAILY_LOSS_HALTED';
    if (this.settings.pauseNewTrades) return 'PAUSED_NEW_TRADES';
    if (this.settings.environmentMode === 'ANALYSIS_ONLY') return 'ANALYZING';
    if (this.settings.environmentMode === 'LIVE') {
      if (
        this.settings.liveTradingConfirmedThisSession &&
        this.bit24ConnectionState === 'CONNECTED_VERIFIED'
      ) {
        return 'LIVE_ACTIVE';
      }
      return 'SIGNAL_ONLY_FALLBACK';
    }
    return 'PAPER_ACTIVE';
  }

  private buildModuleReport(
    module: ModuleId,
    titleFa: string,
    dailyLocked: boolean
  ): ModulePerformanceReport {
    const modCfg = this.settings.modules[module];
    const allocatedIrt = modCfg.risk.allocatedCapitalIrt;
    const engagedIrt = Math.round(this.getModuleEngagedIrt(module));
    const freeIrt = Math.max(0, allocatedIrt - engagedIrt);

    const dayCutoff = Date.now() - 24 * 3600 * 1000;
    const modHistory = this.tradeHistory.filter((t) => t.module === module);
    const modOpen = this.openPositions.filter((p) => p.module === module);

    const dailyRealizedIrt = Math.round(
      modHistory
        .filter((t) => t.closedAt >= dayCutoff)
        .reduce((acc, t) => acc + this.toIrt(t.netPnlQuote, t.quoteSymbol), 0)
    );
    const dailyUnrealizedIrt = Math.round(
      modOpen.reduce(
        (acc, p) =>
          acc + this.toIrt(p.realizedPartPnlQuote + p.unrealizedPnlQuote, p.quoteSymbol),
        0
      )
    );
    const dailyTotalIrt = dailyRealizedIrt + dailyUnrealizedIrt;
    const totalNetPnlIrt = Math.round(
      modHistory.reduce((acc, t) => acc + this.toIrt(t.netPnlQuote, t.quoteSymbol), 0) +
        dailyUnrealizedIrt
    );

    const wins = modHistory.filter((t) => t.netPnlQuote >= 0);
    const losses = modHistory.filter((t) => t.netPnlQuote < 0);
    const grossWin = wins.reduce((acc, t) => acc + this.toIrt(t.netPnlQuote, t.quoteSymbol), 0);
    const grossLoss = Math.abs(
      losses.reduce((acc, t) => acc + this.toIrt(t.netPnlQuote, t.quoteSymbol), 0)
    );
    const feesIrt = Math.round(
      modHistory.reduce((acc, t) => acc + this.toIrt(t.feesPaidQuote, t.quoteSymbol), 0) +
        modOpen.reduce((acc, p) => acc + this.toIrt(p.paidFeesQuote, p.quoteSymbol), 0)
    );

    return {
      module,
      titleFa,
      status: this.computeModuleStatus(module, dailyLocked),
      quoteCurrency: modCfg.risk.quotePreference,
      allocatedCapitalIrt: allocatedIrt,
      engagedCapitalIrt: engagedIrt,
      freeCapitalIrt: freeIrt,
      dailyRealizedPnlIrt: dailyRealizedIrt,
      dailyUnrealizedPnlIrt: dailyUnrealizedIrt,
      dailyTotalPnlIrt: dailyTotalIrt,
      dailyPnlPct:
        allocatedIrt > 0 ? Number(((dailyTotalIrt / allocatedIrt) * 100).toFixed(2)) : 0,
      totalNetPnlIrt,
      totalTrades: modHistory.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRatePct:
        modHistory.length > 0
          ? Number(((wins.length / modHistory.length) * 100).toFixed(1))
          : 0,
      profitFactor:
        grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 2.5 : 1.0,
      totalFeesPaidIrt: feesIrt,
      openPositionsCount: modOpen.length,
    };
  }

  public setBit24ConnectionMeta(meta: {
    state: ApiAndNetworkHealth['bit24ConnectionState'];
    latencyMs?: number | null;
    errorCategory?: ExchangeErrorCategory;
    verifiedWallet?: VerifiedWalletBalance;
    statusMessageFa?: string;
  }): void {
    this.bit24ConnectionState = meta.state;
    if (meta.latencyMs !== undefined) this.bit24LatencyMs = meta.latencyMs;
    if (meta.errorCategory !== undefined) this.lastErrorCategory = meta.errorCategory;
    if (meta.verifiedWallet !== undefined) this.verifiedWallet = meta.verifiedWallet;
    if (meta.statusMessageFa) this.statusMessageFa = meta.statusMessageFa;
  }

  public getSnapshot(internetOnline = true): PlatformSnapshot {
    const goldAllocatedIrt = this.getGoldAllocatedIrt();
    const cryptoAllocatedIrt = this.getCryptoAllocatedIrt();
    const totalAllocatedIrt = goldAllocatedIrt + cryptoAllocatedIrt;
    const dailyTotalPnlIrt = this.getDailyTotalPnlIrt();
    const dailyLocked = isDailyLossLimitReached(
      dailyTotalPnlIrt,
      totalAllocatedIrt,
      this.settings.dailyMaxLossPct
    );

    const reports: Record<ModuleId, ModulePerformanceReport> = {
      DIGITAL_GOLD: this.buildModuleReport(
        'DIGITAL_GOLD',
        'ماژول مستقل طلا (PAXG / XAUT در بیت‌۲۴)',
        dailyLocked
      ),
      SPOT_CRYPTO: this.buildModuleReport(
        'SPOT_CRYPTO',
        'ماژول مستقل رمزارز اسپات بیت‌۲۴',
        dailyLocked
      ),
      MEME_HUNTER: this.buildModuleReport(
        'MEME_HUNTER',
        'زیرماژول رمزارز: شکارچی میم‌کوین اسپات',
        dailyLocked
      ),
      LEVERAGE_MARGIN: this.buildModuleReport(
        'LEVERAGE_MARGIN',
        'معاملات اهرم‌دار (در نسخه اول خاموش)',
        dailyLocked
      ),
    };

    const totalEngagedIrt =
      reports.DIGITAL_GOLD.engagedCapitalIrt +
      reports.SPOT_CRYPTO.engagedCapitalIrt +
      reports.MEME_HUNTER.engagedCapitalIrt +
      reports.LEVERAGE_MARGIN.engagedCapitalIrt;

    const realizedPnlTotalIrt = Math.round(
      this.tradeHistory.reduce((acc, t) => acc + this.toIrt(t.netPnlQuote, t.quoteSymbol), 0) +
        this.openPositions.reduce(
          (acc, p) => acc + this.toIrt(p.realizedPartPnlQuote, p.quoteSymbol),
          0
        )
    );
    const unrealizedPnlTotalIrt = Math.round(
      this.openPositions.reduce(
        (acc, p) => acc + this.toIrt(p.unrealizedPnlQuote, p.quoteSymbol),
        0
      )
    );
    const totalFeesPaidAllIrt =
      reports.DIGITAL_GOLD.totalFeesPaidIrt +
      reports.SPOT_CRYPTO.totalFeesPaidIrt +
      reports.MEME_HUNTER.totalFeesPaidIrt +
      reports.LEVERAGE_MARGIN.totalFeesPaidIrt;

    const totalWinningTrades =
      reports.DIGITAL_GOLD.winningTrades +
      reports.SPOT_CRYPTO.winningTrades +
      reports.MEME_HUNTER.winningTrades +
      reports.LEVERAGE_MARGIN.winningTrades;
    const totalLosingTrades =
      reports.DIGITAL_GOLD.losingTrades +
      reports.SPOT_CRYPTO.losingTrades +
      reports.MEME_HUNTER.losingTrades +
      reports.LEVERAGE_MARGIN.losingTrades;

    const openRiskIrt = computeTotalOpenPositionsRiskIrt(
      this.openPositions,
      this.settings.bit24VipFeePct,
      this.usdtIrtRate
    );
    const currentOpenRiskPct =
      totalAllocatedIrt > 0 ? Number(((openRiskIrt / totalAllocatedIrt) * 100).toFixed(2)) : 0;

    const isPnlSimulationEstimated = !(
      this.settings.environmentMode === 'LIVE' &&
      this.bit24ConnectionState === 'CONNECTED_VERIFIED' &&
      this.tradeHistory.some((t) => t.isConfirmedLiveFill)
    );

    const dayMs = 24 * 3600 * 1000;
    const periodSummaries = {
      daily: this.buildPeriodBreakdown(
        'DAILY',
        'گزارش روزانه (۲۴ ساعت اخیر)',
        dayMs,
        isPnlSimulationEstimated
      ),
      weekly: this.buildPeriodBreakdown(
        'WEEKLY',
        'گزارش هفتگی (۷ روز اخیر)',
        7 * dayMs,
        isPnlSimulationEstimated
      ),
      monthly: this.buildPeriodBreakdown(
        'MONTHLY',
        'گزارش ماهانه (۳۰ روز اخیر)',
        30 * dayMs,
        isPnlSimulationEstimated
      ),
    };

    const health: ApiAndNetworkHealth = {
      internetOnline,
      serverBackendConnected: this.serverBackendConnected,
      adminAuthProtected: this.adminAuthProtected,
      bit24ApiConfigured: Boolean(this.adapter?.isConfigured()),
      bit24KeyMasked: this.adapter?.getMaskedKey() ?? null,
      bit24ConnectionState: this.bit24ConnectionState,
      lastErrorCategory: this.lastErrorCategory,
      bit24LatencyMs: this.bit24LatencyMs,
      rateLimitUsedPerMin: this.adapter?.getRateLimitUsed() ?? 0,
      rateLimitMaxPerMin: 250,
      paxgMarketAvailable: this.markets.some((m) => m.baseSymbol === 'PAXG' && m.spotActive),
      xautMarketAvailable: this.markets.some((m) => m.baseSymbol === 'XAUT' && m.spotActive),
      globalXauBrokerConnected: false,
      memeMarketsCount: this.markets.filter((m) => m.category === 'MEME' && m.spotActive).length,
      marginServiceAvailable: this.markets.some((m) => m.marginActive),
      withdrawalEndpointBlocked: true,
      stopLossExactFillGuaranteed: false,
      lastSyncAt: this.lastSyncAt,
      statusMessageFa: this.statusMessageFa,
      capabilities: OFFICIAL_BIT24_CAPABILITIES,
      incompleteFeatures: INCOMPLETE_FEATURES_REGISTRY,
    };

    const antiRugCfg = this.getAntiRugSettings();
    const suspiciousTokensCount = this.tokenSecurityReports.filter(
      (r) => r.verdict !== 'SAFE_FOR_DEMO'
    ).length;
    const safeDemoTokensCount = this.tokenSecurityReports.filter(
      (r) => r.verdict === 'SAFE_FOR_DEMO'
    ).length;

    const antiRug: AntiRugDashboardSummary = {
      botEditionTitle: 'Phantom Dip Hunter Pro — ANTI-RUG & SMART SECURITY',
      securityServiceOnline: this.securityServiceOnline,
      simulatedFeedStale: this.simulatedFeedStale,
      liveTradingLockedUntilApproval: this.liveTradingLockedUntilApproval,
      checkedTokensCount: this.tokenSecurityReports.length,
      suspiciousTokensCount,
      safeDemoTokensCount,
      blockedBuysCount: this.blockedBuysLog.length,
      duplicateBlocksCount: this.duplicateBlocksCount,
      staleOrOfflineBlocksCount: this.staleOrOfflineBlocksCount,
      systemErrorHaltsCount: this.systemErrorHaltsCount,
      config: JSON.parse(JSON.stringify(antiRugCfg)),
      tokenReports: this.tokenSecurityReports,
      blockedBuysLog: this.blockedBuysLog,
      realApisSupported: [
        {
          name: 'DexScreener Official API v1',
          purposeFa:
            'بررسی واقعی حجم نقدینگی استخر (USD)، تغییرات نقدینگی، سن توکن و نسبت تراکنش‌های خرید به فروش',
          endpointPattern: 'GET https://api.dexscreener.com/latest/dex/tokens/{address}',
          requiresPrivateKey: false,
          activeInCurrentEnvironment: 'SANDBOX_OUTBOUND_RESTRICTED',
        },
        {
          name: 'GoPlus Security API v1 (EVM & Solana)',
          purposeFa:
            'شناسایی هانی‌پات، مالیات خرید/فروش، لیست سیاه، Mint/Freeze و تمرکز هولدرها بدون نیاز به کلید خصوصی',
          endpointPattern:
            'GET https://api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses={address}',
          requiresPrivateKey: false,
          activeInCurrentEnvironment: 'SANDBOX_OUTBOUND_RESTRICTED',
        },
        {
          name: 'RugCheck.xyz Solana API v1',
          purposeFa:
            'بررسی تخصصی توکن‌های سولانا (Phantom SPL): اختیارات Mint Authority، Freeze Authority و قفل نقدینگی LP',
          endpointPattern: 'GET https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary',
          requiresPrivateKey: false,
          activeInCurrentEnvironment: 'SANDBOX_OUTBOUND_RESTRICTED',
        },
        {
          name: 'Honeypot.is Simulation API v2',
          purposeFa:
            'شبیه‌سازی واقعی امکان فروش توکن (Honeypot Detection) و استخراج دقیق مالیات خرید و فروش قراردادهای EVM',
          endpointPattern: 'GET https://api.honeypot.is/v2/IsHoneypot?address={address}',
          requiresPrivateKey: false,
          activeInCurrentEnvironment: 'SANDBOX_OUTBOUND_RESTRICTED',
        },
      ],
    };

    return {
      updatedAt: Date.now(),
      paperReadinessPassed: this.paperReadinessPassed,
      settings: JSON.parse(JSON.stringify(this.settings)),
      health,
      verifiedWallet: this.verifiedWallet,
      circuitBreaker: this.circuitBreaker,
      totalPortfolioIrt: totalAllocatedIrt + realizedPnlTotalIrt + unrealizedPnlTotalIrt,
      totalAllocatedIrt,
      goldAllocatedIrt,
      cryptoAllocatedIrt,
      totalEngagedIrt,
      currentOpenRiskPct,
      realizedPnlTotalIrt,
      unrealizedPnlTotalIrt,
      totalFeesPaidAllIrt,
      isPnlSimulationEstimated,
      totalWinningTrades,
      totalLosingTrades,
      dailyTotalPnlIrt,
      dailyTotalPnlPct:
        totalAllocatedIrt > 0
          ? Number(((dailyTotalPnlIrt / totalAllocatedIrt) * 100).toFixed(2))
          : 0,
      dailyLossLimitReached: dailyLocked,
      emergencyStopped: this.emergencyStopped,
      globalGoldUsd: this.globalGoldUsd,
      globalGoldChange24hPct: this.globalGoldChange24hPct,
      usdtIrtRate: this.usdtIrtRate,
      periodSummaries,
      performanceCurve:
        this.performanceCurve.length > 0
          ? this.performanceCurve
          : [
              {
                timestamp: Date.now(),
                labelFa: 'شروع',
                equityIrt: totalAllocatedIrt,
                goldPnlIrt: 0,
                cryptoPnlIrt: 0,
              },
            ],
      rejectedAudit: this.rejectedAudit,
      antiRug,
      markets: this.markets,
      signals: this.signals,
      openPositions: this.openPositions,
      tradeHistory: this.tradeHistory,
      reports,
      logs: this.logs,
    };
  }
}
