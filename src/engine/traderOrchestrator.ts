import { enforcePriceDeviation } from "../shared/priceDeviation.js";
import { ledgerAnalytics } from "./ledgerAnalytics.js";
import { newRequestId } from "../shared/identifiers.js";
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
} from "../shared/contracts.js";
import {
  buildSimulatedOrderBook,
  createInitialBit24Catalog,
  roundIrtPrice,
} from "./bit24Catalog.js";
import { computeMultiTimeframeChanges } from "./mathIndicators.js";
import { runProfessionalPreLiveVerification } from "./proVerificationSuite.js";
import {
  analyzeBit24CryptoPumpOpportunity,
  analyzeGoldAiMarket,
} from "./pumpAndGoldAnalyzers.js";
import {
  calculateSafePositionCapitalIrt,
  DEFAULT_CAPITAL_RISK_CONFIG,
  DEFAULT_EXIT_STRATEGY_CONFIG,
  evaluatePositionStepExit,
  runSmartSecurityGate,
  sanitizeCapitalRiskConfig,
  sanitizeExitStrategyConfig,
} from "./smartSecurityAndCapital.js";

export interface LiveOrderExecutor {
  checkLiveIrtBalance(): Promise<{
    ok: boolean;
    availableIrt: number;
    error?: string;
  }>;
  submitAndVerifySpotOrder(params: {
    baseCoin: string;
    quoteCoin: string;
    side: "BUY" | "SELL";
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
  safeSummary: string,
) => Promise<TelegramNotificationLog | void> | void;

export class Bit24AiTraderOrchestrator {
  private markets: Bit24TickerMarket[] = [];
  private candlesBySymbol = new Map<string, CandleBar[]>();
  private orderBooksBySymbol = new Map<string, OrderBookDepth>();

  private scannerRunning = true;
  private tradingMode: "STOPPED" | "DEMO" | "LIVE" = "STOPPED";
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
    state: "NOT_CONFIGURED",
    hasApiKey: false,
    hasSecretKey: false,
    maskedApiKey: "",
    withdrawalPermissionBlocked: true,
    baseUrl: "https://rest.bit24.cash",
    lastCheckedAt: null,
    latencyMs: null,
    activeMarketFeed: "SIMULATED_MARKET_FEED",
    messageFa:
      "اطلاعات فرضی — هیچ اتصال زنده، معاملهٔ واقعی یا ارسال تلگرام وجود ندارد.",
    messageEn:
      "SIMULATED DATA ONLY; exchange connectivity, real trading and external notifications are disabled.",
  };

  private telegramState = {
    configured: false,
    enabled: false,
    maskedChatId: "",
  };

  private liveExecutor?: LiveOrderExecutor; // Never attached in this DEMO-only build.
  private paperOrders: import("../shared/contracts.js").PaperOrder[] = [];
  private cashAdjustments: { id: string; amountIrt: number; at: number }[] = [];
  private daily = {
    day: new Date().toISOString().slice(0, 10),
    baseline: 150_000_000,
    cashFlow: 0,
    halted: false,
    haltedUntil: 0,
  };
  private cycleBusy = false;
  private onTelegramDispatch?: TelegramAlertDispatcher;

  constructor(opts?: {
    liveExecutor?: LiveOrderExecutor;
    onTelegramDispatch?: TelegramAlertDispatcher;
  }) {
    // Deliberately ignore outbound adapters: no exchange or Telegram traffic in Demo.
    void opts;

    const init = createInitialBit24Catalog();
    this.markets = init.markets;
    this.candlesBySymbol = init.candlesBySymbol;
    for (const m of this.markets) {
      const candles = this.candlesBySymbol.get(m.symbol) || [];
      this.orderBooksBySymbol.set(
        m.symbol,
        buildSimulatedOrderBook(m, candles),
      );
    }
    this.refreshSignals();
  }

  public setBit24Health(health: Partial<Bit24ApiHealth>): void {
    void health; // External feed activation is disabled.
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
    safeSummary: string,
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
    void liveMarkets;
    throw new Error("LIVE_DISABLED_DEMO_ONLY");
  }

  /**
   * Advances simulated market feed by one realistic tick when offline/demo,
   * updates open positions (SL, Trailing Stop, Stepped TP), and executes Demo/Live signals!
   */
  public async stepCycle(): Promise<void> {
    if (this.cycleBusy) throw new Error("CYCLE_ALREADY_RUNNING");
    this.cycleBusy = true;
    try {
      await this.advanceCycle();
    } finally {
      this.cycleBusy = false;
    }
  }
  private async advanceCycle(): Promise<void> {
    this.rollDay();
    const now = Date.now();

    // Update simulated ticks when not receiving live API stream
    if (this.bit24Health.activeMarketFeed === "SIMULATED_MARKET_FEED") {
      for (const m of this.markets) {
        const bars = this.candlesBySymbol.get(m.symbol) || [];
        const prev = bars[bars.length - 1]?.c || m.priceIrt;
        const jitter = Math.sin(now / 7000 + m.symbol.charCodeAt(0)) * 0.0006;
        const nextPrice = roundIrtPrice(Math.max(0.0001, prev * (1 + jitter)));
        const high = roundIrtPrice(Math.max(prev, nextPrice) * 1.0015);
        const low = roundIrtPrice(Math.min(prev, nextPrice) * 0.9985);
        const avgVol = Math.max(
          1,
          m.volume24hIrt / 1440 / Math.max(0.0001, m.priceIrt),
        );
        const volMult = jitter > 0.001 ? 1.55 : 0.98;

        const bar: CandleBar = {
          t: Math.max(
            Math.floor(now / 60_000) * 60,
            bars[bars.length - 1]?.t ?? 0,
          ),
          o: prev,
          h: high,
          l: low,
          c: nextPrice,
          v: Number((avgVol * volMult).toFixed(4)),
        };
        const sameMinute = bars[bars.length - 1]?.t === bar.t;
        if (sameMinute) {
          const old = bars[bars.length - 1];
          bar.o = old.o;
          bar.h = Math.max(old.h, bar.h);
          bar.l = Math.min(old.l, bar.l);
        }
        const nextBars = [
          ...bars.slice(sameMinute ? -180 : -179, sameMinute ? -1 : undefined),
          bar,
        ];
        this.candlesBySymbol.set(m.symbol, nextBars);
        const mtf = computeMultiTimeframeChanges(nextBars);

        m.priceIrt = nextPrice;
        m.change1mPct = mtf.change1mPct;
        m.change5mPct = mtf.change5mPct;
        m.change15mPct = mtf.change15mPct;
        m.change60mPct = mtf.change60mPct;
        m.updatedAt = now;

        this.orderBooksBySymbol.set(
          m.symbol,
          buildSimulatedOrderBook(m, nextBars),
        );
      }
    }

    // Latch observed drawdown before exits can reduce exposure or realize gains.
    this.enforceDailyLimit();
    // Existing protective exits continue even while new entries are halted.
    await this.enforceDailyLiquidation();
    await this.manageOpenPositions(now);

    this.enforceDailyLimit();

    // Refresh scanner signals if scanner is running
    if (this.scannerRunning) {
      this.refreshSignals();
    }

    // Every entry needs a manual warning/confirmation. Protective exits remain automatic.
  }

  public refreshSignals(): void {
    const nextCrypto: PumpOpportunitySignal[] = [];
    const nextGold: GoldMarketSignal[] = [];

    for (const m of this.markets) {
      const candles = this.candlesBySymbol.get(m.symbol) || [];
      const ob =
        this.orderBooksBySymbol.get(m.symbol) ||
        buildSimulatedOrderBook(m, candles);

      if (m.segment === "CRYPTO") {
        const sig = analyzeBit24CryptoPumpOpportunity(m, candles, ob);
        nextCrypto.push(sig);

        // Optional Telegram alert for new high-score pump candidates (throttled per 15 min)
        if (sig.opportunityScore >= 85) {
          const prevAlert = this.lastAlertedPumpBySymbol.get(sig.symbol) || 0;
          if (Date.now() - prevAlert > 15 * 60_000) {
            this.lastAlertedPumpBySymbol.set(sig.symbol, Date.now());
            this.emitTelegram(
              "PUMP_CANDIDATE",
              `رمزارز مستعد رشد: ${sig.symbol} (${sig.opportunityScore}/100)`,
              `قیمت: ${sig.priceIrt.toLocaleString()} تومان | قدرت خریدار: ${sig.indicators.buyerPowerPct}% | حجم: ${sig.indicators.volumeSurgeRatio}x`,
            );
          }
        }
      }
    }

    // Evaluate PAXG/IRT and XAUT/IRT independently for GOLD AI TRADER
    for (const goldCoin of ["PAXG", "XAUT"] as const) {
      const sym = `${goldCoin}/IRT` as const;
      const gm = this.markets.find(
        (x) => x.symbol === sym && x.segment === "GOLD",
      );
      const gCandles = this.candlesBySymbol.get(sym) || [];
      const gBook = gm ? this.orderBooksBySymbol.get(sym) : undefined;
      nextGold.push(
        analyzeGoldAiMarket(
          sym,
          goldCoin,
          gm,
          gCandles,
          gBook,
          this.exitConfig.initialStopLossPct,
          this.exitConfig.tpStage1ProfitPct,
        ),
      );
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
      const barLow = lastBar
        ? Math.min(lastBar.l, market.priceIrt)
        : market.priceIrt;
      const barHigh = lastBar
        ? Math.max(lastBar.h, market.priceIrt)
        : market.priceIrt;

      const exitCfg = pos.exitSettings ?? this.exitConfig;

      const decision = evaluatePositionStepExit(
        pos,
        market.priceIrt,
        market.priceIrt,
        market.priceIrt,
        exitCfg,
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
        nowMs,
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
    nowMs: number,
  ): Promise<void> {
    const market = this.markets.find((m) => m.symbol === pos.symbol);
    const ob = this.orderBooksBySymbol.get(pos.symbol);
    const rawPrice = market?.priceIrt || pos.currentPriceIrt;
    const slippagePct = ob?.estimatedSlippagePct || 0.08;

    let filledSellPrice = roundIrtPrice(rawPrice * (1 - slippagePct / 100));
    let sellFeeIrt = sellQuantity * filledSellPrice * 0.002;

    if (pos.mode !== "DEMO") throw new Error("LIVE_DISABLED_DEMO_ONLY");
    sellQuantity = Math.min(sellQuantity, pos.remainingQuantity);
    if (!Number.isFinite(sellQuantity) || sellQuantity <= 0)
      throw new Error("INVALID_SELL_QUANTITY");
    sellFeeIrt = sellQuantity * filledSellPrice * 0.002;

    if (stageTriggered === 1) pos.tpStage1Filled = true;
    if (stageTriggered === 2) pos.tpStage2Filled = true;
    if (stageTriggered === 3) pos.tpStage3Filled = true;

    const grossProceedsIrt = sellQuantity * filledSellPrice;
    const netProceedsIrt = grossProceedsIrt - sellFeeIrt;
    const fraction = Math.min(1, sellQuantity / pos.remainingQuantity);
    const capitalPortion = pos.remainingCapitalIrt * fraction;
    const entryFeePortion =
      pos.entryFeeIrt * (sellQuantity / pos.initialQuantity);
    const totalFeeIrt = entryFeePortion + sellFeeIrt;
    const slippageCostIrt = Math.round(
      sellQuantity * rawPrice * (slippagePct / 100),
    );
    const netPnlIrt = netProceedsIrt - capitalPortion;
    const netPnlPct =
      capitalPortion > 0
        ? Number(((netPnlIrt / capitalPortion) * 100).toFixed(2))
        : 0;

    if (pos.mode === "DEMO") {
      if (pos.segment === "GOLD") {
        this.goldDedicatedCashIrt += netProceedsIrt;
      } else {
        this.demoCashIrt += netProceedsIrt;
      }
    }

    const record: TradeHistoryRecord = {
      id: "trd-" + newRequestId(),
      positionId: pos.id,
      symbol: pos.symbol,
      segment: pos.segment,
      mode: pos.mode,
      buyTime: pos.openedAt,
      buyPriceIrt: pos.entryPriceIrt,
      sellTime: nowMs,
      sellPriceIrt: filledSellPrice,
      quantity: sellQuantity,
      capitalEnteredIrt: capitalPortion,
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
    this.paperOrders.push({
      id: `order-sell-${record.id}`,
      symbol: pos.symbol,
      side: "SELL",
      mode: "DEMO",
      quantity: sellQuantity,
      priceIrt: filledSellPrice,
      feeIrt: sellFeeIrt,
      at: nowMs,
      source: stageTriggered
        ? "TAKE_PROFIT"
        : sellReasonEn.includes("Stop")
          ? "STOP_LOSS"
          : "MANUAL_OR_AUTO",
    });

    pos.remainingQuantity = Math.max(0, pos.remainingQuantity - sellQuantity);
    pos.remainingCapitalIrt = Math.max(
      0,
      pos.remainingCapitalIrt - capitalPortion,
    );

    if (
      closeEntirePosition ||
      pos.remainingQuantity <= pos.initialQuantity * 1e-12
    ) {
      this.openPositions.splice(posIndex, 1);
    }

    const tgType: TelegramEventType = stageTriggered
      ? "TAKE_PROFIT_HIT"
      : netPnlIrt < 0
        ? "STOP_LOSS_HIT"
        : "DEMO_SELL";
    this.emitTelegram(
      tgType,
      `فروش ${pos.mode === "DEMO" ? "دمو" : "واقعی"} ${pos.symbol}`,
      `قیمت فروش: ${filledSellPrice.toLocaleString()} تومان | سود/زیان خالص: ${netPnlIrt.toLocaleString()} تومان (${netPnlPct}%) | علت: ${sellReasonFa}`,
    );

    this.markPositions();
    this.enforceDailyLimit();
  }

  public async tryOpenCryptoPosition(
    sig: PumpOpportunitySignal,
    nowMs = Date.now(),
    referencePriceIrt?: number,
  ): Promise<{
    ok: boolean;
    code?: string;
    messageFa: string;
    messageEn: string;
  }> {
    const market = this.markets.find((m) => m.symbol === sig.symbol);
    const ob = this.orderBooksBySymbol.get(sig.symbol);
    if (!market || !ob) {
      return {
        ok: false,
        messageFa: "بازار موردنظر در لیست Bit24 یافت نشد.",
        messageEn: "Market not found on Bit24.",
      };
    }

    this.enforceDailyLimit();
    const mode = "DEMO" as const;
    const gate = runSmartSecurityGate({
      nowMs,
      symbol: sig.symbol,
      mode,
      market,
      orderBook: ob,
      openPositions: this.openPositions,
      inFlightSymbols: this.inFlightSymbols,
      dailyLossPctSoFar: this.daily.halted
        ? -this.capitalConfig.maxDailyLossPct
        : this.getCryptoDailyPnlPct(),
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
        code: gate.rejection.code,
        messageFa: gate.rejection.reasonFa,
        messageEn: gate.rejection.reasonEn,
      };
    }

    let availableCashIrt = this.demoCashIrt;
    let totalEquityIrt = this.getCryptoDemoTotalEquityIrt();

    const capitalIrt = calculateSafePositionCapitalIrt({
      totalEquityIrt,
      availableCashIrt,
      stopLossPct: this.exitConfig.initialStopLossPct + 0.6,
      capitalConfig: this.capitalConfig,
    });

    if (capitalIrt < market.minOrderIrt) {
      const rej: TradeRejectionLog = {
        id: `rej-bal-${nowMs}`,
        timestamp: nowMs,
        symbol: sig.symbol,
        code: "INSUFFICIENT_BALANCE",
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
      let filledPriceIrt = roundIrtPrice(
        market.priceIrt * (1 + slippagePct / 100),
      );
      try {
        enforcePriceDeviation(
          (referencePriceIrt ?? market.priceIrt).toFixed(12),
          filledPriceIrt.toFixed(12),
        );
      } catch {
        return {
          ok: false,
          code: "SLIPPAGE_ABOVE_0_3_PERCENT",
          messageFa: "انحراف قیمت بیش از ۰٫۳٪؛ سفارش لغو شد.",
          messageEn: "Entry quote deviation exceeds 0.3%; no order.",
        };
      }
      let entryFeeIrt = Math.round((capitalIrt / 1.002) * 0.002);
      const estQty = (capitalIrt - entryFeeIrt) / filledPriceIrt;

      this.demoCashIrt -= capitalIrt;

      const finalQty = (capitalIrt - entryFeeIrt) / filledPriceIrt;
      const initialSlIrt = roundIrtPrice(
        filledPriceIrt * (1 - this.exitConfig.initialStopLossPct / 100),
      );

      const buyReasonFa = `امتیاز هوش مصنوعی ${sig.opportunityScore}/100 | ${sig.reasonsFa.slice(0, 2).join(" + ")}`;
      const buyReasonEn = `AI Score ${sig.opportunityScore}/100 | ${sig.reasonsEn.slice(0, 2).join(" + ")}`;

      this.openPositions.push({
        id: "pos-" + newRequestId(),
        symbol: sig.symbol,
        baseCoin: sig.baseCoin,
        segment: "CRYPTO",
        mode,
        exitSettings: { ...this.exitConfig },
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

      this.paperOrders.push({
        id: "order-" + newRequestId(),
        symbol: sig.symbol,
        side: "BUY",
        mode: "DEMO",
        quantity: finalQty,
        priceIrt: filledPriceIrt,
        feeIrt: entryFeeIrt,
        at: nowMs,
        source: "MANUAL_OR_AUTO",
      });
      this.markPositions();
      this.enforceDailyLimit();
      this.emitTelegram(
        "DEMO_BUY",
        `خرید ${mode === "DEMO" ? "آزمایشی (Demo)" : "واقعی"} ${sig.symbol}`,
        `سرمایه: ${capitalIrt.toLocaleString()} تومان | قیمت ورود: ${filledPriceIrt.toLocaleString()} تومان | حد ضرر: ${initialSlIrt.toLocaleString()} تومان`,
      );

      return {
        ok: true,
        messageFa: `خرید ${mode === "DEMO" ? "آزمایشی" : "واقعی"} ${sig.symbol} با موفقیت ثبت شد.`,
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
    symbol: "PAXG/IRT" | "XAUT/IRT",
    nowMs = Date.now(),
    referencePriceIrt?: number,
  ): Promise<{
    ok: boolean;
    code?: string;
    messageFa: string;
    messageEn: string;
  }> {
    const goldSig = this.goldSignals.find((g) => g.symbol === symbol);
    const market = this.markets.find(
      (m) => m.symbol === symbol && m.segment === "GOLD",
    );
    if (!goldSig || !goldSig.verifiedTradableOnBit24 || !market) {
      return {
        ok: false,
        messageFa: `نماد طلای دیجیتال ${symbol} در صرافی Bit24 قابل معامله تأیید نشده است.`,
        messageEn: `Digital gold ${symbol} is not verified as tradable on Bit24.`,
      };
    }

    this.enforceDailyLimit();
    if (this.emergencyStopped || this.daily.halted)
      return {
        ok: false,
        code: this.daily.halted ? "DAILY_LOSS_LIMIT" : "EMERGENCY_STOP_ACTIVE",
        messageFa: "توقف ایمنی فعال است.",
        messageEn: "Safety halt active.",
      };
    if (this.openPositions.some((p) => p.symbol === symbol))
      return {
        ok: false,
        code: "DUPLICATE_ORDER",
        messageFa: "روی این نماد پوزیشن باز وجود دارد.",
        messageEn: "Duplicate position.",
      };
    if (this.openPositions.length >= this.capitalConfig.maxConcurrentTrades)
      return {
        ok: false,
        code: "MAX_CONCURRENT_REACHED",
        messageFa: "سقف مشترک معاملات هم‌زمان تکمیل است.",
        messageEn: "Global capacity full.",
      };
    const equity =
      this.goldDedicatedCashIrt +
      this.openPositions
        .filter((p) => p.segment === "GOLD")
        .reduce((v, p) => v + p.remainingQuantity * p.currentPriceIrt, 0);
    const goldNotionalIrt = calculateSafePositionCapitalIrt({
      totalEquityIrt: equity,
      availableCashIrt: this.goldDedicatedCashIrt,
      stopLossPct: this.exitConfig.initialStopLossPct + 0.6,
      capitalConfig: this.capitalConfig,
    });
    if (goldNotionalIrt < market.minOrderIrt) {
      return {
        ok: false,
        messageFa: "موجودی پرتفوی اختصاصی طلای دیجیتال کافی نیست.",
        messageEn: "Insufficient dedicated Gold Demo balance.",
      };
    }

    const filledPrice = roundIrtPrice(market.priceIrt * 1.0008);
    try {
      enforcePriceDeviation(
        (referencePriceIrt ?? market.priceIrt).toFixed(12),
        filledPrice.toFixed(12),
      );
    } catch {
      return {
        ok: false,
        code: "SLIPPAGE_ABOVE_0_3_PERCENT",
        messageFa: "انحراف قیمت بیش از ۰٫۳٪؛ سفارش لغو شد.",
        messageEn: "Entry quote deviation exceeds 0.3%; no order.",
      };
    }
    const feeIrt = Math.round((goldNotionalIrt / 1.002) * 0.002);
    const qty = (goldNotionalIrt - feeIrt) / filledPrice;
    const slIrt = roundIrtPrice(
      filledPrice * (1 - this.exitConfig.initialStopLossPct / 100),
    ); // Uses the same configured protective stop as the execution engine.

    this.goldDedicatedCashIrt -= goldNotionalIrt;

    this.openPositions.push({
      id: "gold-pos-" + newRequestId(),
      symbol,
      baseCoin: market.baseCoin,
      segment: "GOLD",
      mode: "DEMO",
      exitSettings: { ...this.exitConfig },
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
      "DEMO_BUY",
      `خرید دمو طلای دیجیتال ${symbol}`,
      `مبلغ: ${goldNotionalIrt.toLocaleString()} تومان | قیمت ورود: ${filledPrice.toLocaleString()} تومان`,
    );

    this.paperOrders.push({
      id: "order-" + newRequestId(),
      symbol,
      side: "BUY",
      mode: "DEMO",
      quantity: qty,
      priceIrt: filledPrice,
      feeIrt,
      at: nowMs,
      source: "MANUAL_OR_AUTO",
    });
    this.markPositions();
    this.enforceDailyLimit();
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
        rej.timestamp - r.timestamp < 25_000,
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
    this.enforceDailyLimit();
    if (this.emergencyStopped || this.daily.halted)
      throw new Error("SAFETY_HALT_ACTIVE");
    this.scannerRunning = true;
    this.tradingMode = "DEMO";
    this.refreshSignals();
  }

  public stopTrading(): void {
    this.tradingMode = "STOPPED";
    this.emitTelegram(
      "BOT_STOPPED",
      "توقف معاملات ربات",
      "معاملات خودکار توسط کاربر متوقف شد.",
    );
  }

  public async closeDemoPosition(
    symbol: string,
  ): Promise<{ ok: boolean; error?: string; messageFa: string }> {
    const index = this.openPositions.findIndex((p) => p.symbol === symbol);
    if (index < 0)
      return {
        ok: false,
        error: "POSITION_NOT_FOUND",
        messageFa: "پوزیشن باز برای این نماد وجود ندارد.",
      };
    const pos = this.openPositions[index];
    if (pos.mode !== "DEMO")
      return {
        ok: false,
        error: "DEMO_ONLY",
        messageFa: "این مسیر فقط فروش آزمایشی انجام می‌دهد.",
      };
    await this.executeExitOrder(
      pos,
      index,
      pos.remainingQuantity,
      true,
      undefined,
      "فروش دستی آزمایشی از پنل",
      "Manual demo sell from dashboard",
      Date.now(),
    );
    return { ok: true, messageFa: "فروش آزمایشی انجام شد." };
  }

  public async triggerEmergencyStop(liquidateDemoOpen = true): Promise<void> {
    this.emergencyStopped = true;
    this.scannerRunning = false;
    this.tradingMode = "STOPPED";

    if (liquidateDemoOpen) {
      const now = Date.now();
      for (let i = this.openPositions.length - 1; i >= 0; i--) {
        const pos = this.openPositions[i];
        if (pos.mode === "DEMO") {
          await this.executeExitOrder(
            pos,
            i,
            pos.remainingQuantity,
            true,
            undefined,
            "بستن فوری در توقف اضطراری (EMERGENCY STOP)",
            "Immediate close triggered by EMERGENCY STOP",
            now,
          );
        }
      }
    }

    this.emitTelegram(
      "BOT_STOPPED",
      "توقف اضطراری (EMERGENCY STOP) فعال شد",
      "کلیه سفارش‌های جدید مسدود و پوزیشن‌های آزمایشی تسویه شدند.",
    );
  }

  public clearEmergencyStop(): void {
    this.emergencyStopped = false;
    this.consecutiveTradeErrors = 0;
  }

  public setGoldAutoDemo(enabled: boolean): void {
    if (enabled) throw new Error("MANUAL_CONFIRMATION_REQUIRED");
    this.goldAutoDemoEnabled = false;
  }

  public updateRiskAndExitSettings(params: {
    capital?: Partial<CapitalRiskConfig>;
    exit?: Partial<ExitStrategyConfig>;
  }): void {
    if (params.capital) {
      const prevInit = this.capitalConfig.initialDemoBalanceIrt;
      this.capitalConfig = sanitizeCapitalRiskConfig(
        {
          ...params.capital,
          initialDemoBalanceIrt:
            this.tradeHistory.length ||
            this.openPositions.length ||
            this.cashAdjustments.length
              ? this.capitalConfig.initialDemoBalanceIrt
              : (params.capital.initialDemoBalanceIrt ??
                this.capitalConfig.initialDemoBalanceIrt),
          autoStopOnDailyLoss: true,
        },
        this.capitalConfig,
      );
      if (
        this.openPositions.filter((p) => p.segment === "CRYPTO").length === 0 &&
        this.tradeHistory.filter((t) => t.segment === "CRYPTO").length === 0 &&
        this.capitalConfig.initialDemoBalanceIrt !== prevInit
      ) {
        const delta =
          this.capitalConfig.initialDemoBalanceIrt - this.demoCashIrt;
        this.demoCashIrt = this.capitalConfig.initialDemoBalanceIrt;
        this.daily.baseline += delta;
      }
    }
    if (params.exit) {
      this.exitConfig = sanitizeExitStrategyConfig(
        params.exit,
        this.exitConfig,
      );
      // Existing positions retain their entry stop: settings apply to future positions.
    }
    this.enforceDailyLimit();
  }

  /**
   * Live trading stays strictly OFF until the user explicitly confirms AND Bit24 API keys are verified!
   */
  public activateLiveTradingAfterUserApproval(confirmationPhrase: string): {
    ok: boolean;
    messageFa: string;
    messageEn: string;
  } {
    void confirmationPhrase;
    return {
      ok: false,
      messageFa: "حالت Live در این نسخه کاملاً غیرفعال است.",
      messageEn: "LIVE_DISABLED_DEMO_ONLY",
    };
  }

  private rollDay(): void {
    const now = Date.now(),
      day = new Date(now).toISOString().slice(0, 10);
    // A midnight rollover must NEVER bypass the 24-hour safety cooldown.
    if (this.daily.halted && now >= this.daily.haltedUntil) {
      this.daily = {
        day,
        baseline: this.totalLiquidationEquity(),
        cashFlow: 0,
        halted: false,
        haltedUntil: 0,
      };
    } else if (day !== this.daily.day) {
      this.daily = {
        day,
        baseline: this.totalLiquidationEquity(),
        cashFlow: 0,
        halted: this.daily.halted,
        haltedUntil: this.daily.haltedUntil,
      };
    }
  }
  private totalLiquidationEquity(): number {
    return (
      this.demoCashIrt +
      this.goldDedicatedCashIrt +
      this.openPositions.reduce(
        (v, p) => v + p.remainingCapitalIrt + p.unrealizedPnlIrt,
        0,
      )
    );
  }
  private markPositions(): void {
    for (const p of this.openPositions) {
      const m = this.markets.find((m) => m.symbol === p.symbol);
      if (!m) continue;
      p.currentPriceIrt = m.priceIrt;
      const slip =
        this.orderBooksBySymbol.get(p.symbol)?.estimatedSlippagePct ?? 0.08;
      const liquidationPrice = roundIrtPrice(m.priceIrt * (1 - slip / 100));
      p.unrealizedPnlIrt =
        p.remainingQuantity * liquidationPrice * 0.998 - p.remainingCapitalIrt;
      p.unrealizedPnlPct =
        (p.unrealizedPnlIrt / Math.max(1, p.remainingCapitalIrt)) * 100;
    }
  }
  private enforceDailyLimit(): void {
    this.rollDay();
    this.markPositions();
    if (
      !this.daily.halted &&
      this.getCryptoDailyPnlPct() <= -this.capitalConfig.maxDailyLossPct
    ) {
      this.daily.halted = true;
      this.daily.haltedUntil = Date.now() + 24 * 3600_000;
    }
    if (this.daily.halted) this.tradingMode = "STOPPED";
  }
  /** Called inside the durable server transaction; closes ALL segments after a global loss breach. */
  public async enforceDailyLiquidation(): Promise<void> {
    this.enforceDailyLimit();
    if (!this.daily.halted) return;
    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const p = this.openPositions[i];
      await this.executeExitOrder(
        p,
        i,
        p.remainingQuantity,
        true,
        undefined,
        "تسویهٔ حد زیان سراسری؛ توقف حداقل ۲۴ ساعت",
        "Global daily-loss liquidation; 24h cooldown",
        Date.now(),
      );
    }
    this.markPositions();
  }
  public adjustDemoCash(amountIrt: number): { ok: boolean; messageFa: string } {
    this.rollDay();
    if (
      !Number.isSafeInteger(amountIrt) ||
      amountIrt === 0 ||
      Math.abs(amountIrt) > 1_000_000_000 ||
      this.demoCashIrt + amountIrt < 0
    )
      throw new Error("INVALID_PAPER_CASH_ADJUSTMENT");
    this.demoCashIrt += amountIrt;
    this.daily.cashFlow += amountIrt;
    this.cashAdjustments.push({
      id: `cash-${Date.now()}-${this.cashAdjustments.length}`,
      amountIrt,
      at: Date.now(),
    });
    return {
      ok: true,
      messageFa: "موجودی کاغذی اصلاح شد؛ هیچ واریز یا برداشت واقعی انجام نشد.",
    };
  }
  /** Deterministic test/replay hook, intentionally NOT exposed through HTTP. */
  public async observeDemoPrice(symbol: string, price: number): Promise<void> {
    if (!Number.isFinite(price) || price <= 0) throw new Error("INVALID_PRICE");
    const market = this.markets.find((m) => m.symbol === symbol);
    if (!market) throw new Error("UNKNOWN_SYMBOL");
    market.priceIrt = price;
    market.updatedAt = Date.now();
    this.enforceDailyLimit();
    await this.enforceDailyLiquidation();
    await this.manageOpenPositions(Date.now());
    this.markPositions();
    this.enforceDailyLimit();
    this.refreshSignals();
  }
  public exportDemoState() {
    return structuredClone({
      capitalConfig: this.capitalConfig,
      exitConfig: this.exitConfig,
      demoCashIrt: this.demoCashIrt,
      goldDedicatedCashIrt: this.goldDedicatedCashIrt,
      openPositions: this.openPositions,
      tradeHistory: this.tradeHistory,
      paperOrders: this.paperOrders,
      cashAdjustments: this.cashAdjustments,
      daily: this.daily,
      markets: this.markets,
      candles: [...this.candlesBySymbol],
      books: [...this.orderBooksBySymbol],
      emergencyStopped: this.emergencyStopped,
      scannerRunning: this.scannerRunning,
      tradingMode: this.tradingMode,
      goldAutoDemoEnabled: this.goldAutoDemoEnabled,
      rejectionLogs: this.rejectionLogs,
    });
  }
  public restoreDemoState(
    state: ReturnType<Bit24AiTraderOrchestrator["exportDemoState"]>,
  ): void {
    if (
      state.tradingMode === "LIVE" ||
      state.openPositions.some((p) => p.mode !== "DEMO") ||
      state.tradeHistory.some((t) => t.mode !== "DEMO") ||
      state.demoCashIrt < 0 ||
      state.goldDedicatedCashIrt < 0
    )
      throw new Error("INVALID_DEMO_STATE");
    const x = structuredClone(state);
    this.capitalConfig = x.capitalConfig;
    this.exitConfig = x.exitConfig;
    this.demoCashIrt = x.demoCashIrt;
    this.goldDedicatedCashIrt = x.goldDedicatedCashIrt;
    this.openPositions = x.openPositions;
    this.tradeHistory = x.tradeHistory;
    this.paperOrders = x.paperOrders;
    this.cashAdjustments = x.cashAdjustments;
    this.daily = {
      ...x.daily,
      haltedUntil:
        x.daily.haltedUntil ?? (x.daily.halted ? Date.now() + 86400000 : 0),
    };
    this.markets = x.markets;
    // v2 synthetic candles accidentally used millisecond-like OPEN times with 60-unit steps.
    // Rebase ONLY that recognizable Demo fixture clock; never rewrite trade execution timestamps.
    const endSecond = Math.floor(Date.now() / 60000) * 60;
    for (const [, bars] of x.candles) {
      if (bars.length && bars.every((b) => b.t >= 100_000_000_000)) {
        bars.forEach((b, i) => {
          b.t = endSecond - (bars.length - 1 - i) * 60;
        });
      }
    }
    this.candlesBySymbol = new Map(x.candles);
    this.orderBooksBySymbol = new Map(x.books);
    this.emergencyStopped = x.emergencyStopped;
    this.scannerRunning = x.scannerRunning;
    this.tradingMode = x.tradingMode;
    this.goldAutoDemoEnabled = x.goldAutoDemoEnabled;
    this.rejectionLogs = x.rejectionLogs;
    this.inFlightSymbols.clear();
    this.liveTradingUserConfirmed = false;
    this.markPositions();
    this.enforceDailyLimit();
    this.refreshSignals();
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
      .filter((p) => p.segment === "CRYPTO" && p.mode === "DEMO")
      .reduce((acc, p) => acc + p.remainingCapitalIrt + p.unrealizedPnlIrt, 0);
    return Math.round(this.demoCashIrt + openCryptoVal);
  }

  public getCryptoDailyPnlIrt(): number {
    this.rollDay();
    return (
      this.totalLiquidationEquity() - this.daily.baseline - this.daily.cashFlow
    );
  }
  public getCryptoDailyPnlPct(): number {
    return (
      (this.getCryptoDailyPnlIrt() / Math.max(1, this.daily.baseline)) * 100
    );
  }

  private completedPositions(segment: "CRYPTO" | "GOLD" | "ALL") {
    const groups = new Map<string, { pnl: number; closedAt: number }>();
    const openIds = new Set(this.openPositions.map((p) => p.id));
    for (const t of this.tradeHistory) {
      if (segment !== "ALL" && t.segment !== segment) continue;
      const id = t.positionId ?? t.id;
      if (openIds.has(id)) continue;
      const g = groups.get(id) ?? { pnl: 0, closedAt: 0 };
      g.pnl += t.netPnlIrt;
      g.closedAt = Math.max(g.closedAt, t.sellTime);
      groups.set(id, g);
    }
    return [...groups.values()];
  }

  public buildPeriodSummary(
    period: "DAILY" | "WEEKLY" | "MONTHLY",
    segmentFilter: "CRYPTO" | "GOLD" | "ALL" = "CRYPTO",
  ): PeriodReportSummary {
    const now = Date.now();
    const windowMs =
      period === "DAILY"
        ? 24 * 3600_000
        : period === "WEEKLY"
          ? 7 * 24 * 3600_000
          : 30 * 24 * 3600_000;
    const fromTimestamp = now - windowMs;

    const trades = this.tradeHistory.filter(
      (t) =>
        t.sellTime >= fromTimestamp &&
        (segmentFilter === "ALL" || t.segment === segmentFilter),
    );

    const completed = this.completedPositions(segmentFilter).filter(
      (p) => p.closedAt >= fromTimestamp,
    );
    const winningTrades = completed.filter((p) => p.pnl > 0).length;
    const losingTrades = completed.filter((p) => p.pnl <= 0).length;
    const totalFeesIrt = trades.reduce((s, t) => s + t.totalFeeIrt, 0);
    const netPnlIrt = trades.reduce((s, t) => s + t.netPnlIrt, 0);
    const grossPnlIrt = netPnlIrt + totalFeesIrt;
    const baseCap =
      segmentFilter === "GOLD"
        ? 50_000_000
        : this.capitalConfig.initialDemoBalanceIrt;

    return {
      period,
      fromTimestamp,
      toTimestamp: now,
      tradesCount: completed.length,
      winningTrades,
      losingTrades,
      winRatePct:
        completed.length > 0
          ? Number(((winningTrades / completed.length) * 100).toFixed(1))
          : 0,
      grossPnlIrt: Math.round(grossPnlIrt),
      totalFeesIrt: Math.round(totalFeesIrt),
      netPnlIrt: Math.round(netPnlIrt),
      netReturnPct:
        baseCap > 0 ? Number(((netPnlIrt / baseCap) * 100).toFixed(2)) : 0,
    };
  }

  public buildGoldPortfolioReport(): GoldPortfolioReport {
    const goldTrades = this.tradeHistory.filter((t) => t.segment === "GOLD");
    const goldOpen = this.openPositions.filter((p) => p.segment === "GOLD");
    const completed = this.completedPositions("GOLD");
    const wins = completed.filter((t) => t.pnl > 0).length;
    const losses = completed.filter((t) => t.pnl <= 0).length;
    const netRealized = goldTrades.reduce((s, t) => s + t.netPnlIrt, 0);
    const fees = goldTrades.reduce((s, t) => s + t.totalFeeIrt, 0);

    return {
      paxgTradableOnBit24: Boolean(
        this.goldSignals.find((g) => g.baseCoin === "PAXG")
          ?.verifiedTradableOnBit24,
      ),
      xautTradableOnBit24: Boolean(
        this.goldSignals.find((g) => g.baseCoin === "XAUT")
          ?.verifiedTradableOnBit24,
      ),
      goldSignals: this.goldSignals,
      goldOpenPositions: goldOpen,
      goldClosedTrades: goldTrades,
      goldTotalTrades: completed.length,
      goldWinningTrades: wins,
      goldLosingTrades: losses,
      goldWinRatePct:
        completed.length > 0
          ? Number(((wins / completed.length) * 100).toFixed(1))
          : 0,
      goldNetPnlIrt: Math.round(netRealized),
      goldTotalFeesIrt: Math.round(fees),
    };
  }

  public exportTradeHistoryCsv(): string {
    const header = [
      "Symbol",
      "Segment",
      "Mode",
      "BuyTimeISO",
      "BuyPriceIRT",
      "SellTimeISO",
      "SellPriceIRT",
      "CapitalEnteredIRT",
      "FeePaidIRT",
      "NetPnLIRT",
      "ReturnPct",
      "BuyReason",
      "SellReason",
    ].join(",");

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
      ].join(","),
    );

    return [header, ...rows].join("\n");
  }

  public getSnapshot(): AppStatusSnapshot {
    this.enforceDailyLimit();
    const ledger = ledgerAnalytics(
      this.tradeHistory,
      this.openPositions,
      "DEMO",
    );
    const allUnrealized = this.openPositions.reduce(
      (n, p) => n + p.unrealizedPnlIrt,
      0,
    );
    const cryptoTrades = this.tradeHistory.filter(
      (t) => t.segment === "CRYPTO",
    );
    const cryptoOpen = this.openPositions.filter((p) => p.segment === "CRYPTO");
    const completed = this.completedPositions("CRYPTO");
    const wins = completed.filter((t) => t.pnl > 0).length;
    const losses = completed.filter((t) => t.pnl <= 0).length;
    const realizedCryptoPnl = cryptoTrades.reduce((s, t) => s + t.netPnlIrt, 0);
    const unrealizedCryptoPnl = cryptoOpen.reduce(
      (s, p) => s + p.unrealizedPnlIrt,
      0,
    );
    const totalPnlIrt = Math.round(realizedCryptoPnl + unrealizedCryptoPnl);
    const initBal = Math.max(1, this.capitalConfig.initialDemoBalanceIrt);
    const dailyPct = this.getCryptoDailyPnlPct();

    let capLevel: CapitalSecurityStatus["level"] = "PROTECTED";
    let capFa = `ایمن و محافظت‌شده | سقف ریسک ${this.capitalConfig.riskPerTradePct}%، حداکثر ${this.capitalConfig.maxCapitalPerTradePct}% سرمایه در هر پوزیشن، دسترسی برداشت مسدود`;
    let capEn = `Protected | ${this.capitalConfig.riskPerTradePct}% risk/trade, max ${this.capitalConfig.maxCapitalPerTradePct}% allocation, withdrawal blocked`;

    if (this.emergencyStopped) {
      capLevel = "HALTED_EMERGENCY";
      capFa =
        "توقف اضطراری (EMERGENCY STOP) فعال است — هیچ سفارش جدیدی ارسال نمی‌شود";
      capEn = "EMERGENCY STOP active — all new orders halted";
    } else if (this.daily.halted) {
      capLevel = "HALTED_DAILY_LOSS";
      capFa = `توقف خودکار در حد ضرر روزانه (${dailyPct}%)`;
      capEn = `Auto-halted on Daily Loss Limit (${dailyPct}%)`;
    } else if (this.apiDisconnectedFault) {
      capLevel = "HALTED_API_ERROR";
      capFa = "توقف ایمن به دلیل قطعی ارتباط با API صرافی Bit24";
      capEn = "Safely halted due to Bit24 API connection drop";
    } else if (dailyPct < -1.5) {
      capLevel = "CAUTION";
      capFa = `هشدار مراقبت سرمایه: افت روزانه ${dailyPct}% (سقف مجاز -${this.capitalConfig.maxDailyLossPct}%)`;
      capEn = `Capital caution: Daily drawdown ${dailyPct}% (limit -${this.capitalConfig.maxDailyLossPct}%)`;
    }

    return {
      accounting: {
        ...ledger,
        unrealizedPnlIrt: allUnrealized,
        totalPnlIrt: ledger.realizedPnlIrt + allUnrealized,
        equityIrt: this.totalLiquidationEquity(),
        initialCapitalIrt:
          this.capitalConfig.initialDemoBalanceIrt + 50_000_000,
      },
      appName: "BIT24 AI TRADER PRO",
      subtitleFa:
        "آزمایشگاه معاملات کاغذی — تمام قیمت‌ها و تحلیل‌ها اطلاعات فرضی هستند",
      scannerRunning: this.scannerRunning,
      tradingMode: this.tradingMode,
      liveTradingUserConfirmed: this.liveTradingUserConfirmed,
      emergencyStopped: this.emergencyStopped,
      goldTradingEnabled: this.goldAutoDemoEnabled,
      demoBalanceIrt: this.getCryptoDemoTotalEquityIrt(),
      demoAvailableCashIrt: Math.round(this.demoCashIrt),
      dailyPnlIrt: this.getCryptoDailyPnlIrt(),
      dailyPnlPct: Number(dailyPct.toFixed(2)),
      totalPnlIrt,
      totalPnlPct: Number(((totalPnlIrt / initBal) * 100).toFixed(2)),
      winningTrades: wins,
      losingTrades: losses,
      winRatePct:
        completed.length > 0
          ? Number(((wins / completed.length) * 100).toFixed(1))
          : 0,
      openPositions: cryptoOpen,
      topOpportunities: this.cryptoSignals,
      bit24Connection: this.bit24Health,
      capitalSecurity: {
        level: capLevel,
        dailyLossUsedPct: dailyPct,
        maxDailyLossPct: this.capitalConfig.maxDailyLossPct,
        openTradesCount: this.openPositions.length,
        maxConcurrentTrades: this.capitalConfig.maxConcurrentTrades,
        consecutiveTradeErrors: this.consecutiveTradeErrors,
        summaryFa: capFa,
        summaryEn: capEn,
      },
      capitalConfig: this.capitalConfig,
      exitConfig: this.exitConfig,
      goldReport: this.buildGoldPortfolioReport(),
      recentRejections: this.rejectionLogs.slice(0, 25),
      tradeHistory: this.tradeHistory,
      demo: {
        paperOrders: this.paperOrders,
        cashAdjustments: this.cashAdjustments,
        daily: {
          ...this.daily,
          pnlIrt: this.getCryptoDailyPnlIrt(),
          pnlPct: this.getCryptoDailyPnlPct(),
        },
        chartSeries: Object.fromEntries(
          [...this.candlesBySymbol].map(([k, v]) => [k, v.slice(-60)]),
        ),
        goldCashIrt: this.goldDedicatedCashIrt,
      },
      periodReports: {
        daily: this.buildPeriodSummary("DAILY", "ALL"),
        weekly: this.buildPeriodSummary("WEEKLY", "ALL"),
        monthly: this.buildPeriodSummary("MONTHLY", "ALL"),
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
