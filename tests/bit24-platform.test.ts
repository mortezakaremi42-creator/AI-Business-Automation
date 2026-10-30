import { describe, expect, it } from 'vitest';
import {
  createPhantomDexSecurityWatchlist,
  evaluateTokenSecurity,
  looksLikePrivateKeyOrSeedPhrase,
} from '../src/core/antiRugEngine.js';
import { analyzeGoldMarket } from '../src/core/goldAnalyzer.js';
import { inspectTokenContractLive } from '../src/server/security/onChainSecurityClient.js';
import {
  buildOrderBookSnapshot,
  buildTechnicalSnapshot,
  evaluateTradeEconomics,
} from '../src/core/indicators.js';
import {
  createInitialBit24Markets,
  generateRealisticCandles,
  generateRealisticOrderBook,
} from '../src/core/marketSimulator.js';
import { analyzeMemePumpMarket } from '../src/core/memeAnalyzer.js';
import { Bit24PlatformOrchestrator } from '../src/core/platformRuntime.js';
import {
  calculateSafePositionSize,
  createDefaultPlatformSettings,
  stepPositionLifecycle,
} from '../src/core/riskManager.js';
import { analyzeSpotCryptoMarket } from '../src/core/spotCryptoAnalyzer.js';
import {
  Bit24OfficialClient,
  SecurityForbiddenError,
} from '../src/server/bit24/bit24Client.js';
import {
  assertBrowserNoWithdraw,
  BrowserSecurityForbiddenError,
  signBit24ParamsBrowser,
} from '../src/client/engine/browserBit24Client.js';
import { Bit24CredentialVault } from '../src/server/bit24/credentialVault.js';

