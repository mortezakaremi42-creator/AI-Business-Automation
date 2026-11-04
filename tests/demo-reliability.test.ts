import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Bit24AiTraderOrchestrator as Engine } from "../src/engine/traderOrchestrator.js";
import { createBit24ProAppServer } from "../src/server/index.js";
import { DemoStore, validateDemoState } from "../src/server/demoStore.js";
import { Bit24OfficialRestClient } from "../src/server/bit24OfficialClient.js";
import { SafeTelegramNotificationService } from "../src/server/telegramService.js";
import { EncryptedSecretVault } from "../src/server/encryptedVault.js";
const dirs: string[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "bit24-reliability-"));
  dirs.push(dir);
  return join(dir, "state.json");
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function buy(e: Engine, symbol = "BTC/IRT") {
  const s = e.getSnapshot().topOpportunities.find((s) => s.symbol === symbol)!;
  const r = await e.tryOpenCryptoPosition(s);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return e.getSnapshot().openPositions.find((p) => p.symbol === symbol)!;
}
describe("paper accounting and protective risk", () => {
  it("balances cash, net liquidation equity, realized P&L and exact fees after a round trip", async () => {
    const e = new Engine(),
      p = await buy(e);
    expect(e.getSnapshot().demoAvailableCashIrt).toBe(90_000_000);
    expect(p.initialCapitalIrt).toBe(10_000_000);
    expect(p.entryFeeIrt).toBe(20_000);
    const before = e.getSnapshot();
    expect(before.demoBalanceIrt - 100_000_000).toBeCloseTo(
      before.totalPnlIrt,
      0,
    );
    await e.closeDemoPosition(p.symbol);
    const s = e.getSnapshot(),
      t = s.tradeHistory[0];
    expect(s.demoAvailableCashIrt - 100_000_000).toBeCloseTo(t.netPnlIrt, 0);
    expect(
      s.demo.paperOrders.reduce((sum, o) => sum + o.feeIrt, 0),
    ).toBeCloseTo(t.totalFeeIrt, 5);
    expect(t.netPnlIrt).toBeLessThan(0);
    expect(s.openPositions).toHaveLength(0);
  });
  it("blocks simultaneous duplicate buys without consuming extra cash", async () => {
    const e = new Engine(),
      sig = e
        .getSnapshot()
        .topOpportunities.find((s) => s.symbol === "BTC/IRT")!;
    const results = await Promise.all([
      e.tryOpenCryptoPosition(sig),
      e.tryOpenCryptoPosition(sig),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.code).toBe("DUPLICATE_ORDER");
    expect(e.getSnapshot().demo.paperOrders).toHaveLength(1);
  });
  it("enforces one global capacity across gold and crypto and releases it after sell", async () => {
    const e = new Engine();
    await buy(e);
    expect((await e.tryOpenGoldDemoPosition("PAXG/IRT")).ok).toBe(true);
    await buy(e, "ETH/IRT");
    const sig = e
      .getSnapshot()
      .topOpportunities.find((s) => s.symbol === "XRP/IRT")!;
    expect((await e.tryOpenCryptoPosition(sig)).code).toBe(
      "MAX_CONCURRENT_REACHED",
    );
    expect((await e.tryOpenGoldDemoPosition("XAUT/IRT")).code).toBe(
      "MAX_CONCURRENT_REACHED",
    );
    await e.closeDemoPosition("BTC/IRT");
    expect((await e.tryOpenCryptoPosition(sig)).ok).toBe(true);
  });
  it("fills a stop at the observed gap price, not a guaranteed stop price", async () => {
    const e = new Engine(),
      p = await buy(e);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 0.9);
    const s = e.getSnapshot();
    expect(s.openPositions).toHaveLength(0);
    expect(s.tradeHistory[0].sellPriceIrt).toBeLessThan(p.initialStopLossIrt);
    expect(s.tradeHistory[0].sellReasonEn).toContain("Stop-Loss");
  });
  it("takes three profit stages exactly once, allocates fees and counts one completed trade", async () => {
    const e = new Engine(),
      p = await buy(e);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 1.11);
    expect(e.getSnapshot().tradeHistory).toHaveLength(1);
    expect(e.getSnapshot().winningTrades).toBe(0);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 1.11);
    expect(e.getSnapshot().tradeHistory).toHaveLength(1);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 1.21);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 1.36);
    const s = e.getSnapshot();
    expect(s.openPositions).toHaveLength(0);
    expect(s.tradeHistory).toHaveLength(3);
    expect(s.winningTrades).toBe(1);
    expect(s.tradeHistory.reduce((v, t) => v + t.quantity, 0)).toBeCloseTo(
      p.initialQuantity,
      10,
    );
    expect(
      s.tradeHistory.reduce((v, t) => v + t.capitalEnteredIrt, 0),
    ).toBeCloseTo(p.initialCapitalIrt, 5);
    expect(s.demo.paperOrders.reduce((v, o) => v + o.feeIrt, 0)).toBeCloseTo(
      s.tradeHistory.reduce((v, t) => v + t.totalFeeIrt, 0),
      5,
    );
    expect(s.demoAvailableCashIrt - 100_000_000).toBeCloseTo(
      s.tradeHistory.reduce((v, t) => v + t.netPnlIrt, 0),
      0,
    );
  });
  it("persists a daily-loss latch and cannot bypass it by adding cash or restarting trading", async () => {
    const e = new Engine();
    e.startDemoTrading();
    const p = await buy(e);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 0.4);
    expect(e.getSnapshot().demo.daily.halted).toBe(true);
    expect(e.getSnapshot().tradingMode).toBe("STOPPED");
    e.adjustDemoCash(100_000_000);
    expect(e.getSnapshot().demo.daily.halted).toBe(true);
    expect(() => e.startDemoTrading()).toThrow("SAFETY_HALT_ACTIVE");
    const restarted = new Engine();
    restarted.restoreDemoState(e.exportDemoState());
    expect(restarted.getSnapshot().demo.daily.halted).toBe(true);
    const sig = restarted
      .getSnapshot()
      .topOpportunities.find((s) => s.symbol === "ETH/IRT")!;
    expect((await restarted.tryOpenCryptoPosition(sig)).code).toBe(
      "DAILY_LOSS_LIMIT",
    );
  });
  it("rolls the loss budget at UTC midnight but never restarts trading automatically", async () => {
    const e = new Engine(),
      p = await buy(e);
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 0.4);
    const tomorrow = new Date(Date.now() + 86400000);
    vi.useFakeTimers();
    vi.setSystemTime(tomorrow);
    const s = e.getSnapshot();
    expect(s.demo.daily.halted).toBe(false);
    expect(s.tradingMode).toBe("STOPPED");
    expect(s.dailyPnlIrt).toBeCloseTo(0);
  });
  it("paper cash changes do not become profits and cannot spend locked capital", async () => {
    const e = new Engine();
    e.adjustDemoCash(1_000_000);
    e.adjustDemoCash(-2_000_000);
    expect(e.getSnapshot().demoAvailableCashIrt).toBe(99_000_000);
    expect(e.getSnapshot().totalPnlIrt).toBe(0);
    expect(e.getSnapshot().dailyPnlIrt).toBe(0);
    expect(() => e.adjustDemoCash(-100_000_000)).toThrow(
      "INVALID_PAPER_CASH_ADJUSTMENT",
    );
    expect(() => e.adjustDemoCash(NaN)).toThrow();
  });
  it("emergency halt blocks all entries, closes demo positions and is not cleared by Start", async () => {
    const e = new Engine();
    await buy(e);
    await e.triggerEmergencyStop();
    expect(e.getSnapshot().openPositions).toHaveLength(0);
    expect(() => e.startDemoTrading()).toThrow();
    expect((await e.tryOpenGoldDemoPosition("PAXG/IRT")).ok).toBe(false);
  });
  it("existing positions retain entry-time exit settings", async () => {
    const e = new Engine(),
      p = await buy(e);
    e.updateRiskAndExitSettings({
      exit: {
        initialStopLossPct: 15,
        tpStage1ProfitPct: 20,
        tpStage2ProfitPct: 30,
        tpStage3ProfitPct: 40,
      },
    });
    await e.observeDemoPrice(p.symbol, p.entryPriceIrt * 0.94);
    expect(e.getSnapshot().openPositions).toHaveLength(0);
  });
  it("never sends outbound requests, even when adapters or live health are supplied", async () => {
    const outbound = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(Error("OUTBOUND_FORBIDDEN"));
    const dispatch = vi.fn(),
      execute = vi.fn();
    const e = new Engine({
      onTelegramDispatch: dispatch,
      liveExecutor: {
        checkLiveIrtBalance: execute,
        submitAndVerifySpotOrder: execute,
      },
    });
    e.setBit24Health({
      state: "CONNECTED_PUBLIC_AND_PRIVATE",
      activeMarketFeed: "LIVE_BIT24_API",
    });
    expect(
      e.activateLiveTradingAfterUserApproval("CONFIRM_BIT24_LIVE").ok,
    ).toBe(false);
    expect(() => e.applyLiveBit24Markets([])).toThrow("LIVE_DISABLED");
    await buy(e);
    await e.stepCycle();
    await e.closeDemoPosition("BTC/IRT");
    expect(outbound).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    const vault = new EncryptedSecretVault(
      join(tmpdir(), "nonexistent-demo-vault.enc"),
    );
    expect(() => new Bit24OfficialRestClient(vault)).toThrow("DEMO_ONLY");
    expect(() => new SafeTelegramNotificationService(vault)).toThrow(
      "DEMO_ONLY",
    );
  });
  it("does not overlap cycles or create unconfirmed auto buys", async () => {
    const e = new Engine();
    e.startDemoTrading();
    const first = e.stepCycle();
    await expect(e.stepCycle()).rejects.toThrow("CYCLE_ALREADY_RUNNING");
    await first;
    expect(e.getSnapshot().demo.paperOrders).toHaveLength(0);
  });
});
describe("durable server transactions", () => {
  const headers = { "Content-Type": "application/json" };
  async function start(file: string) {
    const s = createBit24ProAppServer({
      token: "",
      stateFile: file,
      autoCycle: false,
    });
    await new Promise<void>((r) => s.httpServer.listen(0, "127.0.0.1", r));
    const a = s.httpServer.address() as { port: number };
    return { ...s, url: `http://127.0.0.1:${a.port}` };
  }
  async function close(s: Awaited<ReturnType<typeof start>>) {
    s.stop();
    await new Promise<void>((r) => s.httpServer.close(() => r()));
  }
  async function post(url: string, path: string, body: unknown) {
    return fetch(url + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }
  it("atomically replays the same request after a server restart without duplicating the order", async () => {
    const file = temp(),
      id = randomUUID();
    let s = await start(file);
    try {
      const body = { symbol: "BTC/IRT", requestId: id };
      const responses = await Promise.all([
        post(s.url, "/api/buy", body),
        post(s.url, "/api/buy", body),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect((await responses[1].json()).replayed).toBe(true);
      await close(s);
      s = await start(file);
      const replay = await (await post(s.url, "/api/buy", body)).json();
      expect(replay.replayed).toBe(true);
      expect(replay.snapshot.demo.paperOrders).toHaveLength(1);
      expect(
        (await post(s.url, "/api/sell", { symbol: "BTC/IRT", requestId: id }))
          .status,
      ).toBe(409);
      const sale = await (
        await post(s.url, "/api/sell", {
          symbol: "BTC/IRT",
          requestId: randomUUID(),
        })
      ).json();
      expect(sale.ok).toBe(true);
      expect(sale.snapshot.demo.paperOrders).toHaveLength(2);
    } finally {
      await close(s);
    }
  });
  it("keeps history, positions, cash, risk settings, daily budget and receipt lookup across restart", async () => {
    const file = temp();
    let s = await start(file);
    const id = randomUUID();
    try {
      await post(s.url, "/api/demo/balance", {
        amountIrt: 2_000_000,
        requestId: id,
      });
      await post(s.url, "/api/risk/update", {
        capital: { maxConcurrentTrades: 2 },
      });
      await post(s.url, "/api/buy", {
        symbol: "BTC/IRT",
        requestId: randomUUID(),
      });
      const before = await (await fetch(s.url + "/api/status")).json();
      await close(s);
      s = await start(file);
      const after = await (await fetch(s.url + "/api/status")).json();
      expect(after.demoAvailableCashIrt).toBe(before.demoAvailableCashIrt);
      expect(after.openPositions).toEqual(before.openPositions);
      expect(after.capitalConfig.maxConcurrentTrades).toBe(2);
      expect(after.demo.daily).toEqual(before.demo.daily);
      expect(
        (await (await fetch(s.url + "/api/demo/receipts/" + id)).json()).found,
      ).toBe(true);
    } finally {
      await close(s);
    }
  });
  it("rejects missing request IDs and invalid or disabled risk settings before mutation", async () => {
    const s = await start(temp());
    try {
      expect(
        (await post(s.url, "/api/buy", { symbol: "BTC/IRT" })).status,
      ).toBe(422);
      for (const capital of [
        { riskPerTradePct: -1 },
        { maxConcurrentTrades: 100 },
        { maxDailyLossPct: 0 },
        { autoStopOnDailyLoss: false },
      ])
        expect(
          (await post(s.url, "/api/risk/update", { capital })).status,
        ).toBe(422);
      expect(
        (await (await fetch(s.url + "/api/status")).json()).demo.paperOrders,
      ).toHaveLength(0);
    } finally {
      await close(s);
    }
  });
  it("rolls back a failed save, reports 503 and stops future mutations", async () => {
    const s = await start(temp());
    try {
      const before = await (await fetch(s.url + "/api/status")).json();
      const save = vi.spyOn(s.store, "save").mockImplementation(() => {
        throw Error("DISK_FULL");
      });
      expect(
        (
          await post(s.url, "/api/buy", {
            symbol: "BTC/IRT",
            requestId: randomUUID(),
          })
        ).status,
      ).toBe(503);
      const after = await (await fetch(s.url + "/api/status")).json();
      expect(after.demoAvailableCashIrt).toBe(before.demoAvailableCashIrt);
      expect(after.openPositions).toHaveLength(0);
      expect(after.storage.healthy).toBe(false);
      expect(
        (
          await post(s.url, "/api/demo/balance", {
            amountIrt: 1_000_000,
            requestId: randomUUID(),
          })
        ).status,
      ).toBe(503);
      save.mockRestore();
    } finally {
      await close(s);
    }
  });
  it("denies real-network, live activation and withdrawal endpoints", async () => {
    const s = await start(temp());
    try {
      for (const path of [
        "/api/settings/bit24",
        "/api/settings/bit24/verify",
        "/api/settings/telegram",
        "/api/trading/activate-live",
        "/api/withdraw",
      ])
        expect((await post(s.url, path, {})).status).toBe(403);
    } finally {
      await close(s);
    }
  });
  it("detects corrupt storage without silently resetting the account", () => {
    const file = temp(),
      store = new DemoStore(file);
    store.save(new Engine().exportDemoState(), []);
    const original = readFileSync(file, "utf8");
    writeFileSync(file, original.replace("100000000", "100000001"));
    expect(() => store.load()).toThrow("DEMO_STORAGE_INVALID");
    store.close();
  });
  it("locks out a second writer and rejects persisted LIVE or non-finite values", () => {
    const file = temp(),
      store = new DemoStore(file);
    expect(() => new DemoStore(file)).toThrow();
    store.close();
    const state = new Engine().exportDemoState();
    state.demoCashIrt = Infinity;
    expect(() => validateDemoState(state)).toThrow();
    state.demoCashIrt = 100000000;
    state.tradingMode = "LIVE";
    expect(() => validateDemoState(state)).toThrow();
  });
});
