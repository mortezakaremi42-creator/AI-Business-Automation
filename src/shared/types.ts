export type ModuleId =
  | 'SPOT_CRYPTO'
  | 'DIGITAL_GOLD'
  | 'MEME_HUNTER'
  | 'LEVERAGE_MARGIN';

export type QuoteCurrency = 'IRT' | 'USDT';

export type TradingEnvironmentMode = 'ANALYSIS_ONLY' | 'PAPER' | 'LIVE';

export type BotRuntimeStatus =
  | 'STOPPED'
  | 'PAUSED_NEW_TRADES'
  | 'ANALYZING'
  | 'PAPER_ACTIVE'
  | 'LIVE_ACTIVE'
  | 'SIGNAL_ONLY_FALLBACK'
  | 'DAILY_LOSS_HALTED'
  | 'CIRCUIT_BREAKER_HALTED'
  | 'EMERGENCY_STOPPED';

export interface OhlcvCandle {
  t: number; // Unix timestamp (seconds)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
  total: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  bidDepthQuote: number;
  askDepthQuote: number;
  estimatedSlippagePct: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  isLiveOrderBook?: boolean;
}

export interface Bit24MarketInfo {
  id: number;
  marketName: string; // e.g. "PAXG/IRT", "PEPE/IRT", "DOGE/IRT", "BTC/IRT"
  baseSymbol: string;
  baseFaName: string;
  quoteSymbol: QuoteCurrency;
  category: 'GOLD' | 'CRYPTO' | 'MEME';
  eachPrice: number;
  change24hPct: number;
  volume24hBase: number;
  volume24hQuote: number;
  high24h: number;
  low24h: number;
  minOrderQuote: number;
  spotActive: boolean;
  marginActive: boolean;
  maxLeverage: number;
  hourlyRolloverFeePct: number;
  dataSource?: 'BIT24_OFFICIAL_API' | 'PUBLIC_REFERENCE_FEED' | 'SIMULATED_DEMO';
}

export interface TechnicalSnapshot {
  ema9: number;
  ema21: number;
  ema50: number;
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  atr14: number;
  atrPct: number;
  supportLevel: number;
  resistanceLevel: number;
  distanceToSupportPct: number;
  distanceToResistancePct: number;
  volumeRatio: number; // current volume / 20-period average volume
  shortTermTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  mediumTermTrend: 'BULLISH' | 'BEARISH' | 'RANGING';
  htfTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; // 4H aggregated multi-timeframe trend
  suddenSpikePct: number; // 3-bar rapid jump % for late-entry / bull-trap filter
  fakePumpRisk: boolean; // true if spike lacks volume or shows heavy upper-wick rejection
  breakoutState:
    | 'CONFIRMED_BULLISH_BREAKOUT'
    | 'SUPPORT_REVERSAL_CONFIRMED'
    | 'FAKE_BREAKOUT_TRAP'
    | 'BREAKDOWN_RISK'
    | 'NONE';
}

export interface GoldGlobalComparison {
  globalXauUsd: number;
  globalXauChange24hPct: number;
  usdtIrtRate: number;
  tokenImpliedUsd: number;
  basisVsXauPct: number;
  divergence24hPct: number;
  productTypeFa: string;
  priceUnitFa: string;
  accountCurrencyFa: string;
  tradingHoursFa: string;
  brokerLimitationsFa: string;
  noteFa: string;
}

export type MemePumpStage =
  | 'BOTTOM_ACCUMULATION_TURN' // چرخش تاییدشده از کف حمایتی با ورود پول
  | 'EARLY_PUMP_IGNITION' // استارت اولیه موج پامپ با جهش حجم
  | 'LATE_PUMP_FOMO_TRAP' // پامپ اشباع‌شده در سقف (ورود ممنوع)
  | 'FALLING_KNIFE_RISK' // ریزش بدون حمایت (ورود ممنوع)
  | 'QUIET_WATCH'; // کم‌حجم / در حال رصد

export interface MemePumpMetrics {
  pumpStage: MemePumpStage;
  pumpStageFa: string;
  drawdownFromRecentHighPct: number;
  bounceFromSupportPct: number;
  volumeSurgeMultiple: number;
  pumpVelocityPct: number;
}