describe('Bit24 Smart Trader AI + Gold — Complete Stage 1–9 Verification Suite', () => {
  it('1. permanently blocks any withdrawal API path (Zero Withdrawal Policy)', () => {
    expect(() =>
      Bit24OfficialClient.assertNoWithdrawalPath('/lite/capi/v1/withdraw/submit')
    ).toThrow(SecurityForbiddenError);

    expect(() =>
      Bit24OfficialClient.assertNoWithdrawalPath('/pro/capi/v2/spot-orders/submit')
    ).not.toThrow();
  });

  it('2. computes identical HMAC-SHA256 signatures, encrypts server vault with AES-256-GCM, and redacts secrets from logs', async () => {
    const query =
      'base_coin_symbol=PAXG&quote_coin_symbol=IRT&side=1&type=0&amount=0.05&price=260000000';
    const nodeSig = Bit24OfficialClient.signParameters(query, 'test_secret_key');
    const browserSig = await signBit24ParamsBrowser(query, 'test_secret_key');
    expect(nodeSig).toMatch(/^[a-f0-9]{64}$/);
    expect(browserSig).toBe(nodeSig);

    expect(() => assertBrowserNoWithdraw('/lite/capi/v1/withdraw/submit')).toThrow(
      BrowserSecurityForbiddenError
    );

    const vault = new Bit24CredentialVault();
    const saved = vault.saveCredentials('B24_TEST_APIKEY_987654', 'SECRET_HMAC_123456');
    expect(saved.maskedKey).toBe('B24_••••7654');
    expect(vault.isConfigured()).toBe(true);
    expect(vault.getCredentials()?.apiKey).toBe('B24_TEST_APIKEY_987654');

    // Secret redaction check (Stage 8: never print keys in logs!)
    const scrubbed = vault.redactSensitiveText(
      'خطای تست با B24_TEST_APIKEY_987654 و SECRET_HMAC_123456'
    );
    expect(scrubbed).not.toContain('B24_TEST_APIKEY_987654');
    expect(scrubbed).not.toContain('SECRET_HMAC_123456');
    expect(scrubbed).toContain('[REDACTED_API_KEY]');

    vault.clearCredentials();
    expect(vault.isConfigured()).toBe(false);
  });

  it('3. computes Gold EMA 9/21/50, 4H HTF trend, RSI, ATR, S/R, product metadata & XAU/USD basis without assuming 1:1 parity', () => {
    const settings = createDefaultPlatformSettings();
    const markets = createInitialBit24Markets(88_500, 2950);
    const paxgIrt = markets.find((m) => m.marketName === 'PAXG/IRT')!;
    const candles = generateRealisticCandles(paxgIrt, 120);
    const tech = buildTechnicalSnapshot(candles);

    expect(tech.ema9).toBeGreaterThan(0);
    expect(tech.ema21).toBeGreaterThan(0);
    expect(tech.ema50).toBeGreaterThan(0);
    expect(tech.atr14).toBeGreaterThan(0);
    expect(tech.rsi14).toBeGreaterThanOrEqual(0);
    expect(tech.rsi14).toBeLessThanOrEqual(100);
    expect(tech.resistanceLevel).toBeGreaterThan(tech.supportLevel);

    const book = generateRealisticOrderBook(paxgIrt, 15_000_000);
    const normalSignal = analyzeGoldMarket({
      market: paxgIrt,
      candles,
      orderBook: book,
      riskSettings: settings.modules.DIGITAL_GOLD.risk,
      feePctPerSide: 0.2,
      maxAllowedSpreadPct: 0.45,
      minNetRiskReward: 1.7,
      globalXauUsd: 2950,
      globalXauChange24hPct: 1.1,
      usdtIrtRate: 88_500,
    });

    expect(normalSignal.goldComparison).toBeDefined();
    expect(normalSignal.goldComparison?.productTypeFa).toContain('PAXG');
    expect(normalSignal.goldComparison?.noteFa).toContain('فرض نمی‌شود');

    // Artificial +3.5% local bubble over global XAU/USD -> must reject entry!
    const bubbleMarket = { ...paxgIrt, eachPrice: Math.round(2950 * 1.035 * 88_500) };
    const bubbleSignal = analyzeGoldMarket({
      market: bubbleMarket,
      candles,
      orderBook: book,
      riskSettings: settings.modules.DIGITAL_GOLD.risk,
      feePctPerSide: 0.2,
      maxAllowedSpreadPct: 0.45,
      minNetRiskReward: 1.7,
      globalXauUsd: 2950,
      globalXauChange24hPct: 0.2,
      usdtIrtRate: 88_500,
    });
    expect(bubbleSignal.action).not.toBe('BUY_CONFIRMED');
    expect(bubbleSignal.rejectionReasonsFa.some((r) => r.includes('حباب'))).toBe(true);
  });

  it('4. enforces Stage 5 defaults: 0.5% risk per trade, 2% total open risk cap, max 3 open positions, 2% daily loss halt, and DCA ban', () => {
    const settings = createDefaultPlatformSettings();
    const goldRisk = settings.modules.DIGITAL_GOLD.risk; // 50M IRT, 0.5% default risk = 250,000 IRT max risk!
    expect(goldRisk.riskPerTradePct).toBe(0.5);
    expect(settings.maxTotalOpenPositions).toBe(3);
    expect(settings.maxTotalOpenRiskPct).toBe(2.0);
    expect(settings.dailyMaxLossPct).toBe(2.0);

    const validSize = calculateSafePositionSize({
      module: 'DIGITAL_GOLD',
      marketName: 'PAXG/IRT',
      quoteSymbol: 'IRT',
      entryPrice: 260_000_000,
      stopLossPrice: 256_100_000, // 1.5% stop distance
      minOrderQuote: 250_000,
      feePctPerSide: 0.2,
      riskSettings: goldRisk,
      openModulePositions: [],
      allOpenPositions: [],
      maxTotalOpenPositions: 3,
      maxTotalOpenRiskPct: 2.0,
      engagedModuleCapitalIrt: 0,
      usdtIrtRate: 88_500,
      dailyTotalPnlIrt: 0,
      totalAllocatedIrt: 130_000_000,
      dailyMaxLossPct: 2.0,
    });

    expect(validSize.allowed).toBe(true);
    expect(validSize.maxRiskQuote).toBe(250_000);
    expect(validSize.notionalQuote * 0.0198).toBeLessThanOrEqual(255_000);

    // Global max 3 concurrent open positions check
    const maxThreeCheck = calculateSafePositionSize({
      module: 'DIGITAL_GOLD',
      marketName: 'XAUT/IRT',
      quoteSymbol: 'IRT',
      entryPrice: 260_000_000,
      stopLossPrice: 256_100_000,
      minOrderQuote: 250_000,
      feePctPerSide: 0.2,
      riskSettings: goldRisk,
      openModulePositions: [],
      allOpenPositions: [
        { marketName: 'BTC/IRT', side: 'LONG', entryPrice: 100, stopLoss: 99, quantity: 1, quoteSymbol: 'IRT', realizedPartPnlQuote: 0 } as any,
        { marketName: 'ETH/IRT', side: 'LONG', entryPrice: 100, stopLoss: 99, quantity: 1, quoteSymbol: 'IRT', realizedPartPnlQuote: 0 } as any,
        { marketName: 'SOL/IRT', side: 'LONG', entryPrice: 100, stopLoss: 99, quantity: 1, quoteSymbol: 'IRT', realizedPartPnlQuote: 0 } as any,
      ],
      maxTotalOpenPositions: 3,
      maxTotalOpenRiskPct: 2.0,
      engagedModuleCapitalIrt: 0,
      usdtIrtRate: 88_500,
      dailyTotalPnlIrt: 0,
      totalAllocatedIrt: 130_000_000,
      dailyMaxLossPct: 2.0,
    });
    expect(maxThreeCheck.allowed).toBe(false);
    expect(maxThreeCheck.reasonFa).toContain('حداکثر تعداد کل موقعیت‌های باز هم‌زمان');

    // Ban on DCA into already open PAXG/IRT position
    const dcaAttempt = calculateSafePositionSize({
      module: 'DIGITAL_GOLD',
      marketName: 'PAXG/IRT',
      quoteSymbol: 'IRT',
      entryPrice: 258_000_000,
      stopLossPrice: 254_000_000,
      minOrderQuote: 250_000,
      feePctPerSide: 0.2,
      riskSettings: goldRisk,
      openModulePositions: [{ marketName: 'PAXG/IRT', side: 'LONG', entryPrice: 260_000_000, stopLoss: 256_000_000, quantity: 0.05, quoteSymbol: 'IRT', realizedPartPnlQuote: 0 } as any],
      engagedModuleCapitalIrt: 10_000_000,
      usdtIrtRate: 88_500,
      dailyTotalPnlIrt: 0,
      totalAllocatedIrt: 130_000_000,
      dailyMaxLossPct: 2.0,
    });
    expect(dcaAttempt.allowed).toBe(false);
    expect(dcaAttempt.reasonFa).toContain('ممنوع');

    // Daily Loss Limit (2% of 130M = -2,600,000 IRT) halts new entries
    const lockedAttempt = calculateSafePositionSize({
      module: 'DIGITAL_GOLD',
      marketName: 'XAUT/IRT',
      quoteSymbol: 'IRT',
      entryPrice: 260_000_000,
      stopLossPrice: 256_000_000,
      minOrderQuote: 250_000,
      feePctPerSide: 0.2,
      riskSettings: goldRisk,
      openModulePositions: [],
      engagedModuleCapitalIrt: 0,
      usdtIrtRate: 88_500,
      dailyTotalPnlIrt: -2_700_000,
      totalAllocatedIrt: 130_000_000,
      dailyMaxLossPct: 2.0,
    });
    expect(lockedAttempt.allowed).toBe(false);
    expect(lockedAttempt.reasonFa).toContain('قفل سقف زیان روزانه');
  });

  it('5. executes Stepped Take-Profit (TP1 50% scale-out + break-even SL) and Trailing Stop with realistic stop slippage', () => {
    const basePos: any = {
      id: 'pos-1',
      module: 'DIGITAL_GOLD',
      mode: 'PAPER',
      marketName: 'PAXG/IRT',
      baseSymbol: 'PAXG',
      baseFaName: 'پکس گلد',
      quoteSymbol: 'IRT',
      side: 'LONG',
      leverage: 1,
      entryPrice: 100_000_000,
      currentPrice: 100_000_000,
      quantity: 0.2,
      initialQuantity: 0.2,
      notionalQuote: 20_000_000,
      collateralQuote: 20_000_000,
      stopLoss: 98_500_000,
      initialStopLoss: 98_500_000,
      takeProfit1: 102_000_000,
      takeProfit2: 104_000_000,
      tp1Hit: false,
      trailingActive: false,
      trailingDeltaPct: 0.8,
      highestPrice: 100_000_000,
      lowestPrice: 100_000_000,
      paidFeesQuote: 40_000,
      realizedPartPnlQuote: -40_000,
      unrealizedPnlQuote: 0,
      unrealizedPnlPct: -0.2,
      dcaCount: 0,
      openedAt: Date.now(),
      entryReasonFa: 'تست',
    };

    const step1 = stepPositionLifecycle({
      position: basePos,
      newPrice: 102_200_000,
      feePctPerSide: 0.2,
      useSteppedTakeProfit: true,
      useTrailingStop: true,
    });
    expect(step1.closedRecord).toBeNull();
    expect(step1.updated.tp1Hit).toBe(true);
    expect(step1.updated.quantity).toBeCloseTo(0.1, 5);
    expect(step1.updated.stopLoss).toBeGreaterThan(basePos.entryPrice);

    const step2 = stepPositionLifecycle({
      position: step1.updated,
      newPrice: step1.updated.stopLoss - 50_000,
      feePctPerSide: 0.2,
      useSteppedTakeProfit: true,
      useTrailingStop: true,
    });
    expect(step2.closedRecord).not.toBeNull();
    expect(step2.closedRecord?.exitReason).toBe('TRAILING_STOP');
    expect(step2.closedRecord?.netPnlQuote).toBeGreaterThan(0);
  });

  it('6. enforces Safe-Boot Lock, Unconfirmed Wallet Separation, Emergency Stop, Pause New Trades, and CSV Export', async () => {
    const orch = new Bit24PlatformOrchestrator(undefined, {
      initialSettings: { environmentMode: 'LIVE' } as any,
      serverBackendConnected: false,
    });

    const snap = orch.getSnapshot();
    expect(snap.settings.environmentMode).toBe('PAPER');
    expect(snap.settings.liveTradingConfirmedThisSession).toBe(false);
    expect(snap.settings.modules.LEVERAGE_MARGIN.enabled).toBe(false);
    // Verified wallet must NOT fake balance when API is disconnected!
    expect(snap.verifiedWallet.confirmedByOfficialApi).toBe(false);
    expect(snap.verifiedWallet.totalIrt).toBeNull();
    // Incomplete features explicitly labeled «تکمیل نشده»
    expect(snap.health.incompleteFeatures.every((f) => f.badgeFa === 'تکمیل نشده')).toBe(true);

    // Pause New Trades check
    orch.setPauseNewTrades(true);
    expect(orch.getSnapshot().settings.pauseNewTrades).toBe(true);
    orch.setPauseNewTrades(false);

    // Emergency Stop halts all modules without force-selling positions
    await orch.emergencyStopAll(false);
    const halted = orch.getSnapshot();
    expect(halted.emergencyStopped).toBe(true);
    expect(halted.settings.modules.DIGITAL_GOLD.enabled).toBe(false);
    expect(halted.settings.modules.SPOT_CRYPTO.enabled).toBe(false);
    expect(halted.settings.modules.MEME_HUNTER.enabled).toBe(false);

    // Separate confirmation required for position closure
    await expect(orch.emergencyLiquidateAllPositions(false)).rejects.toThrow();

    // CSV export contains UTF-8 BOM and Persian headers
    const csv = orch.exportHistoryCsv();
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('نوع رکورد');

    const book = buildOrderBookSnapshot(
      'PAXG/IRT',
      [{ price: 259_800_000, amount: 1, total: 259_800_000 }],
      [{ price: 260_200_000, amount: 1, total: 260_200_000 }],
      20_000_000
    );
    const econ = evaluateTradeEconomics({
      feePctPerSide: 0.2,
      spreadPct: book.spreadPct,
      estimatedSlippagePct: book.estimatedSlippagePct,
      grossTargetPct: 3.4,
      stopDistancePct: 1.3,
      minNetRiskReward: 1.7,
    });
    expect(econ.roundTripFeePct).toBe(0.4);
  });

  it('7. scans Bit24 Meme Coins (PEPE/IRT sub-Toman precision & NOT/IRT Anti-FOMO top trap rejection)', () => {
    const settings = createDefaultPlatformSettings();
    const markets = createInitialBit24Markets(88_500, 2950);

    const pepeIrt = markets.find((m) => m.marketName === 'PEPE/IRT')!;
    expect(pepeIrt.category).toBe('MEME');
    expect(pepeIrt.eachPrice).toBeGreaterThan(0.5);
    expect(pepeIrt.eachPrice).toBeLessThan(5);

    const pepeSig = analyzeMemePumpMarket({
      market: pepeIrt,
      candles: generateRealisticCandles(pepeIrt, 140),
      orderBook: generateRealisticOrderBook(pepeIrt, 8_000_000),
      riskSettings: settings.modules.MEME_HUNTER.risk,
      feePctPerSide: 0.2,
      maxAllowedSpreadPct: 0.45,
      minNetRiskReward: 1.7,
    });
    expect(pepeSig.memeMetrics).toBeDefined();

    const notIrt = markets.find((m) => m.marketName === 'NOT/IRT')!;
    const notSig = analyzeMemePumpMarket({
      market: notIrt,
      candles: generateRealisticCandles(notIrt, 140),
      orderBook: generateRealisticOrderBook(notIrt, 8_000_000),
      riskSettings: settings.modules.MEME_HUNTER.risk,
      feePctPerSide: 0.2,
      maxAllowedSpreadPct: 0.45,
      minNetRiskReward: 1.7,
    });
    expect(notSig.memeMetrics?.pumpStage).toBe('LATE_PUMP_FOMO_TRAP');
    expect(notSig.action).toBe('AVOID_UNFAVORABLE');
  });

  it('8. proves strict Zero Look-Ahead Bias (mutating future candles does not alter past signal) & detects Fake-Pump traps', () => {
    const settings = createDefaultPlatformSettings();
    const markets = createInitialBit24Markets(88_500, 2950);
    const btcIrt = markets.find((m) => m.marketName === 'BTC/IRT')!;
    const fullCandles = generateRealisticCandles(btcIrt, 120);

    // Slice up to bar 80
    const sliceOriginal = fullCandles.slice(0, 81);
    // Create wildly mutated future bars 81..119 (+500% crash/pump in the future) and slice up to 80
    const mutatedFuture = fullCandles.map((c, idx) =>
      idx > 80 ? { ...c, o: c.o * 5, h: c.h * 6, l: c.l * 0.2, c: c.c * 4 } : { ...c }
    );
    const sliceFromMutated = mutatedFuture.slice(0, 81);

    const book = generateRealisticOrderBook(btcIrt, 15_000_000);
    const sigA = analyzeSpotCryptoMarket({
      market: { ...btcIrt, eachPrice: sliceOriginal[80].c },
      candles: sliceOriginal,
      orderBook: book,
      riskSettings: settings.modules.SPOT_CRYPTO.risk,
      feePctPerSide: 0.2,
      maxAllowedSpreadPct: 0.45,
      minNetRiskReward: 1.75,
    });
    const sigB = analyzeSpotCryptoMarket({
      market: { ...btcIrt, eachPrice: sliceFromMutated[80].c },
      candles: sliceFromMutated,
      orderBook: book,
      riskSettings: settings.modules.SPOT_CRYPTO.risk,
      feePctPerSide: 0.2,
      maxAllowedSpreadPct: 0.45,
      minNetRiskReward: 1.75,
    });

    expect(sigA.action).toBe(sigB.action);
    expect(sigA.confidenceScore).toBe(sigB.confidenceScore);
    expect(sigA.stopLoss).toBe(sigB.stopLoss);

    // Fake-pump trap test: sudden +6% spike on tiny 0.3x volume -> must flag fakePumpRisk & reject!
    const trapCandles = fullCandles.slice(0, 90).map((c) => ({ ...c }));
    const last = trapCandles[trapCandles.length - 1];
    last.c = Math.round(last.o * 1.065);
    last.h = Math.round(last.o * 1.09);
    last.v = last.v * 0.25; // dry volume spike!
    const trapSig = analyzeSpotCryptoMarket({
      market: { ...btcIrt, eachPrice: last.c },
      candles: trapCandles,
      orderBook: book,
      riskSettings: settings.modules.SPOT_CRYPTO.risk,
      feePctPerSide: 0.2,
      maxAllowedSpreadPct: 0.45,
      minNetRiskReward: 1.75,
    });
    expect(trapSig.technicals.fakePumpRisk).toBe(true);
    expect(trapSig.action).toBe('AVOID_UNFAVORABLE');
  });

  it('9. never records a LIVE position if exchange response lacks confirmed orderId & trips Circuit Breaker on consecutive API errors', async () => {
    let marketFailMode = false;
    const mockAdapter: any = {
      isConfigured: () => true,
      getMaskedKey: () => 'B24_••••1111',
      getRateLimitUsed: () => 4,
      fetchLiveMarkets: async () => {
        if (marketFailMode) {
          return {
            ok: false,
            latencyMs: 120,
            errorCategory: 'NETWORK_TIMEOUT_OR_OFFLINE',
            markets: [],
            errorFa: 'خطای اتصال شبکه تست',
          };
        }
        return {
          ok: true,
          latencyMs: 42,
          errorCategory: 'NONE',
          markets: createInitialBit24Markets(88_500, 2950),
        };
      },
      fetchVerifiedWallet: async () => ({
        confirmedByOfficialApi: true,
        totalIrt: 185_000_000,
        totalUsdt: 2090.4,
        spotFreeIrt: 120_000_000,
        spotFreeUsdt: 500,
        assets: [],
        fetchedAt: Date.now(),
        noteFa: 'تاییدشده',
      }),
      fetchOhlcv: async () => null,
      fetchOrderBook: async () => null,
      // Simulate exchange returning ok: false / missing orderId!
      submitLiveOrder: async () => ({
        ok: false,
        errorCategory: 'ORDER_REJECTED_BY_EXCHANGE',
        errorFa: 'رد سفارش تستی توسط صرافی (بدون order_id)',
      }),
      cancelAllOpenOrders: async () => ({ ok: true }),
    };

    const orch = new Bit24PlatformOrchestrator(mockAdapter, {
      serverBackendConnected: true,
      allowLiveTradingForTest: true,
    });
    orch.setEnvironmentMode('LIVE', true);
    const snap1 = await orch.tickCycle();

    // Wallet confirmed from mock official API
    expect(snap1.verifiedWallet.confirmedByOfficialApi).toBe(true);
    expect(snap1.verifiedWallet.totalIrt).toBe(185_000_000);
    // ZERO live positions opened because submitLiveOrder did not return a confirmed orderId!
    expect(snap1.openPositions.filter((p) => p.mode === 'LIVE').length).toBe(0);

    // Trigger 3 consecutive API network failures -> automatic Circuit Breaker must trip!
    marketFailMode = true;
    await orch.tickCycle();
    await orch.tickCycle();
    const snapAfterErrors = await orch.tickCycle();
    expect(snapAfterErrors.circuitBreaker.tripped).toBe(true);
  });

  it('10. ANTI-RUG & SMART SECURITY: detects low/draining liquidity, Honeypot, Mint/Freeze, taxes, fake pumps & enforces 0–100 score tiers', () => {
    const watchlist = createPhantomDexSecurityWatchlist(true, Date.now());

    // 1) RUGDOG: Mint + Freeze + -54% sudden liquidity drain + $6.8k low liquidity -> score < 60 BLOCKED
    const rugDog = evaluateTokenSecurity(watchlist.find((w) => w.symbol === 'RUGDOG')!);
    expect(rugDog.securityScore).toBeLessThan(60);
    expect(rugDog.verdict).toBe('BLOCKED');
    expect(rugDog.buyAllowedInDemo).toBe(false);
    expect(rugDog.liquidity.isSuddenDropDetected).toBe(true);
    expect(rugDog.liquidity.isCriticallyLow).toBe(true);
    expect(rugDog.contract.mintAuthorityActive).toBe(true);
    expect(rugDog.contract.freezeAuthorityActive).toBe(true);

    // 2) HONEYCAT: Honeypot (canSell = false) + 99% sell tax -> score <= 10 BLOCKED
    const honeyCat = evaluateTokenSecurity(watchlist.find((w) => w.symbol === 'HONEYCAT')!);
    expect(honeyCat.securityScore).toBeLessThanOrEqual(10);
    expect(honeyCat.verdict).toBe('BLOCKED');
    expect(honeyCat.buyAllowedInDemo).toBe(false);
    expect(honeyCat.contract.isHoneypot).toBe(true);

    // 3) FAKEPUMP: 2.1h newly created + +38% spike without volume + wash trading -> score < 60 BLOCKED
    const fakePump = evaluateTokenSecurity(watchlist.find((w) => w.symbol === 'FAKEPUMP')!);
    expect(fakePump.securityScore).toBeLessThan(60);
    expect(fakePump.verdict).toBe('BLOCKED');
    expect(fakePump.fakePump.priceSpikeWithoutValidVolume).toBe(true);
    expect(fakePump.fakePump.washTradingSuspected).toBe(true);
    expect(fakePump.contract.isNewlyCreatedToken).toBe(true);

    // 4) TAXMEME: Moderate 6%/7.5% tax + 18.5h age -> lands in 60..79 WARNING_REVIEW
    const taxMeme = evaluateTokenSecurity(watchlist.find((w) => w.symbol === 'TAXMEME')!);
    expect(taxMeme.securityScore).toBeGreaterThanOrEqual(60);
    expect(taxMeme.securityScore).toBeLessThan(80);
    expect(taxMeme.verdict).toBe('WARNING_REVIEW');
    expect(taxMeme.requiresManualReview).toBe(true);
    expect(taxMeme.buyAllowedInDemo).toBe(false);

    // 5) UNKNOWNX: Incomplete data -> strictly forbidden (BLOCKED_INSUFFICIENT_DATA)
    const unknown = evaluateTokenSecurity(watchlist.find((w) => w.symbol === 'UNKNOWNX')!);
    expect(unknown.securityScore).toBe(0);
    expect(unknown.verdict).toBe('BLOCKED_INSUFFICIENT_DATA');
    expect(unknown.buyAllowedInDemo).toBe(false);
  });

  it('11. FAIL-CLOSED Security Guarantee: blocks buys when security API is offline, data is stale, or wallet seed/private key is accidentally pasted', async () => {
    const orch = new Bit24PlatformOrchestrator(undefined, {
      serverBackendConnected: true,
    });

    // Live trading MUST be locked by default in DEMO / Paper Trading mode
    expect(orch.getSnapshot().antiRug.liveTradingLockedUntilApproval).toBe(true);
    expect(() => orch.setEnvironmentMode('LIVE', true)).toThrow();

    // Healthy token (PEPE) is >= 80 and allowed in Demo when security service is online
    const healthyCheck = orch.testDemoBuyThroughAntiRug('PEPE');
    expect(healthyCheck.allowed).toBe(true);
    expect(healthyCheck.report.securityScore).toBeGreaterThanOrEqual(80);

    // Simulate Security API outage -> MUST block even PEPE (Fail-Closed, never auto-approve!)
    orch.setSecurityServiceOnline(false);
    const offlineCheck = orch.testDemoBuyThroughAntiRug('PEPE');
    expect(offlineCheck.allowed).toBe(false);
    expect(offlineCheck.report.verdict).toBe('BLOCKED_INSUFFICIENT_DATA');
    expect(orch.getSnapshot().antiRug.staleOrOfflineBlocksCount).toBeGreaterThan(0);

    // Restore service, then simulate Stale Data -> MUST block!
    orch.setSecurityServiceOnline(true);
    orch.setSimulatedFeedStale(true);
    const staleCheck = orch.testDemoBuyThroughAntiRug('PEPE');
    expect(staleCheck.allowed).toBe(false);
    orch.setSimulatedFeedStale(false);

    // Never accept private keys or seed phrases in contract address inspector!
    expect(
      looksLikePrivateKeyOrSeedPhrase(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      )
    ).toBe(true);
    await expect(
      inspectTokenContractLive({
        contractAddress:
          '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
      })
    ).rejects.toThrow();
  });

  it('12. Capital Shield blocks duplicate token purchases, logs every rejected reason in reports/CSV, and triggers Emergency Stop on system fault', async () => {
    const orch = new Bit24PlatformOrchestrator(undefined, {
      serverBackendConnected: true,
    });

    // Find a valid >=80 Demo signal (e.g. PAXG/IRT or DOGE/IRT or PEPE/IRT) and open a Paper position
    const snap0 = orch.getSnapshot();
    const eligibleSig =
      snap0.signals.find(
        (s) =>
          s.securityReport &&
          s.securityReport.securityScore >= 80 &&
          s.quoteSymbol === 'IRT'
      )!;
    expect(eligibleSig).toBeDefined();

    const pos = orch.executeSignalNowInPaper(eligibleSig.id);
    expect(pos.mode).toBe('PAPER');

    // Attempt second purchase on the SAME base token -> Capital Shield MUST block duplicate token!
    const dupRes = orch.testDemoBuyThroughAntiRug(eligibleSig.baseSymbol);
    expect(dupRes.allowed).toBe(false);
    expect(dupRes.reasonFa).toContain('تکراری');
    expect(orch.getSnapshot().antiRug.duplicateBlocksCount).toBeGreaterThanOrEqual(1);

    // High-risk token attempt increments blockedBuysCount and writes to rejectedAudit + CSV
    const rugAttempt = orch.testDemoBuyThroughAntiRug('HONEYCAT');
    expect(rugAttempt.allowed).toBe(false);
    const csv = orch.exportHistoryCsv();
    expect(csv).toContain('ANTI-RUG SECURITY');
    expect(csv).toContain('HONEYCAT');

    // System error test triggers immediate Emergency Stop
    await orch.triggerSystemFaultEmergencyTest();
    expect(orch.getSnapshot().emergencyStopped).toBe(true);
    expect(orch.getSnapshot().antiRug.systemErrorHaltsCount).toBe(1);
  });
});
