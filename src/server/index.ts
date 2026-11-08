import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { createHash } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Bit24AiTraderOrchestrator } from "../engine/traderOrchestrator.js";
import {
  createMobileAccess,
  type MobileAccessOptions,
} from "./mobileAccess.js";
import { DemoStore, type Receipt } from "./demoStore.js";
import { z } from "zod";
type Result = Record<string, unknown>;
interface Options extends MobileAccessOptions {
  stateFile?: string;
  autoCycle?: boolean;
  vaultFilePath?: string;
}
const symbolSchema = z
  .string()
  .regex(/^[A-Z0-9]+\/IRT$/)
  .max(32);
const capitalSchema = z
  .object({
    initialDemoBalanceIrt: z
      .number()
      .int()
      .min(5_000_000)
      .max(1_000_000_000)
      .optional(),
    riskPerTradePct: z.number().min(0.2).max(5).optional(),
    maxCapitalPerTradePct: z.number().min(1).max(35).optional(),
    maxConcurrentTrades: z.number().int().min(1).max(10).optional(),
    maxDailyLossPct: z.number().min(0.5).max(15).optional(),
    autoStopOnDailyLoss: z.literal(true).optional(),
    neverUseFullCapitalInSingleTrade: z.literal(true).optional(),
  })
  .strict();
const exitSchema = z
  .object({
    initialStopLossPct: z.number().min(1).max(15).optional(),
    trailingActivationProfitPct: z.number().min(2).max(30).optional(),
    trailingDistanceFromPeakPct: z.number().min(0.8).max(12).optional(),
    tpStage1ProfitPct: z.number().min(2).max(50).optional(),
    tpStage2ProfitPct: z.number().min(4).max(80).optional(),
    tpStage3ProfitPct: z.number().min(8).max(150).optional(),
    tpStage1SellRatioPct: z.number().min(10).max(60).optional(),
    tpStage2SellRatioPct: z.number().min(10).max(60).optional(),
    tpStage3SellRatioPct: z.number().min(10).max(60).optional(),
  })
  .strict();