export interface CostAndRewardCalc {
  makerFeePct: number;
  takerFeePct: number;
  roundTripFeePct: number;
  spreadPct: number;
  estimatedSlippagePct: number;
  totalFrictionPct: number;
  grossTargetPct: number;
  stopDistancePct: number;
  netRewardPct: number;
  netRiskPct: number;
  netRiskRewardRatio: number;
  isEconomical: boolean;
}

export type SignalAction =
  | 'BUY_CONFIRMED'
  | 'SELL_EXIT'
  | 'SHORT_MARGIN_CONFIRMED'
  | 'HOLD_WATCH'
  | 'AVOID_UNFAVORABLE';

export interface SmartSignal {
  id: string;
  timestamp: number;
  module: ModuleId;
  marketName: string;
  baseSymbol: string;
  baseFaName: string;
  quoteSymbol: QuoteCurrency;
  currentPrice: number;
  change24hPct: number;
  action: SignalAction;
  confidenceScore: number;
  setupTypeFa: string;
  summaryFa: string;
  reasonsFa: string[];
  rejectionReasonsFa: string[];
  suggestedEntry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStopDeltaPct: number;
  leverage?: number;
  liquidationPrice?: number;
  technicals: TechnicalSnapshot;
  costs: CostAndRewardCalc;
  goldComparison?: GoldGlobalComparison;
  memeMetrics?: MemePumpMetrics;
  securityReport?: TokenSecurityReport;
  executableOnBit24: boolean;
}

export type SecurityVerdict =
  | 'SAFE_FOR_DEMO' // امتیاز 80 تا 100: مجاز برای آزمایش دمو
  | 'WARNING_REVIEW' // امتیاز 60 تا 79: هشدار و نیاز به بررسی
  | 'BLOCKED' // امتیاز زیر 60: ممنوعیت خرید
  | 'BLOCKED_INSUFFICIENT_DATA'; // کمبود داده یا عدم دسترسی API امنیتی: ممنوعیت قطعی خرید

export type LiquidityHealthStatus =
  | 'HEALTHY'
  | 'LOW_LIQUIDITY'
  | 'SUDDEN_DRAIN_RUG'
  | 'INVALID_DATA';

export type TokenChainNetwork =
  | 'SOLANA_SPL'
  | 'ETHEREUM_EVM'
  | 'BSC_EVM'
  | 'TON_JETTON'
  | 'BIT24_SPOT';

export type SecurityDataOrigin =
  | 'LIVE_PUBLIC_SECURITY_APIS' // GoPlus + DexScreener + RugCheck + Honeypot.is
  | 'DEMO_PAPER_SIMULATION' // پروفایل شبیه‌سازی آزمایشی Paper Trading
  | 'FAIL_CLOSED_OFFLINE'; // سرویس امنیتی در دسترس نبود -> مسدودسازی خودکار

export interface LiquidityCheckDetail {
  poolLiquidityUsd: number | null;
  orderBookDepthIrt: number | null;
  minRequiredLiquidityUsd: number;
  liquidityChange1hPct: number | null;
  isCriticallyLow: boolean;
  isSuddenDropDetected: boolean;
  isDataValid: boolean;
  status: LiquidityHealthStatus;
  statusLabelFa: string;
}

export interface ContractSecurityDetail {
  contractAddress: string;
  network: TokenChainNetwork;
  canSell: boolean | null; // Honeypot check
  isHoneypot: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  hasSuspiciousSellRestriction: boolean;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  ownerDangerousPrivileges: boolean;
  isUnverifiedOrSuspiciousContract: boolean;
  tokenAgeHours: number | null;
  isNewlyCreatedToken: boolean;
  topHoldersConcentrationPct: number | null;
}

export interface FakePumpCheckDetail {
  priceSpikeWithoutValidVolume: boolean;
  abnormalBuySellVolume: boolean;
  buyToSellRatio: number | null;
  washTradingSuspected: boolean;
  priceManipulationRisk: boolean;
  suddenLiquidityDropWithPump: boolean;
}

