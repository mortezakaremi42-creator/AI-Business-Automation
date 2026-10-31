export type AppLanguage = 'fa' | 'en';

export type AssetSegment = 'CRYPTO' | 'GOLD';

export type SignalTier =
  | 'REJECTED' // 0..59: رد سیگنال
  | 'ALERT_ONLY' // 60..74: فقط هشدار
  | 'REVIEW_OPPORTUNITY' // 75..84: فرصت قابل بررسی
  | 'STRONG_TEST_SIGNAL'; // 85..100: سیگنال قوی برای آزمایش

export interface CandleBar {
  t: number; // Unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OrderBookDepth {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  bidDepthIrt: number;
  askDepthIrt: number;
  buyerPressurePct: number;
  estimatedSlippagePct: number;
  fromLiveOrderBook: boolean;
}

export interface Bit24TickerMarket {
  symbol: string; // e.g. "BTC/IRT", "PAXG/IRT", "XAUT/IRT"
  baseCoin: string;
  quoteCoin: 'IRT' | 'USDT';
  faName: string;
  enName: string;
  segment: AssetSegment; // CRYPTO vs GOLD (strictly isolated)
  tradableOnBit24: boolean;
  priceIrt: number;
  change1mPct: number;
  change5mPct: number;
  change15mPct: number;
  change60mPct: number;
  change24hPct: number;
  high24hIrt: number;
  low24hIrt: number;
  volume24hBase: number;
  volume24hIrt: number;
  minOrderIrt: number;
  feePctPerSide: number;
  updatedAt: number;
  dataFeedType: 'LIVE_BIT24_API' | 'SIMULATED_MARKET_FEED';
}

export interface TechnicalIndicators {
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  ema20: number;
  ema50: number;
  atr14: number;
  atrPct: number;
  supportLevel: number;
  resistanceLevel: number;
  resistanceBreakout: boolean;
  healthyPullbackToSupport: boolean;
  volumeSurgeRatio: number;
  abnormalVolumeDetected: boolean;
  buyerPowerPct: number;
  alreadyOverPumped: boolean;
  pumpAndDumpRisk: boolean;
}

export interface PumpOpportunitySignal {
  symbol: string;
  baseCoin: string;
  faName: string;
  enName: string;
  priceIrt: number;
  opportunityScore: number; // 0..100
  tier: SignalTier;
  entryStyle: 'BREAKOUT' | 'PULLBACK' | 'NO_ENTRY';
  change1mPct: number;
  change5mPct: number;
  change15mPct: number;
  change60mPct: number;
  change24hPct: number;
  volume24hIrt: number;
  spreadPct: number;
  estimatedSlippagePct: number;
  indicators: TechnicalIndicators;
  reasonsFa: string[];
  reasonsEn: string[];
  warningsFa: string[];
  warningsEn: string[];
  noProfitGuaranteeDisclaimerFa: string;
  noProfitGuaranteeDisclaimerEn: string;
  evaluatedAt: number;
}

export interface GoldMarketSignal {
  symbol: 'PAXG/IRT' | 'XAUT/IRT';
  baseCoin: 'PAXG' | 'XAUT';
  faName: string;
  enName: string;
  verifiedTradableOnBit24: boolean;
  tradabilityNoteFa: string;
  tradabilityNoteEn: string;
  priceIrt: number;
  shortTermTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  supportIrt: number;
  resistanceIrt: number;
  rsi14: number;
  macdHistogram: number;
  volume24hIrt: number;
  roundTripFeePct: number;
  suggestedStopLossIrt: number;
  suggestedTakeProfitIrt: number;
  goldScore: number;
  action:
    | 'GOLD_BUY_CANDIDATE'
    | 'HOLD_WATCH'
    | 'AVOID_HIGH_SPREAD_OR_OVERBOUGHT'
    | 'NOT_TRADABLE';
  rationaleFa: string;
  rationaleEn: string;
  evaluatedAt: number;
}

export interface CapitalRiskConfig {
  initialDemoBalanceIrt: number;
  riskPerTradePct: number; // پیش‌فرض ۱٪
  maxCapitalPerTradePct: number; // پیش‌فرض ۱۰٪ (هرگز ۱۰۰٪ مجاز نیست)
  maxConcurrentTrades: number; // پیش‌فرض ۳
  maxDailyLossPct: number; // پیش‌فرض ۳٪
  autoStopOnDailyLoss: boolean;
  neverUseFullCapitalInSingleTrade: true;
}

