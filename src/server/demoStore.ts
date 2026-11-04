import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { lockSync } from "proper-lockfile";
import { z } from "zod";
import type { Bit24AiTraderOrchestrator } from "../engine/traderOrchestrator.js";
export type DemoState = ReturnType<
  Bit24AiTraderOrchestrator["exportDemoState"]
>;
export interface Receipt {
  key: string;
  fingerprint: string;
  result: Record<string, unknown>;
  at: number;
}
const number = z.number().finite();
const cash = number.nonnegative();
const positive = number.positive();
const entity = z
  .object({ id: z.string(), symbol: z.string(), mode: z.literal("DEMO") })
  .passthrough();
const position = entity.extend({
  initialQuantity: positive,
  remainingQuantity: positive,
  entryPriceIrt: positive,
  currentPriceIrt: positive,
  initialCapitalIrt: positive,
  remainingCapitalIrt: cash,
  entryFeeIrt: cash,
  segment: z.enum(["CRYPTO", "GOLD"]),
  unrealizedPnlIrt: number,
  activeStopLossIrt: positive,
  openedAt: number,
});
const capital = z.object({
  initialDemoBalanceIrt: positive,
  riskPerTradePct: positive.max(5),
  maxCapitalPerTradePct: positive.max(35),
  maxConcurrentTrades: z.number().int().min(1).max(10),
  maxDailyLossPct: positive.max(15),
  autoStopOnDailyLoss: z.literal(true),
  neverUseFullCapitalInSingleTrade: z.literal(true),
});
const exit = z.object({
  initialStopLossPct: positive.max(15),
  trailingActivationProfitPct: positive,
  trailingDistanceFromPeakPct: positive,
  tpStage1ProfitPct: positive,
  tpStage1SellRatioPct: positive,
  tpStage2ProfitPct: positive,
  tpStage2SellRatioPct: positive,
  tpStage3ProfitPct: positive,
  tpStage3SellRatioPct: positive,
});
const candle = z.object({
  t: number,
  o: positive,
  h: positive,
  l: positive,
  c: positive,
  v: cash,
});
const stateSchema = z.object({
  capitalConfig: capital,
  exitConfig: exit,
  demoCashIrt: cash,
  goldDedicatedCashIrt: cash,
  openPositions: z.array(position),
  tradeHistory: z.array(
    entity.extend({
      netPnlIrt: number,
      capitalEnteredIrt: positive,
      quantity: positive,
      sellTime: number,
    }),
  ),
  paperOrders: z.array(
    entity.extend({
      side: z.enum(["BUY", "SELL"]),
      quantity: positive,
      priceIrt: positive,
      feeIrt: cash,
      at: number,
    }),
  ),
  cashAdjustments: z.array(
    z.object({ id: z.string(), amountIrt: number, at: number }),
  ),
  daily: z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    baseline: positive,
    cashFlow: number,
    halted: z.boolean(),
  }),
  markets: z
    .array(
      z
        .object({
          symbol: z.string(),
          priceIrt: positive,
          dataFeedType: z.literal("SIMULATED_MARKET_FEED"),
        })
        .passthrough(),
    )
    .nonempty(),
  candles: z.array(z.tuple([z.string(), z.array(candle)])),
  books: z.array(z.tuple([z.string(), z.record(z.string(), z.unknown())])),
  emergencyStopped: z.boolean(),
  scannerRunning: z.boolean(),
  tradingMode: z.enum(["STOPPED", "DEMO"]),
  goldAutoDemoEnabled: z.literal(false),
  rejectionLogs: z.array(z.record(z.string(), z.unknown())),
});
function finiteTree(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value))
    throw Error("NON_FINITE_DEMO_STATE");
  if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw Error("INVALID_STATE_KEY");
      finiteTree(item);
    }
}
export function validateDemoState(value: unknown): DemoState {
  finiteTree(value);
  const checked = stateSchema.parse(value);
  if (
    new Set(checked.openPositions.map((p) => p.symbol)).size !==
    checked.openPositions.length
  )
    throw Error("DUPLICATE_PERSISTED_POSITION");
  for (const p of checked.openPositions)
    if (
      p.remainingQuantity > p.initialQuantity * (1 + 1e-10) ||
      p.remainingCapitalIrt > p.initialCapitalIrt * (1 + 1e-10)
    )
      throw Error("INVALID_REMAINING_POSITION");
  // Preserve all validated engine metadata, not the reduced public snapshot.
  return structuredClone(value) as DemoState;
}
const receiptSchema = z.object({
  key: z.string(),
  fingerprint: z.string(),
  result: z.record(z.string(), z.unknown()),
  at: number,
});
const envelope = z.object({
  version: z.literal(2),
  app: z.literal("BIT24_DEMO"),
  checksum: z.string(),
  payload: z.object({ state: z.unknown(), receipts: z.array(receiptSchema) }),
});
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** One process owns the file. Temp + fsync + atomic rename commits state and receipts together. */
export class DemoStore {
  private release: () => void;
  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // Lock a stable sidecar, never the data inode which is replaced on commit.
    const guard = file + ".guard";
    fs.closeSync(fs.openSync(guard, "a", 0o600));
    this.release = lockSync(guard, {
      realpath: false,
      stale: 30_000,
      retries: 0,
    });
  }
  load(): { state: DemoState; receipts: Receipt[] } | null {
    if (!fs.existsSync(this.file)) return null;
    try {
      const data = envelope.parse(
        JSON.parse(fs.readFileSync(this.file, "utf8")),
      );
      if (digest(data.payload) !== data.checksum)
        throw Error("CHECKSUM_MISMATCH");
      return {
        state: validateDemoState(data.payload.state),
        receipts: data.payload.receipts,
      };
    } catch {
      throw Error(
        "DEMO_STORAGE_INVALID: preserve the file and restore a verified backup; account was NOT reset.",
      );
    }
  }
  save(state: DemoState, receipts: Receipt[]): void {
    validateDemoState(state);
    const payload = { state, receipts };
    const text = JSON.stringify({
      version: 2,
      app: "BIT24_DEMO",
      checksum: digest(payload),
      payload,
    });
    const temporary = this.file + "." + randomUUID() + ".tmp";
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.file);
      // Directory fsync is supported on Linux; Windows may reject opening a directory.
      if (process.platform !== "win32") {
        const dir = fs.openSync(path.dirname(this.file), "r");
        try {
          fs.fsyncSync(dir);
        } finally {
          fs.closeSync(dir);
        }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  close() {
    this.release();
  }
}