export function createBit24ProAppServer(options: Options = {}) {
  const app = express();
  app.disable("x-powered-by");
  const access = createMobileAccess(options);
  app.use("/api", access.middleware);
  app.use(express.json({ limit: "32kb" }));
  // No exchange client, secret vault, live feed, or outbound Telegram adapter is constructed.
  const orchestrator = new Bit24AiTraderOrchestrator();
  const store = new DemoStore(
    path.resolve(
      options.stateFile ??
        process.env.DEMO_STATE_FILE ??
        "data/demo-state-v2.json",
    ),
  );
  let receipts: Receipt[] = [];
  try {
    const loaded = store.load();
    if (loaded) {
      orchestrator.restoreDemoState(loaded.state);
      receipts = loaded.receipts;
    } else store.save(orchestrator.exportDemoState(), receipts);
  } catch (error) {
    store.close();
    throw error;
  }
  let committed = structuredClone(orchestrator.getSnapshot()),
    storageFault = false,
    stopped = false;
  // Persist clock migration / day rollover BEFORE exposing the initial snapshot.
  try {
    store.save(orchestrator.exportDemoState(), receipts);
  } catch (error) {
    store.close();
    throw error;
  }
  let tail: Promise<unknown> = Promise.resolve();
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  }
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    verifyClient: (info: { req: http.IncomingMessage }) =>
      access.verifyWebSocket(info.req),
    handleProtocols: (protocols) =>
      protocols.has("bit24-dashboard") ? "bit24-dashboard" : false,
  });
  function broadcast() {
    for (const c of wss.clients)
      if (c.readyState === WebSocket.OPEN) {
        if (c.bufferedAmount > 1_000_000) {
          c.terminate();
          continue;
        }
        try {
          c.send(JSON.stringify({ type: "SNAPSHOT", payload: committed }));
        } catch {
          c.terminate();
        }
      }
  }
  function snapshot() {
    return {
      ...committed,
      storage: { healthy: !storageFault, persistent: true },
      serverTimestamp: Date.now(),
    };
  }
  wss.on("connection", (socket) =>
    socket.send(JSON.stringify({ type: "SNAPSHOT", payload: snapshot() })),
  );
  async function transaction(
    action: () => Promise<Result>,
    receipt?: { key: string; fingerprint: string },
  ): Promise<Result> {
    if (storageFault) throw Error("DEMO_STORAGE_HALTED");
    const before = orchestrator.exportDemoState(),
      priorReceipts = [...receipts];
    try {
      const result = await action();
      await orchestrator.enforceDailyLiquidation();
      if (receipt) receipts.push({ ...receipt, result, at: Date.now() });
      const nextSnapshot = structuredClone(orchestrator.getSnapshot());
      store.save(orchestrator.exportDemoState(), receipts);
      committed = nextSnapshot;
      broadcast();
      return result;
    } catch (error) {
      orchestrator.restoreDemoState(before);
      receipts = priorReceipts;
      // Validation and risk refusals are not storage failures; store errors fail closed below.
      throw error;
    }
  }
  const keySchema = z.string().uuid();
  function mutate(
    paths: string | string[],
    action: (body: any) => Promise<Result> | Result,
    financial = false,
  ) {
    app.post(paths, async (req, res) => {
      try {
        await serialize(async () => {
          const body = req.body ?? {};
          let receipt: { key: string; fingerprint: string } | undefined;
          if (financial) {
            const key = keySchema.parse(body.requestId);
            const canonical = req.path.includes("sell")
              ? "sell"
              : req.path.includes("balance")
                ? "balance"
                : req.path.includes("/gold/")
                  ? "gold-buy"
                  : "buy";
            const fingerprint = createHash("sha256")
              .update(
                JSON.stringify({
                  action: canonical,
                  symbol: body.symbol,
                  amountIrt: body.amountIrt,
                }),
              )
              .digest("hex");
            const previous = receipts.find((r) => r.key === key);
            if (previous) {
              if (previous.fingerprint !== fingerprint) {
                res
                  .status(409)
                  .json({ ok: false, error: "IDEMPOTENCY_CONFLICT" });
                return;
              }
              res.json({
                ...previous.result,
                replayed: true,
                snapshot: snapshot(),
              });
              return;
            }
            receipt = { key, fingerprint };
          }
          const result = await transaction(async () => action(body), receipt);
          res
            .status(result.ok === false ? 400 : 200)
            .json({ ...result, snapshot: snapshot() });
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(422).json({
            ok: false,
            error: "INVALID_INPUT",
            messageFa:
              "ورودی معتبر نیست؛ نماد، شناسه درخواست و محدودهٔ اعداد را بررسی کنید.",
          });
          return;
        }
        const message = error instanceof Error ? error.message : "";
        const definite = [
          "SAFETY_HALT_ACTIVE",
          "INVALID_PAPER_CASH_ADJUSTMENT",
        ].includes(message);
        if (!definite) {
          storageFault = true;
          orchestrator.stopTrading();
        }
        res.status(definite ? 409 : 503).json({
          ok: false,
          error: definite ? message : "DEMO_STORAGE_HALTED",
          messageFa: definite
            ? "توقف ایمنی فعال یا اصلاح موجودی نامعتبر است."
            : "عملیات متوقف شد؛ ذخیره‌سازی سرور باید بررسی شود. درخواست را کورکورانه تکرار نکنید.",
        });
      }
    });
  }
  const ok = () => ({ ok: true });
  app.get("/api/health", (_req, res) =>
    res.status(storageFault ? 503 : 200).json({
      ok: !storageFault,
      demoOnly: true,
      liveDisabled: true,
      externalNetworkEnabled: false,
      persistent: true,
    }),
  );
  app.get("/api/status", (_req, res) => res.json(snapshot()));
  app.get("/api/demo/receipts/:id", (req, res) => {
    const found = receipts.find((r) => r.key === req.params.id);
    res.json({ ok: true, found: Boolean(found), result: found?.result });
  });
  app.get("/api/coins", (_req, res) =>
    res.json(
      committed.topOpportunities.map((s) => ({
        symbol: s.symbol,
        price: s.priceIrt,
        buyPower: s.indicators.buyerPowerPct,
        volumeGrowth: s.indicators.volumeSurgeRatio,
        rsi: s.indicators.rsi14,
        dataLabel: "اطلاعات فرضی",
      })),
    ),
  );
  mutate("/api/scanner/start", () => {
    orchestrator.startScanner();
    return ok();
  });
  mutate("/api/scanner/stop", () => {
    orchestrator.stopScanner();
    return ok();
  });
  mutate("/api/trading/start-demo", () => {
    orchestrator.startDemoTrading();
    return ok();
  });
  mutate("/api/trading/stop", () => {
    orchestrator.stopTrading();
    return ok();
  });
  mutate("/api/trading/emergency-stop", async () => {
    await orchestrator.triggerEmergencyStop(true);
    return ok();
  });
  mutate("/api/trading/clear-emergency", () => {
    orchestrator.clearEmergencyStop();
    return ok();
  });
  mutate(
    ["/api/buy", "/api/trading/manual-demo-buy"],
    (body) => {
      const symbol = symbolSchema.parse(body.symbol);
      const sig = orchestrator
        .getSnapshot()
        .topOpportunities.find((s) => s.symbol === symbol);
      return sig
        ? orchestrator.tryOpenCryptoPosition(
            sig,
            Date.now(),
            z
              .number()
              .finite()
              .positive()
              .optional()
              .parse(body.referencePriceIrt),
          )
        : {
            ok: false,
            code: "UNKNOWN_SYMBOL",
            messageFa: "این نماد در فهرست آزمایش نیست.",
          };
    },
    true,
  );
  mutate(
    "/api/sell",
    (body) => orchestrator.closeDemoPosition(symbolSchema.parse(body.symbol)),
    true,
  );
  mutate(
    "/api/demo/balance",
    (body) =>
      orchestrator.adjustDemoCash(
        z
          .number()
          .int()
          .min(-1_000_000_000)
          .max(1_000_000_000)
          .parse(body.amountIrt),
      ),
    true,
  );
  mutate(
    "/api/gold/demo-buy",
    (body) =>
      orchestrator.tryOpenGoldDemoPosition(
        z.enum(["PAXG/IRT", "XAUT/IRT"]).parse(body.symbol),
        Date.now(),
        z.number().finite().positive().optional().parse(body.referencePriceIrt),
      ),
    true,
  );
  mutate("/api/gold/toggle-auto", (body) => {
    if (z.boolean().parse(body.enabled))
      return {
        ok: false,
        code: "MANUAL_CONFIRMATION_REQUIRED",
        messageFa:
          "هر ورود آزمایشی نیاز به تأیید دارد؛ خرید خودکار غیرفعال است.",
      };
    orchestrator.setGoldAutoDemo(false);
    return ok();
  });
  mutate("/api/risk/update", (body) => {
    const data = z
      .object({
        capital: capitalSchema.optional(),
        exit: exitSchema.optional(),
      })
      .strict()
      .parse(body);
    const combined = { ...orchestrator.getSnapshot().exitConfig, ...data.exit };
    if (
      combined.tpStage1ProfitPct >= combined.tpStage2ProfitPct ||
      combined.tpStage2ProfitPct >= combined.tpStage3ProfitPct ||
      combined.tpStage1SellRatioPct + combined.tpStage2SellRatioPct >= 100
    )
      throw new z.ZodError([]);
    orchestrator.updateRiskAndExitSettings(data);
    return ok();
  });
  mutate("/api/verification/run-100", () => ({
    ok: true,
    report: orchestrator.runPro100Verification(),
  }));
  app.get("/api/execution/status", (_req, res) =>
    res.json({
      mode: "DEMO",
      liveAvailable: false,
      permissionVerified: false,
      contractVerified: false,
      reason: "OFFICIAL_API_CONTRACT_UNVERIFIED",
      maxSlippagePct: 0.3,
    }),
  );
  mutate("/api/execution/mode", (body) => {
    const mode = z.enum(["DEMO", "LIVE"]).parse(body.mode);
    if (mode === "LIVE")
      return {
        ok: false,
        error: "OFFICIAL_API_CONTRACT_UNVERIFIED",
        messageFa:
          "حالت واقعی فعال نشد: قرارداد رسمی API، دسترسی Spot-only بدون برداشت، journal واقعی و آزمون اتصال هنوز تأیید نشده‌اند. هیچ سفارش واقعی ارسال نشد.",
      };
    orchestrator.stopTrading();
    orchestrator.stopScanner();
    return {
      ok: true,
      mode: "DEMO",
      messageFa: "حالت دمو انتخاب شد؛ شروع معامله همچنان دستی است.",
    };
  });
  app.post(
    [
      "/api/trading/activate-live",
      "/api/settings/bit24",
      "/api/settings/bit24/verify",
      "/api/settings/bit24/clear",
      "/api/settings/telegram",
      "/api/settings/telegram/daily-report",
    ],
    (_req, res) =>
      res.status(403).json({
        ok: false,
        error: "DEMO_ONLY_EXTERNAL_NETWORK_DISABLED",
        messageFa:
          "اتصال زنده، کلید صرافی، تلگرام و معاملهٔ واقعی در این نسخه غیرفعال‌اند.",
      }),
  );
  app.all("/api/*withdraw*", (_req, res) =>
    res.status(403).json({ ok: false, error: "WITHDRAWAL_FORBIDDEN" }),
  );
  app.get("/api/reports/trades.csv", (_req, res) => {
    res
      .type("text/csv")
      .attachment("demo-trades.csv")
      .send(orchestrator.exportTradeHistoryCsv());
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ ok: false, error: "API_NOT_FOUND" }),
  );
  const web = path.resolve("dist/client");
  if (fs.existsSync(web)) {
    app.use(express.static(web));
    app.get("*", (_req, res) => res.sendFile(path.join(web, "index.html")));
  }
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ ok: false, error: "INVALID_REQUEST_BODY" });
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function cycle() {
    try {
      await serialize(async () => {
        if (stopped || storageFault) return;
        await transaction(async () => {
          await orchestrator.stepCycle();
          return ok();
        });
      });
    } catch {
      storageFault = true;
      orchestrator.stopTrading();
      console.error("DEMO_CYCLE_HALTED_CHECK_STORAGE");
    }
    if (!stopped) timer = setTimeout(cycle, 4000);
  }
  if (options.autoCycle !== false) timer = setTimeout(cycle, 4000);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    wss.clients.forEach((c) => c.terminate());
    wss.close();
    store.close();
  };
  httpServer.on("close", stop);
  return { app, httpServer, orchestrator, stop, store, cycle };
}
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("server/index.ts") ||
    process.argv[1].endsWith("server/index.js"));
if (isMain) {
  const server = createBit24ProAppServer();
  server.httpServer.listen(
    Number(process.env.PORT ?? 3000),
    process.env.HOST ?? "0.0.0.0",
    () =>
      console.log(
        "BIT24 DEMO: no external exchange connectivity. Listening on port " +
          (process.env.PORT ?? 3000),
      ),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.stop();
      server.httpServer.close(() => process.exit(0));
    });
}
