import {
  ActivePosition,
  AppStatusSnapshot,
  Bit24ApiHealth,
  Bit24TickerMarket,
  CandleBar,
  CapitalRiskConfig,
  CapitalSecurityStatus,
  ExitStrategyConfig,
  GoldMarketSignal,
  GoldPortfolioReport,
  OrderBookDepth,
  PeriodReportSummary,
  ProVerificationReport,
  PumpOpportunitySignal,
  TelegramEventType,
  TelegramNotificationLog,
  TradeHistoryRecord,
  TradeRejectionLog,
} from '../shared/contracts.js';
import {
  buildSimulatedOrderBook,
  createInitialBit24Catalog,
  roundIrtPrice,
} from './bit24Catalog.js';
import { computeMultiTimeframeChanges } from './mathIndicators.js';
import { runProfessionalPreLiveVerification } from './proVerificationSuite.js';
import {
  analyzeBit24CryptoPumpOpportunity,
  analyzeGoldAiMarket,
} from './pumpAndGoldAnalyzers.js';
import {
  calculateSafePositionCapitalIrt,
  DEFAULT_CAPITAL_RISK_CONFIG,
  DEFAULT_EXIT_STRATEGY_CONFIG,
  evaluatePositionStepExit,
  runSmartSecurityGate,
  sanitizeCapitalRiskConfig,
  sanitizeExitStrategyConfig,
} from './smartSecurityAndCapital.js';

export interface LiveOrderExecutor {
  checkLiveIrtBalance(): Promise<{ ok: boolean; availableIrt: number; error?: string }>;
  submitAndVerifySpotOrder(params: {
    baseCoin: string;
    quoteCoin: string;
    side: 'BUY' | 'SELL';
    amountBase: number;
    priceIrt: number;
  }): Promise<{
    ok: boolean;
    orderId?: string;
    filledPriceIrt?: number;
    feeIrt?: number;
    error?: string;
  }>;
}

export type TelegramAlertDispatcher = (
  eventType: TelegramEventType,
  title: string,
  safeSummary: string
) => Promise<TelegramNotificationLog | void> | void;

export class Bit24AiTraderOrchestrator {
  private markets: Bit24TickerMarket[] = [];
  private candlesBySymbol = new Map<string, CandleBar[]>();
  private orderBooksBySymbol = new Map<string, OrderBookDepth>();

  private scannerRunning = true;
  private tradingMode: 'STOPPED' | 'DEMO' | 'LIVE' = 'STOPPED';
  private liveTradingUserConfirmed = false;
  private emergencyStopped = false;
  private goldAutoDemoEnabled = false;

  private capitalConfig: CapitalRiskConfig = { ...DEFAULT_CAPITAL_RISK_CONFIG };
  private exitConfig: ExitStrategyConfig = { ...DEFAULT_EXIT_STRATEGY_CONFIG };

  // Separate Crypto Demo Capital vs Gold Demo Capital so Gold is NEVER mixed with Crypto!
  private demoCashIrt = DEFAULT_CAPITAL_RISK_CONFIG.initialDemoBalanceIrt;
  private goldDedicatedCashIrt = 50_000_000; // ۵۰ میلیون تومان پرتفوی مجزای طلای دیجیتال در دمو

  private openPositions: ActivePosition[] = [];
  private inFlightSymbols = new Set<string>();
  private tradeHistory: TradeHistoryRecord[] = [];
  private rejectionLogs: TradeRejectionLog[] = [];
  private telegramLogs: TelegramNotificationLog[] = [];
  private lastAlertedPumpBySymbol = new Map<string, number>();

  private consecutiveTradeErrors = 0;
  private apiDisconnectedFault = false;

  private cryptoSignals: PumpOpportunitySignal[] = [];
  private goldSignals: GoldMarketSignal[] = [];
  private latestVerificationReport: ProVerificationReport | null = null;

  private bit24Health: Bit24ApiHealth = {
    state: 'NOT_CONFIGURED',
    hasApiKey: false,
    hasSecretKey: false,
    maskedApiKey: '',
    withdrawalPermissionBlocked: true,
    baseUrl: 'https://rest.bit24.cash',
    lastCheckedAt: null,
    latencyMs: null,
    activeMarketFeed: 'SIMULATED_MARKET_FEED',
    messageFa:
      'کلید API صرافی Bit24 هنوز ثبت نشده است؛ ربات در حالت امن شبیه‌ساز دمو آماده به کار است (دسترسی برداشت وجه برای همیشه مسدود است).',
    messageEn:
      'Bit24 API key not yet configured; running in safe Demo simulator mode (withdrawal access permanently blocked).',
  };

  private telegramState = {
    configured: false,
    enabled: false,
    maskedChatId: '',
  };

  private liveExecutor?: LiveOrderExecutor;
  private onTelegramDispatch?: TelegramAlertDispatcher;

  constructor(opts?: {
    liveExecutor?: LiveOrderExecutor;
    onTelegramDispatch?: TelegramAlertDispatcher;
  }) {
    this.liveExecutor = opts?.liveExecutor;
    this.onTelegramDispatch = opts?.onTelegramDispatch;

    const init = createInitialBit24Catalog();
    this.markets = init.markets;
    this.candlesBySymbol = init.candlesBySymbol;
    for (const m of this.markets) {
      const candles = this.candlesBySymbol.get(m.symbol) || [];
      this.orderBooksBySymbol.set(m.symbol, buildSimulatedOrderBook(m, candles));
    }
    this.refreshSignals();
  }

  public setBit24Health(health: Partial<Bit24ApiHealth>): void {
    this.bit24Health = {
      ...this.bit24Health,
      ...health,
      withdrawalPermissionBlocked: true,
    };
    this.apiDisconnectedFault =
      this.tradingMode === 'LIVE' && this.bit24Health.state !== 'CONNECTED_PUBLIC_AND_PRIVATE';
  }

  public setTelegramMeta(meta: {
    configured: boolean;
    enabled: boolean;
    maskedChatId: string;
  }): void {
    this.telegramState = { ...meta };
  }

  public pushTelegramLog(entry: TelegramNotificationLog): void {
    this.telegramLogs.unshift(entry);
    if (this.telegramLogs.length > 80) this.telegramLogs.length = 80;
  }