export interface ExitStrategyConfig {
  initialStopLossPct: number; // پیش‌فرض ۵٪
  trailingActivationProfitPct: number; // پیش‌فرض ۸٪ سود
  trailingDistanceFromPeakPct: number; // پیش‌فرض ۳٪ فاصله از سقف
  tpStage1ProfitPct: number; // پیش‌فرض ۱۰٪
  tpStage1SellRatioPct: number; // پیش‌فرض ۳۰٪
  tpStage2ProfitPct: number; // پیش‌فرض ۲۰٪
  tpStage2SellRatioPct: number; // پیش‌فرض ۳۰٪
  tpStage3ProfitPct: number; // پیش‌فرض ۳۵٪
  tpStage3SellRatioPct: number; // پیش‌فرض ۴۰٪
}

export interface ActivePosition {
  id: string;
  symbol: string;
  baseCoin: string;
  segment: AssetSegment;
  mode: 'DEMO' | 'LIVE';
  entryPriceIrt: number;
  currentPriceIrt: number;
  highestPriceIrt: number;
  initialQuantity: number;
  remainingQuantity: number;
  initialCapitalIrt: number;
  remainingCapitalIrt: number;
  entryFeeIrt: number;
  initialStopLossIrt: number;
  activeStopLossIrt: number;
  trailingStopActive: boolean;
  trailingStopPriceIrt: number | null;
  tpStage1Filled: boolean;
  tpStage2Filled: boolean;
  tpStage3Filled: boolean;
  unrealizedPnlIrt: number;
  unrealizedPnlPct: number;
  buyReasonFa: string;
  buyReasonEn: string;
  openedAt: number;
}

export interface TradeHistoryRecord {
  id: string;
  symbol: string; // ۱. نماد ارز
  segment: AssetSegment;
  mode: 'DEMO' | 'LIVE';
  buyTime: number; // ۲. زمان خرید
  buyPriceIrt: number; // ۳. قیمت خرید
  sellTime: number; // ۴. زمان فروش
  sellPriceIrt: number; // ۵. قیمت فروش
  quantity: number;
  capitalEnteredIrt: number; // ۶. مقدار سرمایه
  totalFeeIrt: number; // ۷. کارمزد
  slippageCostIrt: number;
  netPnlIrt: number; // ۸. سود یا زیان خالص
  netPnlPct: number; // ۹. درصد بازدهی
  buyReasonFa: string; // ۱۰. دلیل خرید
  buyReasonEn: string;
  sellReasonFa: string; // ۱۱. دلیل فروش
  sellReasonEn: string;
}

export interface TradeRejectionLog {
  id: string;
  timestamp: number;
  symbol: string;
  code:
    | 'EMERGENCY_STOP_ACTIVE'
    | 'API_DISCONNECTED'
    | 'STALE_DATA'
    | 'DUPLICATE_ORDER'
    | 'DAILY_LOSS_LIMIT'
    | 'MAX_CONCURRENT_REACHED'
    | 'FAKE_PUMP_RISK'
    | 'LOW_LIQUIDITY'
    | 'HIGH_SPREAD'
    | 'ABNORMAL_MARKET'
    | 'INSUFFICIENT_BALANCE';
  reasonFa: string;
  reasonEn: string;
}

export interface PeriodReportSummary {
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  fromTimestamp: number;
  toTimestamp: number;
  tradesCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  grossPnlIrt: number;
  totalFeesIrt: number;
  netPnlIrt: number;
  netReturnPct: number;
}

export interface GoldPortfolioReport {
  paxgTradableOnBit24: boolean;
  xautTradableOnBit24: boolean;
  goldSignals: GoldMarketSignal[];
  goldOpenPositions: ActivePosition[];
  goldClosedTrades: TradeHistoryRecord[];
  goldTotalTrades: number;
  goldWinningTrades: number;
  goldLosingTrades: number;
  goldWinRatePct: number;
  goldNetPnlIrt: number;
  goldTotalFeesIrt: number;
}

