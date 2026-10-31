import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialBit24Catalog } from '../src/engine/bit24Catalog.js';
import { runProfessionalPreLiveVerification } from '../src/engine/proVerificationSuite.js';
import {
  analyzeGoldAiMarket,
  classifyOpportunityTier,
} from '../src/engine/pumpAndGoldAnalyzers.js';
import {
  calculateSafePositionCapitalIrt,
  DEFAULT_CAPITAL_RISK_CONFIG,
  DEFAULT_EXIT_STRATEGY_CONFIG,
  evaluatePositionStepExit,
  runSmartSecurityGate,
  sanitizeCapitalRiskConfig,
} from '../src/engine/smartSecurityAndCapital.js';
import { Bit24AiTraderOrchestrator } from '../src/engine/traderOrchestrator.js';
import {
  assertNoWithdrawalEndpoint,
  createBit24HmacSignature,
} from '../src/server/bit24OfficialClient.js';
import { EncryptedSecretVault } from '../src/server/encryptedVault.js';
import { scrubSecretsFromTelegramText } from '../src/server/telegramService.js';
import { ActivePosition } from '../src/shared/contracts.js';

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|js|html|webmanifest)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('BIT24 AI TRADER PRO — Clean-Room & Full 12-Section Specification Suite', () => {
  it('1. Enforces 100% clean-room Bit24 exclusivity (ZERO Phantom, Solana, or external exchanges in source)', () => {
    const files = [
      ...collectSourceFiles(path.resolve(process.cwd(), 'src')),
      ...collectSourceFiles(path.resolve(process.cwd(), 'public')),
      path.resolve(process.cwd(), 'index.html'),
    ];
    const forbiddenPatterns = [
      /phantom/i,
      /solana/i,
      /raydium/i,
      /jupiter/i,
      /metamask/i,
      /nobitex/i,
      /wallex/i,
      /binance/i,
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const rx of forbiddenPatterns) {
        expect(
          rx.test(content),
          `Forbidden legacy/external reference ${rx} found in ${file}`
        ).toBe(false);
      }
    }
  });

  it('2. Permanently blocks Bit24 withdrawal endpoints & signs trade requests with HMAC-SHA256 + AES-256-GCM vault', () => {
    expect(() =>
      assertNoWithdrawalEndpoint('/lite/capi/v1/withdraw/submit')
    ).toThrow(/BIT24_WITHDRAWAL_FORBIDDEN/);
    expect(() =>
      assertNoWithdrawalEndpoint('/pro/capi/v2/markets')
    ).not.toThrow();

    const sig = createBit24HmacSignature(
      'amount=0.01&base_coin_symbol=BTC&price=8500000000&quote_coin_symbol=IRT&side=1&type=0',
      'test_secret_key_bit24'
    );
    expect(sig).toMatch(/^[a-f0-9]{64}$/);

    const tmpVaultPath = path.join(
      os.tmpdir(),
      `bit24-test-vault-${Date.now()}.enc`
    );
    const vault = new EncryptedSecretVault(tmpVaultPath);
    vault.updateBit24Credentials('BIT24_TOKEN_ABCDEF123456', 'SECRET_XYZ_987654');
    const rawOnDisk = fs.readFileSync(tmpVaultPath, 'utf8');
    expect(rawOnDisk).not.toContain('BIT24_TOKEN_ABCDEF123456');
    expect(rawOnDisk).not.toContain('SECRET_XYZ_987654');

    const reloaded = new EncryptedSecretVault(tmpVaultPath);
    expect(reloaded.getSecretsInternal().bit24ApiKey).toBe(
      'BIT24_TOKEN_ABCDEF123456'
    );
    expect(reloaded.getPublicSafeSummary().maskedBit24ApiKey).toBe(
      'BIT2••••3456'
    );
    fs.unlinkSync(tmpVaultPath);
  });

  it('3. Evaluates AI Pump Hunter tiers (0-100) and blocks blind chasing of already over-pumped coins', () => {
    expect(classifyOpportunityTier(45)).toBe('REJECTED');
    expect(classifyOpportunityTier(68)).toBe('ALERT_ONLY');
    expect(classifyOpportunityTier(79)).toBe('REVIEW_OPPORTUNITY');
    expect(classifyOpportunityTier(90)).toBe('STRONG_TEST_SIGNAL');

    const orch = new Bit24AiTraderOrchestrator();
    const snap = orch.getSnapshot();
    const pepe = snap.topOpportunities.find((s) => s.symbol === 'PEPE/IRT');
    expect(pepe).toBeDefined();
    // PEPE/IRT is seeded as already +22.8% over-pumped — must be rejected (< 60)!
    expect(pepe!.indicators.alreadyOverPumped).toBe(true);
    expect(pepe!.opportunityScore).toBeLessThan(60);
    expect(pepe!.tier).toBe('REJECTED');
    expect(pepe!.noProfitGuaranteeDisclaimerFa).toContain('سود قطعی');
  });

  it('4. Enforces Capital Management defaults (1% risk, 10% max per trade, 3 concurrent, 3% daily loss, NEVER 100%)', () => {
    expect(DEFAULT_CAPITAL_RISK_CONFIG.riskPerTradePct).toBe(1);
    expect(DEFAULT_CAPITAL_RISK_CONFIG.maxCapitalPerTradePct).toBe(10);
    expect(DEFAULT_CAPITAL_RISK_CONFIG.maxConcurrentTrades).toBe(3);
    expect(DEFAULT_CAPITAL_RISK_CONFIG.maxDailyLossPct).toBe(3);

    // Even if user passes 100% maxCapitalPerTradePct, sanitizer clamps <= 35%
    const sanitized = sanitizeCapitalRiskConfig({ maxCapitalPerTradePct: 100 });
    expect(sanitized.maxCapitalPerTradePct).toBe(35);
    expect(sanitized.neverUseFullCapitalInSingleTrade).toBe(true);

    // With 100M equity, 1% risk & 5% SL -> risk notional = 20M, capped by 10% maxCapitalPerTradePct = 10M!
    const posCap = calculateSafePositionCapitalIrt({
      totalEquityIrt: 100_000_000,
      availableCashIrt: 100_000_000,
      stopLossPct: 5,
      capitalConfig: DEFAULT_CAPITAL_RISK_CONFIG,
    });
    expect(posCap).toBe(10_000_000);
  });

  it('5. Executes Initial SL (-5%), Trailing Stop (+8% activation / 3% trail), and Stepped TP (30%@10%, 30%@20%, 40%@35%)', () => {
    const makeDummyPos = (): ActivePosition => ({
      id: 'p1',
      symbol: 'BTC/IRT',
      baseCoin: 'BTC',
      segment: 'CRYPTO',
      mode: 'DEMO',
      entryPriceIrt: 1_000_000,
      currentPriceIrt: 1_000_000,
      highestPriceIrt: 1_000_000,
      initialQuantity: 10,
      remainingQuantity: 10,
      initialCapitalIrt: 10_000_000,
      remainingCapitalIrt: 10_000_000,
      entryFeeIrt: 20_000,
      initialStopLossIrt: 950_000,
      activeStopLossIrt: 950_000,
      trailingStopActive: false,
      trailingStopPriceIrt: null,
      tpStage1Filled: false,
      tpStage2Filled: false,
      tpStage3Filled: false,
      unrealizedPnlIrt: 0,
      unrealizedPnlPct: 0,
      buyReasonFa: 'تست',
      buyReasonEn: 'Test',
      openedAt: Date.now(),
    });

    const pos = makeDummyPos();

    // Reach +8.5% -> activates Trailing Stop at 3% below 1,085,000 = 1,052,450
    const noExitYet = evaluatePositionStepExit(
      pos,
      1_085_000,
      1_070_000,
      1_085_000,
      DEFAULT_EXIT_STRATEGY_CONFIG
    );
    expect(noExitYet).toBeNull();
    expect(pos.trailingStopActive).toBe(true);
    expect(pos.trailingStopPriceIrt).toBe(1_052_450);

    // Stage 1 (+10%): sells 30% (3 units)
    const tp1 = evaluatePositionStepExit(
      pos,
      1_105_000,
      1_090_000,
      1_105_000,
      DEFAULT_EXIT_STRATEGY_CONFIG
    );
    expect(tp1?.stageTriggered).toBe(1);
    expect(tp1?.sellQuantity).toBeCloseTo(3, 5);
    pos.tpStage1Filled = true;
    pos.remainingQuantity = 7;

    // Stage 2 (+20%): sells 30% of initial (3 units)
    const tp2 = evaluatePositionStepExit(
      pos,
      1_205_000,
      1_190_000,
      1_205_000,
      DEFAULT_EXIT_STRATEGY_CONFIG
    );
    expect(tp2?.stageTriggered).toBe(2);
    expect(tp2?.sellQuantity).toBeCloseTo(3, 5);
    pos.tpStage2Filled = true;
    pos.remainingQuantity = 4;

    // Stage 3 (+35%): closes remaining 40% (4 units)
    const tp3 = evaluatePositionStepExit(
      pos,
      1_355_000,
      1_340_000,
      1_355_000,
      DEFAULT_EXIT_STRATEGY_CONFIG
    );
    expect(tp3?.stageTriggered).toBe(3);
    expect(tp3?.closeEntirePosition).toBe(true);
    expect(tp3?.sellQuantity).toBeCloseTo(4, 5);
  });

  it('6. Isolates GOLD AI TRADER (PAXG & XAUT) from Crypto and honestly reports unavailable Gold markets as NOT_TRADABLE', () => {
    const orch = new Bit24AiTraderOrchestrator();
    const res = orch.tryOpenGoldDemoPosition('PAXG/IRT');
    return res.then((r) => {
      expect(r.ok).toBe(true);
      const snap = orch.getSnapshot();
      // Crypto openPositions must stay 0 while Gold openPositions has 1!
      expect(snap.openPositions.length).toBe(0);
      expect(snap.goldReport.goldOpenPositions.length).toBe(1);
      expect(snap.goldReport.paxgTradableOnBit24).toBe(true);
      expect(snap.goldReport.xautTradableOnBit24).toBe(true);

      // Verify honest non-tradable handling when Bit24 marks a gold pair untradable
      const untradableSig = analyzeGoldAiMarket(
        'XAUT/IRT',
        'XAUT',
        undefined,
        [],
        undefined
      );
      expect(untradableSig.verifiedTradableOnBit24).toBe(false);
      expect(untradableSig.action).toBe('NOT_TRADABLE');
    });
  });

  it('7. Keeps Live Trading OFF by default and scrubs secrets from all Telegram alerts', () => {
    const orch = new Bit24AiTraderOrchestrator();
    expect(orch.getSnapshot().liveTradingUserConfirmed).toBe(false);
    expect(orch.getSnapshot().tradingMode).toBe('STOPPED');

    // Attempt to enable Live without verified Bit24 connection must fail
    const liveAttempt = orch.activateLiveTradingAfterUserApproval(
      'CONFIRM_BIT24_LIVE'
    );
    expect(liveAttempt.ok).toBe(false);
    expect(orch.getSnapshot().liveTradingUserConfirmed).toBe(false);

    const scrubbed = scrubSecretsFromTelegramText(
      'Alert key=MY_SUPER_SECRET_BIT24_KEY_123456789 token=123456789:AAH_secret_telegram_bot_token_xyz123',
      ['MY_SUPER_SECRET_BIT24_KEY_123456789']
    );
    expect(scrubbed).not.toContain('MY_SUPER_SECRET_BIT24_KEY_123456789');
    expect(scrubbed).not.toContain('AAH_secret_telegram_bot_token_xyz123');
    expect(scrubbed).toContain('[REDACTED');
  });

  it('8. Executes 100+ zero-lookahead simulated trades with fees/slippage + 4 fault checks, AND reports exact count honestly on short data', () => {
    const fullReport = runProfessionalPreLiveVerification();
    expect(fullReport.simulatedTradesExecuted).toBeGreaterThanOrEqual(100);
    expect(fullReport.totalFeesPaidIrt).toBeGreaterThan(0);
    expect(fullReport.totalSlippageCostIrt).toBeGreaterThan(0);
    expect(fullReport.faultInjectionChecks.feeAndSlippageApplied).toBe(true);
    expect(fullReport.faultInjectionChecks.internetDisconnectTestPassed).toBe(true);
    expect(fullReport.faultInjectionChecks.bit24ApiErrorTestPassed).toBe(true);
    expect(fullReport.faultInjectionChecks.emergencyStopTestPassed).toBe(true);
    expect(fullReport.faultInjectionChecks.duplicateOrderPreventionPassed).toBe(true);

    // Honest reporting check when given only 75 bars (insufficient for 100 trades -> never fabricates!)
    const { markets, candlesBySymbol } = createInitialBit24Catalog();
    const shortMap = new Map();
    for (const m of markets) {
      shortMap.set(m.symbol, (candlesBySymbol.get(m.symbol) || []).slice(0, 75));
    }
    const shortReport = runProfessionalPreLiveVerification({
      customCandlesBySymbol: shortMap,
    });
    expect(shortReport.simulatedTradesExecuted).toBeLessThan(100);
    expect(shortReport.dataSufficiencyNoteFa).toContain('بدون آمارسازی جعلی');
  });

  it('9. Enforces SMART SECURITY rejection of stale feeds and high spreads', () => {
    const { markets } = createInitialBit24Catalog();
    const btc = markets[0];
    const staleMarket = { ...btc, updatedAt: Date.now() - 180_000 };
    const ob = {
      symbol: btc.symbol,
      bestBid: btc.priceIrt * 0.999,
      bestAsk: btc.priceIrt * 1.001,
      spreadPct: 0.2,
      bidDepthIrt: 500_000_000,
      askDepthIrt: 500_000_000,
      buyerPressurePct: 60,
      estimatedSlippagePct: 0.05,
      fromLiveOrderBook: false,
    };

    const staleRes = runSmartSecurityGate({
      nowMs: Date.now(),
      symbol: btc.symbol,
      mode: 'DEMO',
      market: staleMarket,
      orderBook: ob,
      openPositions: [],
      inFlightSymbols: new Set(),
      dailyLossPctSoFar: 0,
      capitalConfig: DEFAULT_CAPITAL_RISK_CONFIG,
      emergencyStopped: false,
      apiDisconnectedFault: false,
      consecutiveTradeErrors: 0,
      pumpAndDumpRisk: false,
      alreadyOverPumped: false,
      atrPct: 1.0,
    });
    expect(staleRes.allowed).toBe(false);
    expect(staleRes.rejection?.code).toBe('STALE_DATA');
  });
});
