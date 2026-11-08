import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SafeSpotExecution,
  enforcePriceDeviation,
  RateLimited,
  type ExecutionJournal,
  type VerifiedSpotAdapter,
} from "../src/server/execution/safeSpotExecution.js";
import { FileExecutionJournal } from "../src/server/execution/fileExecutionJournal.js";
import { ReviewedHttpTransport } from "../src/server/execution/reviewedHttpTransport.js";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture() {
  const now = 100000;
  let data: ReturnType<ExecutionJournal["load"]> = {
    halted: true,
    intents: [],
  };
  const journal = {
    load: () => structuredClone(data),
    save: vi.fn((s: typeof data) => {
      data = structuredClone(s);
    }),
  };
  const adapter: VerifiedSpotAdapter = {
    reviewedDocumentation: "https://docs.bit24.cash/review-required",
    permissions: vi.fn(async () => ({
      accountId: "test-account",
      spotTrade: true,
      read: true,
      withdraw: false,
      transfer: false,
      checkedAt: now,
    })),
    quote: vi.fn(async () => ({ bid: "99.9", ask: "100", observedAt: now })),
    submit: vi.fn(async () => ({ orderId: "order-1" })),
    lookup: vi.fn(async (id) => ({
      status: "FILLED" as const,
      orderId: "order-1",
      clientOrderId: id,
    })),
    listManagedOrders: vi.fn(async () => []),
    cancel: vi.fn(async () => {}),
    managedInventory: vi.fn(async () => []),
  };
  const kernel = new SafeSpotExecution(adapter, journal, {
    accountId: "test-account",
    reviewed: true,
    clock: () => now,
  });
  return { kernel, adapter, journal, now };
}
const order = {
  requestId: "test-request-1",
  symbol: "BTC/IRT",
  side: "BUY" as const,
  quantity: "0.001",
  referencePrice: "100",
};
it("accepts exactly 0.3% and rejects one decimal unit above it on both sides", () => {
  expect(() => enforcePriceDeviation("100", "100.3")).not.toThrow();
  expect(() => enforcePriceDeviation("100", "99.7")).not.toThrow();
  expect(() => enforcePriceDeviation("100", "100.300000000001")).toThrow(
    "SLIPPAGE",
  );
  expect(() => enforcePriceDeviation("100", "99.699999999999")).toThrow(
    "SLIPPAGE",
  );
});
for (const permissions of [
  { withdraw: true },
  { transfer: true },
  { spotTrade: false },
  { read: false },
  { withdraw: undefined },
  { accountId: "wrong" },
  { checkedAt: 1 },
])
  it("fails closed on permission " + JSON.stringify(permissions), async () => {
    const f = fixture();
    vi.mocked(f.adapter.permissions).mockResolvedValue({
      ...(await f.adapter.permissions(new AbortController().signal)),
      ...permissions,
    } as any);
    await expect(f.kernel.arm()).rejects.toThrow("PERMISSION");
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });
it("never submits a stale quote or a >0.3% order", async () => {
  const f = fixture();
  await f.kernel.arm();
  vi.mocked(f.adapter.quote).mockResolvedValue({
    bid: "101",
    ask: "101",
    observedAt: f.now,
  });
  await expect(f.kernel.submit(order)).rejects.toThrow("SLIPPAGE");
  vi.mocked(f.adapter.quote).mockResolvedValue({
    bid: "100",
    ask: "100",
    observedAt: 1,
  });
  await expect(f.kernel.submit(order)).rejects.toThrow("STALE");
  expect(f.adapter.submit).not.toHaveBeenCalled();
});
it("commits UNKNOWN before one dispatch, does not treat ACK as fill and reconciles by identity", async () => {
  const f = fixture();
  await f.kernel.arm();
  vi.mocked(f.adapter.submit).mockImplementation(async () => {
    expect(f.kernel.snapshot().intents[0].status).toBe("UNKNOWN");
    return { orderId: "order-1" };
  });
  const ack = await f.kernel.submit(order);
  expect(ack.status).toBe("UNKNOWN");
  await expect(
    f.kernel.submit({ ...order, requestId: "other" }),
  ).rejects.toThrow();
  await f.kernel.reconcile();
  expect(f.kernel.snapshot().intents[0].status).toBe("FILLED");
  expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  await expect(f.kernel.submit(order)).rejects.toThrow("ALREADY_JOURNALED");
});
it("never retries a failed write and keeps UNKNOWN after restart", async () => {
  const f = fixture();
  await f.kernel.arm();
  vi.mocked(f.adapter.submit).mockRejectedValue(
    Error("network containing an upstream secret"),
  );
  await expect(f.kernel.submit(order)).rejects.toThrow(
    "SUBMISSION_UNKNOWN_DO_NOT_RETRY",
  );
  const restarted = new SafeSpotExecution(f.adapter, f.journal, {
    accountId: "test-account",
    reviewed: true,
    clock: () => f.now,
  });
  await expect(restarted.arm()).rejects.toThrow();
  expect(restarted.snapshot().intents[0].status).toBe("UNKNOWN");
  expect(f.adapter.submit).toHaveBeenCalledTimes(1);
});
it("bounds an adapter that ignores AbortSignal without duplicating the order", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.kernel.arm();
  vi.mocked(f.adapter.submit).mockImplementation(() => new Promise(() => {}));
  const promise = expect(f.kernel.submit(order)).rejects.toThrow(
    "SUBMISSION_UNKNOWN",
  );
  await vi.advanceTimersByTimeAsync(8001);
  await promise;
  expect(f.adapter.submit).toHaveBeenCalledTimes(1);
});
it("kill switch preempts an in-flight arming request", async () => {
  const f = fixture();
  let release!: (p: any) => void;
  vi.mocked(f.adapter.permissions).mockReturnValue(
    new Promise((r) => (release = r)),
  );
  const armed = f.kernel.arm();
  await f.kernel.panic();
  release({
    accountId: "test-account",
    spotTrade: true,
    read: true,
    withdraw: false,
    transfer: false,
    checkedAt: f.now,
  });
  await expect(armed).rejects.toThrow("KILL_SWITCH");
  expect(f.kernel.snapshot().halted).toBe(true);
});
it("blocks transmission if the journal cannot durably record UNKNOWN", async () => {
  const f = fixture();
  await f.kernel.arm();
  f.journal.save.mockImplementation(() => {
    throw Error("disk full");
  });
  await expect(f.kernel.submit(order)).rejects.toThrow("LIVE_JOURNAL_FAULT");
  expect(f.adapter.submit).not.toHaveBeenCalled();
});
it("retries a rate-limited read once but never retries a financial write", async () => {
  const f = fixture();
  vi.mocked(f.adapter.permissions).mockRejectedValueOnce(new RateLimited(0));
  await f.kernel.arm();
  expect(f.adapter.permissions).toHaveBeenCalledTimes(2);
  vi.mocked(f.adapter.submit).mockRejectedValue(new RateLimited(0));
  await expect(f.kernel.submit(order)).rejects.toThrow("UNKNOWN");
  expect(f.adapter.submit).toHaveBeenCalledTimes(1);
});
it("persists uncertain cancellation and refuses rearming", async () => {
  const f = fixture();
  await f.kernel.arm();
  vi.mocked(f.adapter.listManagedOrders).mockResolvedValue([
    { orderId: "old-1", clientOrderId: "old-client-1" },
  ]);
  vi.mocked(f.adapter.cancel).mockRejectedValue(Error("timeout"));
  expect((await f.kernel.panic()).reason).toBe(
    "CANCEL_UNKNOWN_VERIFY_EXCHANGE",
  );
  expect(f.kernel.snapshot().cancelUncertain).toEqual(["old-client-1"]);
  await expect(f.kernel.arm()).rejects.toThrow();
});
it("cancels then liquidates all managed assets only after each verified market fill", async () => {
  const f = fixture();
  await f.kernel.arm();
  const fills = new Map<string, { symbol: string; id: string }>();
  const sold = new Set();
  vi.mocked(f.adapter.managedInventory).mockImplementation(async () =>
    [
      { symbol: "BTC/IRT", quantity: "0.1" },
      { symbol: "ETH/IRT", quantity: "1" },
    ].filter((x) => !sold.has(x.symbol)),
  );
  vi.mocked(f.adapter.submit).mockImplementation(async (o) => {
    const id = "order-" + fills.size;
    fills.set(o.clientOrderId, { symbol: o.symbol, id });
    expect(o.type).toBe("MARKET");
    expect(o.side).toBe("SELL");
    return { orderId: id };
  });
  vi.mocked(f.adapter.lookup).mockImplementation(async (client) => {
    const p = fills.get(client)!;
    sold.add(p.symbol);
    return { status: "FILLED", orderId: p.id, clientOrderId: client };
  });
  expect((await f.kernel.panic()).ok).toBe(true);
  expect(sold.size).toBe(2);
  expect(f.kernel.snapshot().halted).toBe(true);
});
it("durably restores the live journal, locks a second writer and rejects corruption", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-journal-"));
  const path = join(dir, "journal.json");
  try {
    const store = new FileExecutionJournal(path);
    store.save({ halted: true, intents: [] });
    expect(() => new FileExecutionJournal(path)).toThrow();
    store.close();
    const second = new FileExecutionJournal(path);
    expect(second.load().halted).toBe(true);
    writeFileSync(path, "bad");
    expect(() => second.load()).toThrow("CORRUPT");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("HTTP transport forbids non-allowlisted/withdrawal endpoints and redacts errors", async () => {
  const fetcher = vi.fn(async () => {
    throw Error("API_SECRET_SHOULD_NOT_LEAK");
  });
  const transport = new ReviewedHttpTransport(
    {
      origin: "https://rest.bit24.cash",
      allowlist: ["POST /reviewed-order"],
      authenticate: () => ({ "x-test-auth": "fixture-only" }),
    },
    () => ({ API_KEY: "fixture-only", SECRET_KEY: "fixture-only" }),
    fetcher,
  );
  await expect(
    transport.request(
      "POST",
      "/withdraw",
      undefined,
      new AbortController().signal,
    ),
  ).rejects.toThrow("WITHDRAWAL");
  await expect(
    transport.request(
      "POST",
      "/reviewed-order",
      "{}",
      new AbortController().signal,
    ),
  ).rejects.toThrow("EXCHANGE_REQUEST_FAILED");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