export interface Bit24ApiHealth {
  state:
    | 'NOT_CONFIGURED'
    | 'CONNECTED_TOKEN_ONLY'
    | 'CONNECTED_PUBLIC_AND_PRIVATE'
    | 'OFFLINE_OR_UNREACHABLE'
    | 'AUTH_ERROR';
  hasApiKey: boolean;
  hasSecretKey: boolean;
  maskedApiKey: string;
  withdrawalPermissionBlocked: true;
  baseUrl: string;
  lastCheckedAt: number | null;
  latencyMs: number | null;
  activeMarketFeed: 'LIVE_BIT24_API' | 'SIMULATED_MARKET_FEED';
  messageFa: string;
  messageEn: string;
}

export interface CapitalSecurityStatus {
  level:
    | 'PROTECTED'
    | 'CAUTION'
    | 'HALTED_DAILY_LOSS'
    | 'HALTED_EMERGENCY'
    | 'HALTED_API_ERROR';
  dailyLossUsedPct: number;
  maxDailyLossPct: number;
  openTradesCount: number;
  maxConcurrentTrades: number;
  consecutiveTradeErrors: number;
  summaryFa: string;
  summaryEn: string;
}

export type TelegramEventType =
  | 'PUMP_CANDIDATE'
  | 'BUY_SIGNAL'
  | 'DEMO_BUY'
  | 'DEMO_SELL'
  | 'STOP_LOSS_HIT'
  | 'TAKE_PROFIT_HIT'
  | 'BOT_STOPPED'
  | 'DAILY_PNL_REPORT';

export interface TelegramNotificationLog {
  id: string;
  timestamp: number;
  eventType: TelegramEventType;
  deliveredToTelegram: boolean;
  title: string;
  safeMessagePreview: string;
}

export interface ProVerificationReport {
  executedAt: number;
  simulatedTradesExecuted: number;
  targetMinimumTrades: number;
  dataSufficiencyNoteFa: string;
  dataSufficiencyNoteEn: string;
  dataSourceType: 'LIVE_BIT24_CANDLES' | 'SIMULATED_MULTI_REGIME_CANDLES';
  startingCapitalIrt: number;
  endingCapitalIrt: number;
  netSimulatedPnlIrt: number;
  netSimulatedPnlPct: number;
  totalFeesPaidIrt: number;
  totalSlippageCostIrt: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  maxDrawdownPct: number;
  faultInjectionChecks: {
    feeAndSlippageApplied: boolean;
    internetDisconnectTestPassed: boolean;
    bit24ApiErrorTestPassed: boolean;
    emergencyStopTestPassed: boolean;
    duplicateOrderPreventionPassed: boolean;
  };
  readyForUserReview: boolean;
  sampleTrades: TradeHistoryRecord[];
}

export interface AppStatusSnapshot {
  appName: 'BIT24 AI TRADER PRO';
  subtitleFa: string;
  scannerRunning: boolean;
  tradingMode: 'STOPPED' | 'DEMO' | 'LIVE';
  liveTradingUserConfirmed: boolean;
  emergencyStopped: boolean;
  goldTradingEnabled: boolean;
  demoBalanceIrt: number;
  demoAvailableCashIrt: number;
  dailyPnlIrt: number;
  dailyPnlPct: number;
  totalPnlIrt: number;
  totalPnlPct: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  openPositions: ActivePosition[];
  topOpportunities: PumpOpportunitySignal[];
  bit24Connection: Bit24ApiHealth;
  capitalSecurity: CapitalSecurityStatus;
  capitalConfig: CapitalRiskConfig;
  exitConfig: ExitStrategyConfig;
  goldReport: GoldPortfolioReport;
  recentRejections: TradeRejectionLog[];
  tradeHistory: TradeHistoryRecord[];
  periodReports: {
    daily: PeriodReportSummary;
    weekly: PeriodReportSummary;
    monthly: PeriodReportSummary;
  };
  telegram: {
    configured: boolean;
    enabled: boolean;
    maskedChatId: string;
    recentLogs: TelegramNotificationLog[];
  };
  latestVerificationReport: ProVerificationReport | null;
  serverTimestamp: number;
}