  private emitTelegram(
    eventType: TelegramEventType,
    title: string,
    safeSummary: string
  ): void {
    if (this.onTelegramDispatch) {
      Promise.resolve(this.onTelegramDispatch(eventType, title, safeSummary))
        .then((logEntry) => {
          if (logEntry) this.pushTelegramLog(logEntry);
        })
        .catch(() => {
          // Never crash trading loop due to Telegram network error
        });
    } else {
      this.pushTelegramLog({
        id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        eventType,
        deliveredToTelegram: false,
        title,
        safeMessagePreview: safeSummary,
      });
    }
  }

  /**
   * Injects real Bit24 `/pro/capi/v2/markets` tickers when reachable over user's internet.
   */
  public applyLiveBit24Markets(liveMarkets: Bit24TickerMarket[]): void {
    if (!liveMarkets || liveMarkets.length === 0) return;
    const now = Date.now();
    this.markets = liveMarkets.map((lm) => {
      const existingBars = this.candlesBySymbol.get(lm.symbol) || [];
      const nextBar: CandleBar = {
        t: Math.floor(now / 1000),
        o: existingBars[existingBars.length - 1]?.c || lm.priceIrt,
        h: Math.max(lm.priceIrt, existingBars[existingBars.length - 1]?.c || lm.priceIrt),
        l: Math.min(lm.priceIrt, existingBars[existingBars.length - 1]?.c || lm.priceIrt),
        c: lm.priceIrt,
        v: Math.max(1, lm.volume24hBase / 1440),
      };
      const updatedBars = [...existingBars.slice(-199), nextBar];
      this.candlesBySymbol.set(lm.symbol, updatedBars);
      const mtf = computeMultiTimeframeChanges(updatedBars);
      const merged: Bit24TickerMarket = {
        ...lm,
        change1mPct: mtf.change1mPct,
        change5mPct: mtf.change5mPct,
        change15mPct: mtf.change15mPct,
        change60mPct: mtf.change60mPct,
        updatedAt: now,
        dataFeedType: 'LIVE_BIT24_API',
      };
      if (!this.orderBooksBySymbol.get(lm.symbol)?.fromLiveOrderBook) {
        this.orderBooksBySymbol.set(
          lm.symbol,
          buildSimulatedOrderBook(merged, updatedBars)
        );
      }
      return merged;
    });
    this.bit24Health.activeMarketFeed = 'LIVE_BIT24_API';
    this.refreshSignals();
  }

  /**
   * Advances simulated market feed by one realistic tick when offline/demo,
   * updates open positions (SL, Trailing Stop, Stepped TP), and executes Demo/Live signals!
   */
  public async stepCycle(): Promise<void> {
    const now = Date.now();

    // Update simulated ticks when not receiving live API stream
    if (this.bit24Health.activeMarketFeed === 'SIMULATED_MARKET_FEED') {
      for (const m of this.markets) {
        const bars = this.candlesBySymbol.get(m.symbol) || [];
        const prev = bars[bars.length - 1]?.c || m.priceIrt;
        const seedBias =
          m.symbol === 'PEPE/IRT'
            ? -0.0015
            : m.segment === 'GOLD'
            ? 0.0006
            : 0.0012;
        const jitter = (Math.sin(now / 7000 + m.symbol.charCodeAt(0)) * 0.0038) + seedBias;
        const nextPrice = roundIrtPrice(Math.max(0.0001, prev * (1 + jitter)));
        const high = roundIrtPrice(Math.max(prev, nextPrice) * 1.0015);
        const low = roundIrtPrice(Math.min(prev, nextPrice) * 0.9985);
        const avgVol =
          bars.length > 0 ? bars[bars.length - 1].v : 100;
        const volMult = jitter > 0.001 ? 1.55 : 0.98;

        const bar: CandleBar = {
          t: Math.floor(now / 1000),
          o: prev,
          h: high,
          l: low,
          c: nextPrice,
          v: Number((avgVol * volMult).toFixed(4)),
        };
        const nextBars = [...bars.slice(-179), bar];
        this.candlesBySymbol.set(m.symbol, nextBars);
        const mtf = computeMultiTimeframeChanges(nextBars);

        m.priceIrt = nextPrice;
        m.change1mPct = mtf.change1mPct;
        m.change5mPct = mtf.change5mPct;
        m.change15mPct = mtf.change15mPct;
        m.change60mPct = mtf.change60mPct;
        m.updatedAt = now;

        this.orderBooksBySymbol.set(m.symbol, buildSimulatedOrderBook(m, nextBars));
      }
    }

    // Always manage open positions (Stop-Loss / Trailing Stop / Stepped Take-Profit)
    await this.manageOpenPositions(now);

    // Refresh scanner signals if scanner is running
    if (this.scannerRunning) {
      this.refreshSignals();
    }

    // Auto-execute Demo or confirmed Live entries when trading is active and not emergency-stopped
    if (
      !this.emergencyStopped &&
      (this.tradingMode === 'DEMO' ||
        (this.tradingMode === 'LIVE' && this.liveTradingUserConfirmed))
    ) {
      await this.evaluateNewEntries(now);
    }
  }