export interface TokenSecurityReport {
  id: string;
  checkedAt: number;
  symbol: string;
  marketName: string;
  displayNameFa: string;
  network: TokenChainNetwork;
  contractAddress: string;
  dataOrigin: SecurityDataOrigin;
  apisConsulted: string[];
  dataComplete: boolean;
  securityApiAvailable: boolean;
  isDataFresh: boolean;
  securityScore: number; // 0..100
  liquidityScorePart: number; // 0..30
  contractScorePart: number; // 0..40
  antiPumpScorePart: number; // 0..30
  verdict: SecurityVerdict;
  verdictLabelFa: string;
  buyAllowedInDemo: boolean;
  requiresManualReview: boolean;
  warningReasonsFa: string[];
  liquidity: LiquidityCheckDetail;
  contract: ContractSecurityDetail;
  fakePump: FakePumpCheckDetail;
}

export interface CapitalShieldSettings {
  enabled: boolean;
  minScoreForAutoDemoBuy: number; // Default 80 (80-100 safe for demo)
  blockBelowScore: number; // Default 60 (<60 strictly forbidden)
  minPoolLiquidityUsd: number; // Default 25,000 USD
  maxSuddenLiquidityDropPct: number; // Default 25% drop -> rug alert
  maxAcceptableBuyTaxPct: number; // Default 5% warning, >10% block
  maxAcceptableSellTaxPct: number; // Default 5% warning, >10% block
  minTokenAgeHours: number; // Default 24 hours
  maxMarketDataAgeSec: number; // Default 90 seconds (stale feed protection)
  blockOnMissingDataOrApiDown: true; // Always Fail-Closed
  preventDuplicateTokenPurchase: boolean; // Default true
  autoEmergencyStopOnSystemError: boolean; // Default true
}

export interface BlockedBuyIncident {
  id: string;
  timestamp: number;
  symbol: string;
  marketName: string;
  module: ModuleId | 'DEX_SCANNER';
  securityScore: number;
  verdict: SecurityVerdict;
  primaryReasonFa: string;
  allReasonsFa: string[];
}

export interface AntiRugDashboardSummary {
  botEditionTitle: string; // Phantom Dip Hunter Pro — ANTI-RUG & SMART SECURITY
  securityServiceOnline: boolean;
  simulatedFeedStale: boolean;
  liveTradingLockedUntilApproval: boolean;
  checkedTokensCount: number;
  suspiciousTokensCount: number;
  safeDemoTokensCount: number;
  blockedBuysCount: number;
  duplicateBlocksCount: number;
  staleOrOfflineBlocksCount: number;
  systemErrorHaltsCount: number;
  config: CapitalShieldSettings;
  tokenReports: TokenSecurityReport[];
  blockedBuysLog: BlockedBuyIncident[];
  realApisSupported: {
    name: string;
    purposeFa: string;
    endpointPattern: string;
    requiresPrivateKey: false;
    activeInCurrentEnvironment: 'READY_ON_LIVE_SERVER' | 'SANDBOX_OUTBOUND_RESTRICTED';
  }[];
}

export interface ManagedPosition {
  id: string;
  bit24OrderId?: number;
  orderStatusVerified?: boolean;
  module: ModuleId;
  mode: 'PAPER' | 'LIVE';
  marketName: string;
  baseSymbol: string;
  baseFaName: string;
  quoteSymbol: QuoteCurrency;
  side: 'LONG' | 'SHORT';
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  initialQuantity: number;
  notionalQuote: number;
  collateralQuote: number;
  stopLoss: number;
  initialStopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  tp1Hit: boolean;
  trailingActive: boolean;
  trailingDeltaPct: number;
  highestPrice: number;
  lowestPrice: number;
  liquidationPrice?: number;
  paidFeesQuote: number;
  realizedPartPnlQuote: number;
  unrealizedPnlQuote: number;
  unrealizedPnlPct: number;
  dcaCount: number;
  openedAt: number;
  entryReasonFa: string;
}

export interface ClosedTradeRecord {
  id: string;
  bit24OrderId?: number;
  isConfirmedLiveFill?: boolean;
  module: ModuleId;
  mode: 'PAPER' | 'LIVE';
  marketName: string;
  baseSymbol: string;
  quoteSymbol: QuoteCurrency;
  side: 'LONG' | 'SHORT';
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notionalQuote: number;
  feesPaidQuote: number;
  netPnlQuote: number;
  netPnlPct: number;
  openedAt: number;
  closedAt: number;
  exitReason:
    | 'TP2_TARGET'
    | 'TRAILING_STOP'
    | 'STOP_LOSS'
    | 'TREND_WEAKNESS_EARLY_EXIT'
    | 'EMERGENCY_LIQUIDATE'
    | 'MANUAL_CLOSE';
  exitReasonFa: string;
}

