import { describe, it, expect, vi, afterEach } from "vitest";
import { Bit24AiTraderOrchestrator as Engine } from "../src/engine/traderOrchestrator.js";
import {
  ledgerAnalytics,
  outcomeStatistics,
} from "../src/engine/ledgerAnalytics.js";
import {
  closedCandles,
  computeRsi14,
  evaluateFullTechnicals,
} from "../src/engine/mathIndicators.js";
import { createInitialBit24Catalog } from "../src/engine/bit24Catalog.js";
import { runProfessionalPreLiveVerification } from "../src/engine/proVerificationSuite.js";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function buy(e: Engine, symbol = "BTC/IRT") {
  const s = e.getSnapshot().topOpportunities.find((s) => s.symbol === symbol)!;
  expect((await e.tryOpenCryptoPosition(s)).ok).toBe(true);
  return e.getSnapshot().openPositions.find((p) => p.symbol === symbol)!;
}
describe("ledger statistics and scope", () => {
  it("shows profitable partial exits immediately but counts a position only after final closure", async () => {
    const e = new Engine(),
      p = await buy(e);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 1.11);
    const s = e.getSnapshot();
    expect(s.accounting.closedExits.count).toBe(1);
    expect(s.accounting.closedExits.wins).toBe(1);
    expect(s.accounting.closedExits.winRatePct).toBe(100);
    expect(s.accounting.closedPositions.count).toBe(0);
    expect(s.accounting.closedPositions.winRatePct).toBe(null);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 1.21);
    await e.closeDemoPosition(p.symbol);
    const done = e.getSnapshot();
    expect(done.accounting.closedExits.count).toBe(3);
    expect(done.accounting.closedPositions.count).toBe(1);
    expect(done.accounting.closedPositions.wins).toBe(1);
  });
  it("reports breakeven separately, null rather than 0% for no sample", () => {
    expect(outcomeStatistics([]).winRatePct).toBe(null);
    expect(outcomeStatistics([10, -10, 0])).toEqual({
      count: 3,
      wins: 1,
      losses: 1,
      breakeven: 1,
      winRatePct: 33.33,
    });
  });
  it("isolates the backtest from dashboard accounting", async () => {
    const e = new Engine();
    await buy(e);
    const before = e.getSnapshot().accounting;
    e.runPro100Verification();
    expect(e.getSnapshot().accounting).toEqual(before);
  });
  it("deduplicates identical fill IDs and rejects conflicting records", async () => {
    const e = new Engine();
    await buy(e);
    await e.closeDemoPosition("BTC/IRT");
    const t = e.getSnapshot().tradeHistory[0];
    expect(ledgerAnalytics([t, t], [], "DEMO").closedExits.count).toBe(1);
    expect(() =>
      ledgerAnalytics([t, { ...t, netPnlIrt: t.netPnlIrt + 1 }], [], "DEMO"),
    ).toThrow("CONFLICTING_FILL_ID");
    expect(
      ledgerAnalytics([{ ...t, mode: "LIVE" }], [], "DEMO").closedExits.count,
    ).toBe(0);
  });
  it("all-account equity equals cash-flow-adjusted principal plus total P&L, including gold", async () => {
    const e = new Engine();
    await buy(e);
    expect((await e.tryOpenGoldDemoPosition("PAXG/IRT")).ok).toBe(true);
    const s = e.getSnapshot();
    expect(s.accounting.equityIrt).toBeCloseTo(
      150000000 + s.accounting.totalPnlIrt,
      5,
    );
    expect(s.accounting.scope).toBe("DEMO:ALL");
  });
  it("charges 0.2% of executed notional, not 0.2% of the fee-inclusive budget", async () => {
    const e = new Engine(),
      p = await buy(e);
    expect(
      Math.abs(p.entryFeeIrt - p.initialQuantity * p.entryPriceIrt * 0.002),
    ).toBeLessThanOrEqual(0.51);
  });
  it("allocates entry fees once across exits, with no double subtraction", async () => {
    const e = new Engine(),
      p = await buy(e);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 1.11);
    await e.closeDemoPosition(p.symbol);
    const s = e.getSnapshot();
    const paid = s.demo.paperOrders.reduce((n, o) => n + o.feeIrt, 0);
    expect(s.accounting.totalFeesIrt).toBeCloseTo(paid, 7);
    expect(s.accounting.realizedPnlIrt).toBeCloseTo(
      s.demoAvailableCashIrt - 100000000,
      0,
    );
    expect(s.accounting.grossPnlIrt - s.accounting.totalFeesIrt).toBeCloseTo(
      s.accounting.realizedPnlIrt,
      5,
    );
  });
});
describe("non-repainting closed-candle analysis", () => {
  it("ignores an extreme forming candle until its interval closes", () => {
    const { candlesBySymbol } = createInitialBit24Catalog();
    const bars = candlesBySymbol.get("BTC/IRT")!;
    const last = bars.at(-1)!;
    const clock = { nowMs: (last.t + 30) * 1000, intervalSeconds: 60 };
    const book = {
      symbol: "BTC/IRT",
      bestBid: 100,
      bestAsk: 101,
      spreadPct: 0.1,
      bidDepthIrt: 1e9,
      askDepthIrt: 1e9,
      buyerPressurePct: 60,
      estimatedSlippagePct: 0.1,
      fromLiveOrderBook: false,
    };
    const changed = [
      ...bars.slice(0, -1),
      { ...last, c: last.c * 10, h: last.c * 11, v: last.v * 1000 },
    ];
    expect(evaluateFullTechnicals(changed, book, 0, clock)).toEqual(
      evaluateFullTechnicals(bars, book, 0, clock),
    );
    expect(closedCandles(bars, clock)).toHaveLength(bars.length - 1);
    expect(
      closedCandles(changed, { ...clock, nowMs: (last.t + 60) * 1000 }),
    ).toHaveLength(bars.length);
  });
  it("rejects duplicate candle timestamps and keeps flat RSI neutral", () => {
    const b = { t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 };
    expect(() => closedCandles([b, b])).toThrow("INVALID_CANDLE_SEQUENCE");
    expect(computeRsi14(Array(30).fill(10))).toBe(50);
  });
  it("uses Unix SECONDS, not millisecond-like synthetic timestamps; safely migrates old fixtures", () => {
    const e = new Engine();
    const state = e.exportDemoState();
    const nowSeconds = Date.now() / 1000;
    for (const [, bars] of state.candles) {
      expect(bars.at(-1)!.t).toBeLessThanOrEqual(nowSeconds);
      expect(bars.at(-1)!.t).toBeGreaterThan(nowSeconds - 60);
      for (const b of bars) b.t += 1_700_000_000_000;
    }
    const migrated = new Engine();
    migrated.restoreDemoState(state);
    for (const bars of Object.values(migrated.getSnapshot().demo.chartSeries))
      expect(bars.at(-1)!.t).toBeLessThanOrEqual(nowSeconds);
    expect(
      migrated.getSnapshot().topOpportunities[0].indicators.ema20,
    ).toBeGreaterThan(0);
  });
  it("retains monotonic timestamps over repeated ticks in the same minute", async () => {
    const e = new Engine();
    await e.stepCycle();
    await e.stepCycle();
    for (const bars of Object.values(e.getSnapshot().demo.chartSeries))
      expect(() => closedCandles(bars)).not.toThrow();
  });
  it("reports a truthful target, never pads exits to reach 100", () => {
    const r = runProfessionalPreLiveVerification();
    expect(r.winningTrades + r.losingTrades).toBe(r.simulatedTradesExecuted);
    expect(r.simulatedTradesExecuted).toBeGreaterThan(0);
    expect(r.dataSourceType).toBe("SIMULATED_MULTI_REGIME_CANDLES");
  });
});
describe("24-hour global drawdown and panic", () => {
  it("rejects stale displayed entry quotes over 0.3% without debiting Demo cash", async () => {
    const e = new Engine(),
      sig = e
        .getSnapshot()
        .topOpportunities.find((s) => s.symbol === "BTC/IRT")!;
    expect(
      (await e.tryOpenCryptoPosition(sig, Date.now(), sig.priceIrt * 0.99)).ok,
    ).toBe(false);
    expect(e.getSnapshot().demoAvailableCashIrt).toBe(100000000);
    expect(e.getSnapshot().demo.paperOrders).toHaveLength(0);
  });
  it("liquidates gold AND crypto, persists cooldown through midnight and restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T23:59:00Z"));
    const e = new Engine();
    const p = await buy(e);
    expect((await e.tryOpenGoldDemoPosition("PAXG/IRT")).ok).toBe(true);
    await buy(e, "ETH/IRT");
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 0.4);
    const s = e.getSnapshot();
    expect(s.openPositions).toHaveLength(0);
    expect(s.goldReport.goldOpenPositions).toHaveLength(0);
    expect(s.demo.daily.haltedUntil).toBe(Date.now() + 86400000);
    const state = e.exportDemoState();
    vi.setSystemTime(new Date("2026-11-06T00:01:00Z"));
    const restored = new Engine();
    restored.restoreDemoState(state);
    expect(() => restored.startDemoTrading()).toThrow("SAFETY_HALT_ACTIVE");
    restored.clearEmergencyStop();
    restored.adjustDemoCash(100000000);
    expect(() => restored.startDemoTrading()).toThrow("SAFETY_HALT_ACTIVE");
    vi.setSystemTime(new Date("2026-11-06T23:58:59Z"));
    expect(() => restored.startDemoTrading()).toThrow();
    vi.setSystemTime(new Date("2026-11-06T23:59:00Z"));
    expect(restored.getSnapshot().demo.daily.halted).toBe(false);
    expect(restored.getSnapshot().tradingMode).toBe("STOPPED");
  });
  it("panic stops scanner and trading, liquidates both segments, and stays latched", async () => {
    const e = new Engine();
    await buy(e);
    await e.tryOpenGoldDemoPosition("PAXG/IRT");
    e.startScanner();
    await e.triggerEmergencyStop();
    const s = e.getSnapshot();
    expect(s.scannerRunning).toBe(false);
    expect(s.tradingMode).toBe("STOPPED");
    expect(s.openPositions).toHaveLength(0);
    expect(s.goldReport.goldOpenPositions).toHaveLength(0);
    expect(() => e.startDemoTrading()).toThrow();
  });
});