  public refreshSignals(): void {
    const nextCrypto: PumpOpportunitySignal[] = [];
    const nextGold: GoldMarketSignal[] = [];

    for (const m of this.markets) {
      const candles = this.candlesBySymbol.get(m.symbol) || [];
      const ob =
        this.orderBooksBySymbol.get(m.symbol) || buildSimulatedOrderBook(m, candles);

      if (m.segment === 'CRYPTO') {
        const sig = analyzeBit24CryptoPumpOpportunity(m, candles, ob);
        nextCrypto.push(sig);

        // Optional Telegram alert for new high-score pump candidates (throttled per 15 min)
        if (sig.opportunityScore >= 85) {
          const prevAlert = this.lastAlertedPumpBySymbol.get(sig.symbol) || 0;
          if (Date.now() - prevAlert > 15 * 60_000) {
            this.lastAlertedPumpBySymbol.set(sig.symbol, Date.now());
            this.emitTelegram(
              'PUMP_CANDIDATE',
              `رمزارز مستعد رشد: ${sig.symbol} (${sig.opportunityScore}/100)`,
              `قیمت: ${sig.priceIrt.toLocaleString()} تومان | قدرت خریدار: ${sig.indicators.buyerPowerPct}% | حجم: ${sig.indicators.volumeSurgeRatio}x`
            );
          }
        }
      }
    }

    // Evaluate PAXG/IRT and XAUT/IRT independently for GOLD AI TRADER
    for (const goldCoin of ['PAXG', 'XAUT'] as const) {
      const sym = `${goldCoin}/IRT` as const;
      const gm = this.markets.find((x) => x.symbol === sym && x.segment === 'GOLD');
      const gCandles = this.candlesBySymbol.get(sym) || [];
      const gBook = gm ? this.orderBooksBySymbol.get(sym) : undefined;
      nextGold.push(analyzeGoldAiMarket(sym, goldCoin, gm, gCandles, gBook));
    }

    nextCrypto.sort((a, b) => b.opportunityScore - a.opportunityScore);
    this.cryptoSignals = nextCrypto;
    this.goldSignals = nextGold;
  }