export interface ModuleRiskSettings {
  allocatedCapitalIrt: number;
  allocatedCapitalUsdt: number;
  quotePreference: QuoteCurrency;
  riskPerTradePct: number; // Default 0.5% per Stage 5 spec
  stopLossPct: number;
  takeProfit1Pct: number;
  takeProfit2Pct: number;
  trailingStopPct: number;
  useSteppedTakeProfit: boolean;
  useTrailingStop: boolean;
  earlyExitOnTrendWeakness: boolean;
  maxOpenPositions: number;
  allowLossAveragingDca: false;
  maxLeverage?: number;
}

export interface PlatformSettings {
  environmentMode: TradingEnvironmentMode;
  liveTradingConfirmedThisSession: boolean;
  pauseNewTrades: boolean; // Stage 6 button #5: توقف معاملات جدید
  dailyMaxLossPct: number; // Default 2.0%
  maxTotalOpenRiskPct: number; // Default 2.0% cumulative open position risk
  maxTotalOpenPositions: number; // Default 3 concurrent positions across platform
  bit24VipFeePct: number;
  maxAllowedSpreadPct: number;
  minNetRiskReward: number;
  usdtIrtReference: number;
  antiRugConfig?: CapitalShieldSettings;
  modules: {
    SPOT_CRYPTO: {
      enabled: boolean;
      risk: ModuleRiskSettings;
    };
    DIGITAL_GOLD: {
      enabled: boolean;
      risk: ModuleRiskSettings;
    };
    MEME_HUNTER: {
      enabled: boolean;
      risk: ModuleRiskSettings;
    };
    LEVERAGE_MARGIN: {
      enabled: boolean;
      userAcknowledgedLeverageRisk: boolean;
      risk: ModuleRiskSettings;
    };
  };
}

export interface ModulePerformanceReport {
  module: ModuleId;
  titleFa: string;
  status: BotRuntimeStatus;
  quoteCurrency: QuoteCurrency;
  allocatedCapitalIrt: number;
  engagedCapitalIrt: number;
  freeCapitalIrt: number;
  dailyRealizedPnlIrt: number;
  dailyUnrealizedPnlIrt: number;
  dailyTotalPnlIrt: number;
  dailyPnlPct: number;
  totalNetPnlIrt: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  totalFeesPaidIrt: number;
  openPositionsCount: number;
}

export interface VerifiedWalletAssetItem {
  symbol: string;
  faName: string;
  available: number;
  inOrders: number;
  balanceIrt: number;
  balanceUsdt: number;
}

export interface VerifiedWalletBalance {
  confirmedByOfficialApi: boolean;
  totalIrt: number | null;
  totalUsdt: number | null;
  spotFreeIrt: number | null;
  spotFreeUsdt: number | null;
  assets: VerifiedWalletAssetItem[];
  fetchedAt: number | null;
  noteFa: string;
}

export interface PeriodPerformanceBreakdown {
  periodId: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  labelFa: string;
  realizedPnlIrt: number;
  unrealizedPnlIrt: number;
  feesPaidIrt: number;
  netPnlIrt: number;
  winningTrades: number;
  losingTrades: number;
  totalTrades: number;
  isEstimatedSimulation: boolean;
}

export interface EquityChartPoint {
  timestamp: number;
  labelFa: string;
  equityIrt: number;
  goldPnlIrt: number;
  cryptoPnlIrt: number;
}

export interface CircuitBreakerState {
  tripped: boolean;
  reasonFa: string | null;
  consecutiveApiErrors: number;
  lastAnomalyAt: number | null;
}

export interface IncompleteFeatureNotice {
  id: string;
  titleFa: string;
  badgeFa: 'تکمیل نشده';
  detailFa: string;
}

export interface Bit24EndpointCapability {
  id: string;
  featureFa: string;
  method: 'GET' | 'POST' | 'BLOCKED';
  endpoint: string;
  officialSupport: 'SUPPORTED' | 'CONDITIONAL' | 'SECURITY_BLOCKED';
  requiresSecretSignature: boolean;
  notesFa: string;
}

export type ExchangeErrorCategory =
  | 'NONE'
  | 'NETWORK_TIMEOUT_OR_OFFLINE'
  | 'AUTH_OR_IP_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'ORDER_REJECTED_BY_EXCHANGE';

export interface ApiAndNetworkHealth {
  internetOnline: boolean;
  serverBackendConnected: boolean;
  adminAuthProtected: boolean;
  bit24ApiConfigured: boolean;
  bit24KeyMasked: string | null;
  bit24ConnectionState:
    | 'CONNECTED_VERIFIED'
    | 'KEY_NOT_SET'
    | 'CORS_NEEDS_BACKEND'
    | 'AUTH_ERROR'
    | 'UNREACHABLE';
  lastErrorCategory: ExchangeErrorCategory;
  bit24LatencyMs: number | null;
  rateLimitUsedPerMin: number;
  rateLimitMaxPerMin: 250;
  paxgMarketAvailable: boolean;
  xautMarketAvailable: boolean;
  globalXauBrokerConnected: false;
  memeMarketsCount: number;
  marginServiceAvailable: boolean;
  withdrawalEndpointBlocked: true;
  stopLossExactFillGuaranteed: false;
  lastSyncAt: number | null;
  statusMessageFa: string;
  capabilities: Bit24EndpointCapability[];
  incompleteFeatures: IncompleteFeatureNotice[];
}

export interface BacktestRegimeStat {
  regimeFa: string;
  trades: number;
  winRatePct: number;
  netPnlPct: number;
}

export interface BacktestSummary {
  module: 'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER';
  marketName: string;
  isSimulationOnly: true;
  noLookaheadVerified: true;
  candlesTested: number;
  periodLabelFa: string;
  initialCapitalIrt: number;
  finalCapitalIrt: number;
  netProfitIrt: number;
  netProfitPct: number;
  totalTrades: number;
  winRatePct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  totalFeesAndSlippageIrt: number;
  filteredBadSetupsCount: number;
  equityCurve: { index: number; equityIrt: number }[];
  regimeBreakdown: BacktestRegimeStat[];
  rejectedSampleReasons: { candleIndex: number; price: number; reasonFa: string }[];
  sampleTrades: {
    entryIndex: number;
    exitIndex: number;
    entryPrice: number;
    exitPrice: number;
    netPnlPct: number;
    regimeFa: string;
    reasonFa: string;
  }[];
}

export interface RejectedOrderAuditItem {
  id: string;
  timestamp: number;
  module: ModuleId;
  marketName: string;
  reasonFa: string;
}

export interface ActivityLogItem {
  id: string;
  timestamp: number;
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  module: ModuleId | 'SYSTEM' | 'SECURITY';
  messageFa: string;
}

export interface PlatformSnapshot {
  updatedAt: number;
  paperReadinessPassed: boolean;
  settings: PlatformSettings;
  health: ApiAndNetworkHealth;
  verifiedWallet: VerifiedWalletBalance;
  circuitBreaker: CircuitBreakerState;
  totalPortfolioIrt: number;
  totalAllocatedIrt: number;
  goldAllocatedIrt: number;
  cryptoAllocatedIrt: number;
  totalEngagedIrt: number;
  currentOpenRiskPct: number;
  realizedPnlTotalIrt: number;
  unrealizedPnlTotalIrt: number;
  totalFeesPaidAllIrt: number;
  isPnlSimulationEstimated: boolean;
  totalWinningTrades: number;
  totalLosingTrades: number;
  dailyTotalPnlIrt: number;
  dailyTotalPnlPct: number;
  dailyLossLimitReached: boolean;
  emergencyStopped: boolean;
  globalGoldUsd: number;
  globalGoldChange24hPct: number;
  usdtIrtRate: number;
  periodSummaries: {
    daily: PeriodPerformanceBreakdown;
    weekly: PeriodPerformanceBreakdown;
    monthly: PeriodPerformanceBreakdown;
  };
  performanceCurve: EquityChartPoint[];
  rejectedAudit: RejectedOrderAuditItem[];
  antiRug: AntiRugDashboardSummary;
  markets: Bit24MarketInfo[];
  signals: SmartSignal[];
  openPositions: ManagedPosition[];
  tradeHistory: ClosedTradeRecord[];
  reports: Record<ModuleId, ModulePerformanceReport>;
  logs: ActivityLogItem[];
}