  private async manageOpenPositions(nowMs: number): Promise<void> {
    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const pos = this.openPositions[i];
      const market = this.markets.find((m) => m.symbol === pos.symbol);
      if (!market) continue;

      const candles = this.candlesBySymbol.get(pos.symbol) || [];
      const lastBar = candles[candles.length - 1];
      const barLow = lastBar ? Math.min(lastBar.l, market.priceIrt) : market.priceIrt;
      const barHigh = lastBar ? Math.max(lastBar.h, market.priceIrt) : market.priceIrt;

      const exitCfg =
        pos.segment === 'GOLD'
          ? {
              ...this.exitConfig,
              initialStopLossPct: 2.5,
              trailingActivationProfitPct: 4.5,
              trailingDistanceFromPeakPct: 1.5,
              tpStage1ProfitPct: 4,
              tpStage2ProfitPct: 7,
              tpStage3ProfitPct: 11,
            }
          : this.exitConfig;

      const decision = evaluatePositionStepExit(
        pos,
        market.priceIrt,
        barLow,
        barHigh,
        exitCfg
      );

      if (!decision) continue;

      await this.executeExitOrder(
        pos,
        i,
        decision.sellQuantity,
        decision.closeEntirePosition,
        decision.stageTriggered,
        decision.sellReasonFa,
        decision.sellReasonEn,
        nowMs
      );
    }
  }

  private async executeExitOrder(
    pos: ActivePosition,
    posIndex: number,
    sellQuantity: number,
    closeEntirePosition: boolean,
    stageTriggered: 1 | 2 | 3 | undefined,
    sellReasonFa: string,
    sellReasonEn: string,
    nowMs: number
  ): Promise<void> {
    const market = this.markets.find((m) => m.symbol === pos.symbol);
    const ob = this.orderBooksBySymbol.get(pos.symbol);
    const rawPrice = market?.priceIrt || pos.currentPriceIrt;
    const slippagePct = ob?.estimatedSlippagePct || 0.08;

    let filledSellPrice = roundIrtPrice(rawPrice * (1 - slippagePct / 100));
    let sellFeeIrt = sellQuantity * filledSellPrice * 0.002;

    if (pos.mode === 'LIVE' && this.liveExecutor) {
      const liveRes = await this.liveExecutor.submitAndVerifySpotOrder({
        baseCoin: pos.baseCoin,
        quoteCoin: 'IRT',
        side: 'SELL',
        amountBase: sellQuantity,
        priceIrt: filledSellPrice,
      });
      if (!liveRes.ok) {
        this.consecutiveTradeErrors += 1;
        this.recordRejection({
          id: `rej-sell-${nowMs}`,
          timestamp: nowMs,
          symbol: pos.symbol,
          code: 'ABNORMAL_MARKET',
          reasonFa: `خطا در تأیید سفارش فروش واقعی Bit24: ${liveRes.error || 'نامشخص'}`,
          reasonEn: `Live Bit24 sell order verification failed: ${liveRes.error || 'Unknown'}`,
        });
        return;
      }
      if (liveRes.filledPriceIrt) filledSellPrice = liveRes.filledPriceIrt;
      if (typeof liveRes.feeIrt === 'number') sellFeeIrt = liveRes.feeIrt;
      this.consecutiveTradeErrors = 0;
    }

    if (stageTriggered === 1) pos.tpStage1Filled = true;
    if (stageTriggered === 2) pos.tpStage2Filled = true;
    if (stageTriggered === 3) pos.tpStage3Filled = true;

    const grossProceedsIrt = sellQuantity * filledSellPrice;
    const netProceedsIrt = grossProceedsIrt - sellFeeIrt;
    const fraction = Math.min(1, sellQuantity / Math.max(1e-9, pos.remainingQuantity));
    const capitalPortion = pos.remainingCapitalIrt * fraction;
    const entryFeePortion = capitalPortion * 0.002;
    const totalFeeIrt = Math.round(entryFeePortion + sellFeeIrt);
    const slippageCostIrt = Math.round(sellQuantity * rawPrice * (slippagePct / 100));
    const netPnlIrt = Math.round(netProceedsIrt - capitalPortion);
    const netPnlPct =
      capitalPortion > 0 ? Number(((netPnlIrt / capitalPortion) * 100).toFixed(2)) : 0;

    if (pos.mode === 'DEMO') {
      if (pos.segment === 'GOLD') {
        this.goldDedicatedCashIrt += netProceedsIrt;
      } else {
        this.demoCashIrt += netProceedsIrt;
      }
    }

    const record: TradeHistoryRecord = {
      id: `trd-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: pos.symbol,
      segment: pos.segment,
      mode: pos.mode,
      buyTime: pos.openedAt,
      buyPriceIrt: pos.entryPriceIrt,
      sellTime: nowMs,
      sellPriceIrt: filledSellPrice,
      quantity: Number(sellQuantity.toFixed(6)),
      capitalEnteredIrt: Math.round(capitalPortion),
      totalFeeIrt,
      slippageCostIrt,
      netPnlIrt,
      netPnlPct,
      buyReasonFa: pos.buyReasonFa,
      buyReasonEn: pos.buyReasonEn,
      sellReasonFa,
      sellReasonEn,
    };

    this.tradeHistory.unshift(record);
    if (this.tradeHistory.length > 500) this.tradeHistory.length = 500;

    pos.remainingQuantity = Math.max(0, pos.remainingQuantity - sellQuantity);
    pos.remainingCapitalIrt = Math.max(0, pos.remainingCapitalIrt - capitalPortion);

    if (closeEntirePosition || pos.remainingQuantity <= 1e-8) {
      this.openPositions.splice(posIndex, 1);
    }

    const tgType: TelegramEventType = stageTriggered
      ? 'TAKE_PROFIT_HIT'
      : netPnlIrt < 0
      ? 'STOP_LOSS_HIT'
      : 'DEMO_SELL';
    this.emitTelegram(
      tgType,
      `فروش ${pos.mode === 'DEMO' ? 'دمو' : 'واقعی'} ${pos.symbol}`,
      `قیمت فروش: ${filledSellPrice.toLocaleString()} تومان | سود/زیان خالص: ${netPnlIrt.toLocaleString()} تومان (${netPnlPct}%) | علت: ${sellReasonFa}`
    );

    // Check if Daily Loss Limit (-3%) was breached after a realized loss -> Auto-Stop!
    const dailyPct = this.getCryptoDailyPnlPct();
    if (
      this.capitalConfig.autoStopOnDailyLoss &&
      dailyPct <= -Math.abs(this.capitalConfig.maxDailyLossPct) &&
      this.tradingMode !== 'STOPPED'
    ) {
      this.tradingMode = 'STOPPED';
      this.emitTelegram(
        'BOT_STOPPED',
        'توقف خودکار محافظ سرمایه (سقف ضرر روزانه)',
        `ضرر روزانه به ${dailyPct.toFixed(2)}% رسید (حد مجاز: -${this.capitalConfig.maxDailyLossPct}%). معاملات جدید متوقف شدند.`
      );
    }
  }

  private async evaluateNewEntries(nowMs: number): Promise<void> {
    // 1. Evaluate Top Crypto Strong Signals (85 - 100)
    const strongSignals = this.cryptoSignals.filter(
      (s) => s.tier === 'STRONG_TEST_SIGNAL' && s.opportunityScore >= 85
    );

    for (const sig of strongSignals) {
      await this.tryOpenCryptoPosition(sig, nowMs);
    }

    // 2. Evaluate Gold AI Trader independently if enabled
    if (this.goldAutoDemoEnabled && this.tradingMode === 'DEMO') {
      for (const gs of this.goldSignals) {
        if (gs.verifiedTradableOnBit24 && gs.action === 'GOLD_BUY_CANDIDATE') {
          await this.tryOpenGoldDemoPosition(gs.symbol, nowMs);
        }
      }
    }
  }

  public async tryOpenCryptoPosition(
    sig: PumpOpportunitySignal,
    nowMs = Date.now()
  ): Promise<{ ok: boolean; messageFa: string; messageEn: string }> {
    const market = this.markets.find((m) => m.symbol === sig.symbol);
    const ob = this.orderBooksBySymbol.get(sig.symbol);
    if (!market || !ob) {
      return {
        ok: false,
        messageFa: 'بازار موردنظر در لیست Bit24 یافت نشد.',
        messageEn: 'Market not found on Bit24.',
      };
    }

    const mode: 'DEMO' | 'LIVE' = this.tradingMode === 'LIVE' ? 'LIVE' : 'DEMO';

    // HARD GUARD: Never allow LIVE trade without explicit user confirmation!
    if (mode === 'LIVE' && !this.liveTradingUserConfirmed) {
      return {
        ok: false,
        messageFa: 'معامله واقعی تا زمان تأیید نهایی کاربر به صورت سخت‌افزاری قفل است.',
        messageEn: 'Live trading is locked until explicit user confirmation.',
      };
    }

    const gate = runSmartSecurityGate({
      nowMs,
      symbol: sig.symbol,
      mode,
      market,
      orderBook: ob,
      openPositions: this.openPositions,
      inFlightSymbols: this.inFlightSymbols,
      dailyLossPctSoFar: this.getCryptoDailyPnlPct(),
      capitalConfig: this.capitalConfig,
      emergencyStopped: this.emergencyStopped,
      apiDisconnectedFault: this.apiDisconnectedFault,
      consecutiveTradeErrors: this.consecutiveTradeErrors,
      pumpAndDumpRisk: sig.indicators.pumpAndDumpRisk,
      alreadyOverPumped: sig.indicators.alreadyOverPumped,
      atrPct: sig.indicators.atrPct,
    });

    if (!gate.allowed && gate.rejection) {
      this.recordRejection(gate.rejection);
      return {
        ok: false,
        messageFa: gate.rejection.reasonFa,
        messageEn: gate.rejection.reasonEn,
      };
    }

    let availableCashIrt = this.demoCashIrt;
    let totalEquityIrt = this.getCryptoDemoTotalEquityIrt();

    // In LIVE mode: strictly verify balance from Bit24 API BEFORE submitting any order
    if (mode === 'LIVE') {
      if (!this.liveExecutor) {
        return {
          ok: false,
          messageFa: 'اجراکننده رسمی Bit24 متصل نیست.',
          messageEn: 'Live Bit24 executor is not attached.',
        };
      }
      const bal = await this.liveExecutor.checkLiveIrtBalance();
      if (!bal.ok) {
        this.consecutiveTradeErrors += 1;
        return {
          ok: false,
          messageFa: `خطا در استعلام موجودی Bit24 پیش از خرید: ${bal.error}`,
          messageEn: `Pre-order Bit24 balance check failed: ${bal.error}`,
        };
      }
      availableCashIrt = bal.availableIrt;
      totalEquityIrt = bal.availableIrt;
    }

    const capitalIrt = calculateSafePositionCapitalIrt({
      totalEquityIrt,
      availableCashIrt,
      stopLossPct: this.exitConfig.initialStopLossPct,
      capitalConfig: this.capitalConfig,
    });

    if (capitalIrt < market.minOrderIrt) {
      const rej: TradeRejectionLog = {
        id: `rej-bal-${nowMs}`,
        timestamp: nowMs,
        symbol: sig.symbol,
        code: 'INSUFFICIENT_BALANCE',
        reasonFa: `موجودی قابل تخصیص (${capitalIrt.toLocaleString()} تومان) کمتر از حداقل سفارش Bit24 (${market.minOrderIrt.toLocaleString()} تومان) است.`,
        reasonEn: `Allocated capital (${capitalIrt.toLocaleString()} IRT) is below Bit24 minimum order (${market.minOrderIrt.toLocaleString()} IRT).`,
      };
      this.recordRejection(rej);
      return { ok: false, messageFa: rej.reasonFa, messageEn: rej.reasonEn };
    }

    // Lock symbol in-flight to prevent duplicate simultaneous orders
    this.inFlightSymbols.add(sig.symbol);
    try {
      const slippagePct = ob.estimatedSlippagePct || 0.08;
      let filledPriceIrt = roundIrtPrice(market.priceIrt * (1 + slippagePct / 100));
      let entryFeeIrt = Math.round(capitalIrt * 0.002);
      const estQty = (capitalIrt - entryFeeIrt) / filledPriceIrt;

      if (mode === 'LIVE' && this.liveExecutor) {
        // Submit AND verify order result BEFORE releasing lock or allowing next order
        const orderRes = await this.liveExecutor.submitAndVerifySpotOrder({
          baseCoin: market.baseCoin,
          quoteCoin: 'IRT',
          side: 'BUY',
          amountBase: Number(estQty.toFixed(6)),
          priceIrt: filledPriceIrt,
        });
        if (!orderRes.ok) {
          this.consecutiveTradeErrors += 1;
          return {
            ok: false,
            messageFa: `سفارش خرید در صرافی Bit24 تأیید نشد: ${orderRes.error}`,
            messageEn: `Bit24 spot buy order not verified: ${orderRes.error}`,
          };
        }
        if (orderRes.filledPriceIrt) filledPriceIrt = orderRes.filledPriceIrt;
        if (typeof orderRes.feeIrt === 'number') entryFeeIrt = orderRes.feeIrt;
        this.consecutiveTradeErrors = 0;
      } else {
        this.demoCashIrt -= capitalIrt;
      }

      const finalQty = (capitalIrt - entryFeeIrt) / filledPriceIrt;
      const initialSlIrt = roundIrtPrice(
        filledPriceIrt * (1 - this.exitConfig.initialStopLossPct / 100)
      );

      const buyReasonFa = `امتیاز هوش مصنوعی ${sig.opportunityScore}/100 | ${sig.reasonsFa.slice(0, 2).join(' + ')}`;
      const buyReasonEn = `AI Score ${sig.opportunityScore}/100 | ${sig.reasonsEn.slice(0, 2).join(' + ')}`;

      this.openPositions.push({
        id: `pos-${nowMs}-${sig.baseCoin}`,
        symbol: sig.symbol,
        baseCoin: sig.baseCoin,
        segment: 'CRYPTO',
        mode,
        entryPriceIrt: filledPriceIrt,
        currentPriceIrt: filledPriceIrt,
        highestPriceIrt: filledPriceIrt,
        initialQuantity: finalQty,
        remainingQuantity: finalQty,
        initialCapitalIrt: capitalIrt,
        remainingCapitalIrt: capitalIrt,
        entryFeeIrt,
        initialStopLossIrt: initialSlIrt,
        activeStopLossIrt: initialSlIrt,
        trailingStopActive: false,
        trailingStopPriceIrt: null,
        tpStage1Filled: false,
        tpStage2Filled: false,
        tpStage3Filled: false,
        unrealizedPnlIrt: 0,
        unrealizedPnlPct: 0,
        buyReasonFa,
        buyReasonEn,
        openedAt: nowMs,
      });

      this.emitTelegram(
        mode === 'DEMO' ? 'DEMO_BUY' : 'BUY_SIGNAL',
        `خرید ${mode === 'DEMO' ? 'آزمایشی (Demo)' : 'واقعی'} ${sig.symbol}`,
        `سرمایه: ${capitalIrt.toLocaleString()} تومان | قیمت ورود: ${filledPriceIrt.toLocaleString()} تومان | حد ضرر: ${initialSlIrt.toLocaleString()} تومان`
      );

      return {
        ok: true,
        messageFa: `خرید ${mode === 'DEMO' ? 'آزمایشی' : 'واقعی'} ${sig.symbol} با موفقیت ثبت شد.`,
        messageEn: `${mode} buy opened on ${sig.symbol}.`,
      };
    } finally {
      this.inFlightSymbols.delete(sig.symbol);
    }
  }

  /**
   * Dedicated GOLD AI TRADER Demo Execution (strictly isolated from Crypto capital & PnL!)
   */
  public async tryOpenGoldDemoPosition(
    symbol: 'PAXG/IRT' | 'XAUT/IRT',
    nowMs = Date.now()
  ): Promise<{ ok: boolean; messageFa: string; messageEn: string }> {
    const goldSig = this.goldSignals.find((g) => g.symbol === symbol);
    const market = this.markets.find((m) => m.symbol === symbol && m.segment === 'GOLD');
    if (!goldSig || !goldSig.verifiedTradableOnBit24 || !market) {
      return {
        ok: false,
        messageFa: `نماد طلای دیجیتال ${symbol} در صرافی Bit24 قابل معامله تأیید نشده است.`,
        messageEn: `Digital gold ${symbol} is not verified as tradable on Bit24.`,
      };
    }

    if (this.emergencyStopped) {
      return {
        ok: false,
        messageFa: 'توقف اضطراری فعال است؛ خرید طلای دیجیتال مسدود است.',
        messageEn: 'Emergency stop is active; Gold buy blocked.',
      };
    }

    if (this.openPositions.some((p) => p.symbol === symbol)) {
      return {
        ok: false,
        messageFa: `پوزیشن باز روی ${symbol} از قبل فعال است (جلوگیری از خرید تکراری).`,
        messageEn: `Position already open on ${symbol} (duplicate blocked).`,
      };
    }

    const goldNotionalIrt = Math.min(5_000_000, Math.floor(this.goldDedicatedCashIrt * 0.2));
    if (goldNotionalIrt < market.minOrderIrt) {
      return {
        ok: false,
        messageFa: 'موجودی پرتفوی اختصاصی طلای دیجیتال کافی نیست.',
        messageEn: 'Insufficient dedicated Gold Demo balance.',
      };
    }

    const filledPrice = roundIrtPrice(market.priceIrt * 1.0008);
    const feeIrt = Math.round(goldNotionalIrt * 0.002);
    const qty = (goldNotionalIrt - feeIrt) / filledPrice;
    const slIrt = roundIrtPrice(filledPrice * 0.975); // 2.5% Gold Stop-Loss

    this.goldDedicatedCashIrt -= goldNotionalIrt;

    this.openPositions.push({
      id: `gold-pos-${nowMs}-${market.baseCoin}`,
      symbol,
      baseCoin: market.baseCoin,
      segment: 'GOLD',
      mode: 'DEMO',
      entryPriceIrt: filledPrice,
      currentPriceIrt: filledPrice,
      highestPriceIrt: filledPrice,
      initialQuantity: qty,
      remainingQuantity: qty,
      initialCapitalIrt: goldNotionalIrt,
      remainingCapitalIrt: goldNotionalIrt,
      entryFeeIrt: feeIrt,
      initialStopLossIrt: slIrt,
      activeStopLossIrt: slIrt,
      trailingStopActive: false,
      trailingStopPriceIrt: null,
      tpStage1Filled: false,
      tpStage2Filled: false,
      tpStage3Filled: false,
      unrealizedPnlIrt: 0,
      unrealizedPnlPct: 0,
      buyReasonFa: `GOLD AI TRADER (${goldSig.goldScore}/100): ${goldSig.rationaleFa}`,
      buyReasonEn: `GOLD AI TRADER (${goldSig.goldScore}/100): ${goldSig.rationaleEn}`,
      openedAt: nowMs,
    });

    this.emitTelegram(
      'DEMO_BUY',
      `خرید دمو طلای دیجیتال ${symbol}`,
      `مبلغ: ${goldNotionalIrt.toLocaleString()} تومان | قیمت ورود: ${filledPrice.toLocaleString()} تومان`
    );

    return {
      ok: true,
      messageFa: `پوزیشن آزمایشی طلای دیجیتال ${symbol} در پرتفوی مجزای طلا باز شد.`,
      messageEn: `Demo Gold position opened on ${symbol} in isolated Gold portfolio.`,
    };
  }

  private recordRejection(rej: TradeRejectionLog): void {
    // Avoid spamming identical symbol+code within 25 seconds
    const recentSame = this.rejectionLogs.find(
      (r) =>
        r.symbol === rej.symbol &&
        r.code === rej.code &&
        rej.timestamp - r.timestamp < 25_000
    );
    if (recentSame) return;

    this.rejectionLogs.unshift(rej);
    if (this.rejectionLogs.length > 80) this.rejectionLogs.length = 80;
  }

  // ==================== USER CONTROLS (9 ANDROID PANEL ACTIONS) ====================
  public startScanner(): void {
    this.scannerRunning = true;
    this.refreshSignals();
  }

  public stopScanner(): void {
    this.scannerRunning = false;
  }

  public startDemoTrading(): void {
    this.emergencyStopped = false;
    this.scannerRunning = true;
    this.tradingMode = 'DEMO';
    this.refreshSignals();
  }

  public stopTrading(): void {
    this.tradingMode = 'STOPPED';
    this.emitTelegram(
      'BOT_STOPPED',
      'توقف معاملات ربات',
      'معاملات خودکار توسط کاربر متوقف شد.'
    );
  }

  public async triggerEmergencyStop(liquidateDemoOpen = true): Promise<void> {
    this.emergencyStopped = true;
    this.tradingMode = 'STOPPED';

    if (liquidateDemoOpen) {
      const now = Date.now();
      for (let i = this.openPositions.length - 1; i >= 0; i--) {
        const pos = this.openPositions[i];
        if (pos.mode === 'DEMO') {
          await this.executeExitOrder(
            pos,
            i,
            pos.remainingQuantity,
            true,
            undefined,
            'بستن فوری در توقف اضطراری (EMERGENCY STOP)',
            'Immediate close triggered by EMERGENCY STOP',
            now
          );
        }
      }
    }

    this.emitTelegram(
      'BOT_STOPPED',
      'توقف اضطراری (EMERGENCY STOP) فعال شد',
      'کلیه سفارش‌های جدید مسدود و پوزیشن‌های آزمایشی تسویه شدند.'
    );
  }

  public clearEmergencyStop(): void {
    this.emergencyStopped = false;
    this.consecutiveTradeErrors = 0;
  }

  public setGoldAutoDemo(enabled: boolean): void {
    this.goldAutoDemoEnabled = enabled;
  }

  public updateRiskAndExitSettings(params: {
    capital?: Partial<CapitalRiskConfig>;
    exit?: Partial<ExitStrategyConfig>;
  }): void {
    if (params.capital) {
      const prevInit = this.capitalConfig.initialDemoBalanceIrt;
      this.capitalConfig = sanitizeCapitalRiskConfig(
        params.capital,
        this.capitalConfig
      );
      if (
        this.openPositions.filter((p) => p.segment === 'CRYPTO').length === 0 &&
        this.tradeHistory.filter((t) => t.segment === 'CRYPTO').length === 0 &&
        this.capitalConfig.initialDemoBalanceIrt !== prevInit
      ) {
        this.demoCashIrt = this.capitalConfig.initialDemoBalanceIrt;
      }
    }
    if (params.exit) {
      this.exitConfig = sanitizeExitStrategyConfig(params.exit, this.exitConfig);
    }
  }

  /**
   * Live trading stays strictly OFF until the user explicitly confirms AND Bit24 API keys are verified!
   */
  public activateLiveTradingAfterUserApproval(confirmationPhrase: string): {
    ok: boolean;
    messageFa: string;
    messageEn: string;
  } {
    if (confirmationPhrase.trim() !== 'CONFIRM_BIT24_LIVE') {
      return {
        ok: false,
        messageFa: 'عبارت تأیید نهایی نامعتبر است؛ حالت واقعی همچنان قفل است.',
        messageEn: 'Invalid confirmation phrase; Live mode remains locked.',
      };
    }
    if (this.bit24Health.state !== 'CONNECTED_PUBLIC_AND_PRIVATE') {
      return {
        ok: false,
        messageFa:
          'کلید API و کلید اختصاصی Bit24 هنوز به سرور رسمی متصل و تأیید نشده‌اند؛ ورود به حالت واقعی مجاز نیست.',
        messageEn:
          'Bit24 API & Secret keys are not verified against rest.bit24.cash; Live activation refused.',
      };
    }
    this.liveTradingUserConfirmed = true;
    this.emergencyStopped = false;
    this.tradingMode = 'LIVE';
    return {
      ok: true,
      messageFa: 'حالت معامله واقعی Bit24 با تأیید صریح شما فعال شد.',
      messageEn: 'Bit24 Live Trading activated with your explicit confirmation.',
    };
  }

  public runPro100Verification(): ProVerificationReport {
    this.latestVerificationReport = runProfessionalPreLiveVerification({
      capitalConfig: this.capitalConfig,
      exitConfig: this.exitConfig,
    });
    return this.latestVerificationReport;
  }

  // ==================== METRICS & REPORTS (CRYPTO VS GOLD SEPARATED) ====================
  public getCryptoDemoTotalEquityIrt(): number {
    const openCryptoVal = this.openPositions
      .filter((p) => p.segment === 'CRYPTO' && p.mode === 'DEMO')
      .reduce((acc, p) => acc + p.remainingQuantity * p.currentPriceIrt, 0);
    return Math.round(this.demoCashIrt + openCryptoVal);
  }

  public getCryptoDailyPnlIrt(): number {
    const cutoff = Date.now() - 24 * 3600_000;
    const realized24h = this.tradeHistory
      .filter((t) => t.segment === 'CRYPTO' && t.sellTime >= cutoff)
      .reduce((s, t) => s + t.netPnlIrt, 0);
    const unrealized = this.openPositions
      .filter((p) => p.segment === 'CRYPTO')
      .reduce((s, p) => s + p.unrealizedPnlIrt, 0);
    return Math.round(realized24h + unrealized);
  }

  public getCryptoDailyPnlPct(): number {
    const base = Math.max(1, this.capitalConfig.initialDemoBalanceIrt);
    return Number(((this.getCryptoDailyPnlIrt() / base) * 100).toFixed(2));
  }

  public buildPeriodSummary(
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY',
    segmentFilter: 'CRYPTO' | 'GOLD' | 'ALL' = 'CRYPTO'
  ): PeriodReportSummary {
    const now = Date.now();
    const windowMs =
      period === 'DAILY'
        ? 24 * 3600_000
        : period === 'WEEKLY'
        ? 7 * 24 * 3600_000
        : 30 * 24 * 3600_000;
    const fromTimestamp = now - windowMs;

    const trades = this.tradeHistory.filter(
      (t) =>
        t.sellTime >= fromTimestamp &&
        (segmentFilter === 'ALL' || t.segment === segmentFilter)
    );

    const winningTrades = trades.filter((t) => t.netPnlIrt > 0).length;
    const losingTrades = trades.filter((t) => t.netPnlIrt <= 0).length;
    const totalFeesIrt = trades.reduce((s, t) => s + t.totalFeeIrt, 0);
    const netPnlIrt = trades.reduce((s, t) => s + t.netPnlIrt, 0);
    const grossPnlIrt = netPnlIrt + totalFeesIrt;
    const baseCap =
      segmentFilter === 'GOLD'
        ? 50_000_000
        : this.capitalConfig.initialDemoBalanceIrt;

    return {
      period,
      fromTimestamp,
      toTimestamp: now,
      tradesCount: trades.length,
      winningTrades,
      losingTrades,
      winRatePct:
        trades.length > 0
          ? Number(((winningTrades / trades.length) * 100).toFixed(1))
          : 0,
      grossPnlIrt: Math.round(grossPnlIrt),
      totalFeesIrt: Math.round(totalFeesIrt),
      netPnlIrt: Math.round(netPnlIrt),
      netReturnPct:
        baseCap > 0 ? Number(((netPnlIrt / baseCap) * 100).toFixed(2)) : 0,
    };
  }

  public buildGoldPortfolioReport(): GoldPortfolioReport {
    const goldTrades = this.tradeHistory.filter((t) => t.segment === 'GOLD');
    const goldOpen = this.openPositions.filter((p) => p.segment === 'GOLD');
    const wins = goldTrades.filter((t) => t.netPnlIrt > 0).length;
    const losses = goldTrades.filter((t) => t.netPnlIrt <= 0).length;
    const netRealized = goldTrades.reduce((s, t) => s + t.netPnlIrt, 0);
    const fees = goldTrades.reduce((s, t) => s + t.totalFeeIrt, 0);

    return {
      paxgTradableOnBit24: Boolean(
        this.goldSignals.find((g) => g.baseCoin === 'PAXG')?.verifiedTradableOnBit24
      ),
      xautTradableOnBit24: Boolean(
        this.goldSignals.find((g) => g.baseCoin === 'XAUT')?.verifiedTradableOnBit24
      ),
      goldSignals: this.goldSignals,
      goldOpenPositions: goldOpen,
      goldClosedTrades: goldTrades,
      goldTotalTrades: goldTrades.length,
      goldWinningTrades: wins,
      goldLosingTrades: losses,
      goldWinRatePct:
        goldTrades.length > 0
          ? Number(((wins / goldTrades.length) * 100).toFixed(1))
          : 0,
      goldNetPnlIrt: Math.round(netRealized),
      goldTotalFeesIrt: Math.round(fees),
    };
  }

  public exportTradeHistoryCsv(): string {
    const header = [
      'Symbol',
      'Segment',
      'Mode',
      'BuyTimeISO',
      'BuyPriceIRT',
      'SellTimeISO',
      'SellPriceIRT',
      'CapitalEnteredIRT',
      'FeePaidIRT',
      'NetPnLIRT',
      'ReturnPct',
      'BuyReason',
      'SellReason',
    ].join(',');

    const escapeCsv = (val: string | number) =>
      `"${String(val).replace(/"/g, '""')}"`;

    const rows = this.tradeHistory.map((t) =>
      [
        escapeCsv(t.symbol),
        escapeCsv(t.segment),
        escapeCsv(t.mode),
        escapeCsv(new Date(t.buyTime).toISOString()),
        t.buyPriceIrt,
        escapeCsv(new Date(t.sellTime).toISOString()),
        t.sellPriceIrt,
        t.capitalEnteredIrt,
        t.totalFeeIrt,
        t.netPnlIrt,
        t.netPnlPct,
        escapeCsv(t.buyReasonFa),
        escapeCsv(t.sellReasonFa),
      ].join(',')
    );

    return [header, ...rows].join('\n');
  }

  public getSnapshot(): AppStatusSnapshot {
    const cryptoTrades = this.tradeHistory.filter((t) => t.segment === 'CRYPTO');
    const cryptoOpen = this.openPositions.filter((p) => p.segment === 'CRYPTO');
    const wins = cryptoTrades.filter((t) => t.netPnlIrt > 0).length;
    const losses = cryptoTrades.filter((t) => t.netPnlIrt <= 0).length;
    const realizedCryptoPnl = cryptoTrades.reduce((s, t) => s + t.netPnlIrt, 0);
    const unrealizedCryptoPnl = cryptoOpen.reduce(
      (s, p) => s + p.unrealizedPnlIrt,
      0
    );
    const totalPnlIrt = Math.round(realizedCryptoPnl + unrealizedCryptoPnl);
    const initBal = Math.max(1, this.capitalConfig.initialDemoBalanceIrt);
    const dailyPct = this.getCryptoDailyPnlPct();

    let capLevel: CapitalSecurityStatus['level'] = 'PROTECTED';
    let capFa = `ایمن و محافظت‌شده | سقف ریسک ${this.capitalConfig.riskPerTradePct}%، حداکثر ${this.capitalConfig.maxCapitalPerTradePct}% سرمایه در هر پوزیشن، دسترسی برداشت مسدود`;
    let capEn = `Protected | ${this.capitalConfig.riskPerTradePct}% risk/trade, max ${this.capitalConfig.maxCapitalPerTradePct}% allocation, withdrawal blocked`;

    if (this.emergencyStopped) {
      capLevel = 'HALTED_EMERGENCY';
      capFa = 'توقف اضطراری (EMERGENCY STOP) فعال است — هیچ سفارش جدیدی ارسال نمی‌شود';
      capEn = 'EMERGENCY STOP active — all new orders halted';
    } else if (
      this.capitalConfig.autoStopOnDailyLoss &&
      dailyPct <= -Math.abs(this.capitalConfig.maxDailyLossPct)
    ) {
      capLevel = 'HALTED_DAILY_LOSS';
      capFa = `توقف خودکار در حد ضرر روزانه (${dailyPct}%)`;
      capEn = `Auto-halted on Daily Loss Limit (${dailyPct}%)`;
    } else if (this.apiDisconnectedFault) {
      capLevel = 'HALTED_API_ERROR';
      capFa = 'توقف ایمن به دلیل قطعی ارتباط با API صرافی Bit24';
      capEn = 'Safely halted due to Bit24 API connection drop';
    } else if (dailyPct < -1.5) {
      capLevel = 'CAUTION';
      capFa = `هشدار مراقبت سرمایه: افت روزانه ${dailyPct}% (سقف مجاز -${this.capitalConfig.maxDailyLossPct}%)`;
      capEn = `Capital caution: Daily drawdown ${dailyPct}% (limit -${this.capitalConfig.maxDailyLossPct}%)`;
    }

    return {
      appName: 'BIT24 AI TRADER PRO',
      subtitleFa: 'ربات هوشمند معامله‌گر ارز دیجیتال و طلای دیجیتال (ویژه صرافی Bit24)',
      scannerRunning: this.scannerRunning,
      tradingMode: this.tradingMode,
      liveTradingUserConfirmed: this.liveTradingUserConfirmed,
      emergencyStopped: this.emergencyStopped,
      goldTradingEnabled: this.goldAutoDemoEnabled,
      demoBalanceIrt: this.getCryptoDemoTotalEquityIrt(),
      demoAvailableCashIrt: Math.round(this.demoCashIrt),
      dailyPnlIrt: this.getCryptoDailyPnlIrt(),
      dailyPnlPct: dailyPct,
      totalPnlIrt,
      totalPnlPct: Number(((totalPnlIrt / initBal) * 100).toFixed(2)),
      winningTrades: wins,
      losingTrades: losses,
      winRatePct:
        cryptoTrades.length > 0
          ? Number(((wins / cryptoTrades.length) * 100).toFixed(1))
          : 0,
      openPositions: cryptoOpen,
      topOpportunities: this.cryptoSignals,
      bit24Connection: this.bit24Health,
      capitalSecurity: {
        level: capLevel,
        dailyLossUsedPct: dailyPct,
        maxDailyLossPct: this.capitalConfig.maxDailyLossPct,
        openTradesCount: cryptoOpen.length,
        maxConcurrentTrades: this.capitalConfig.maxConcurrentTrades,
        consecutiveTradeErrors: this.consecutiveTradeErrors,
        summaryFa: capFa,
        summaryEn: capEn,
      },
      capitalConfig: this.capitalConfig,
      exitConfig: this.exitConfig,
      goldReport: this.buildGoldPortfolioReport(),
      recentRejections: this.rejectionLogs.slice(0, 25),
      tradeHistory: this.tradeHistory.slice(0, 120),
      periodReports: {
        daily: this.buildPeriodSummary('DAILY', 'CRYPTO'),
        weekly: this.buildPeriodSummary('WEEKLY', 'CRYPTO'),
        monthly: this.buildPeriodSummary('MONTHLY', 'CRYPTO'),
      },
      telegram: {
        ...this.telegramState,
        recentLogs: this.telegramLogs.slice(0, 20),
      },
      latestVerificationReport: this.latestVerificationReport,
      serverTimestamp: Date.now(),
    };
  }
}
