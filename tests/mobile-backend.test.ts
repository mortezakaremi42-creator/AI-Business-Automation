import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBit24ProAppServer } from "../src/server/index.js";
import {
  BackendClient,
  BackendError,
  normalizeBackendBase,
} from "../src/ui/backendClient.js";
import { createMobileAccess } from "../src/server/mobileAccess.js";
import { Bit24AiTraderOrchestrator } from "../src/engine/traderOrchestrator.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
const temporary = mkdtempSync(join(tmpdir(), "bit24-mobile-"));
const server = createBit24ProAppServer({
  token: "test-dashboard-only",
  allowedOrigins: ["http://localhost"],
  stateFile: join(temporary, "state.json"),
  autoCycle: false,
});
let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) =>
    server.httpServer.listen(0, "127.0.0.1", resolve),
  );
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw Error("address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.stop();
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
  rmSync(temporary, { recursive: true, force: true });
});
const headers = {
  "X-API-Token": "test-dashboard-only",
  "Content-Type": "application/json",
};
describe("mobile backend integration", () => {
  it("exposes Demo readiness and refuses LIVE without any guessed adapter", async () => {
    const status = await fetch(base + "/api/execution/status", {
      headers,
    }).then((r) => r.json());
    expect(status.liveAvailable).toBe(false);
    expect(status.mode).toBe("DEMO");
    const r = await fetch(base + "/api/execution/mode", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ mode: "LIVE" }),
    });
    const result = await r.json();
    expect(result.ok).toBe(false);
    expect(
      (
        await fetch(base + "/api/execution/status", { headers }).then((r) =>
          r.json(),
        )
      ).mode,
    ).toBe("DEMO");
  });
  it("protects status, writes and report without a token", async () => {
    for (const path of ["/api/status", "/api/reports/trades.csv"])
      expect((await fetch(base + path)).status).toBe(401);
    expect(
      (
        await fetch(base + "/api/buy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"symbol":"BTC/IRT"}',
        })
      ).status,
    ).toBe(401);
  });
  it("allows native preflight, rejects untrusted origins without wildcard CORS", async () => {
    const r = await fetch(base + "/api/status", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost",
        "Access-Control-Request-Headers": "X-API-Token",
      },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost",
    );
    expect(
      (
        await fetch(base + "/api/status", {
          headers: { ...headers, Origin: "https://evil.invalid" },
        })
      ).status,
    ).toBe(403);
  });
  it("syncs server snapshot and coin adapter without browser simulation", async () => {
    const client = new BackendClient({
      baseUrl: base,
      token: headers["X-API-Token"],
    });
    const snap = await client.sync();
    expect(snap.appName).toBe("BIT24 AI TRADER PRO");
    const coins = await client.request("/api/coins");
    expect(coins.length).toBeGreaterThan(0);
    expect(coins[0]).toEqual(
      expect.objectContaining({
        symbol: expect.any(String),
        price: expect.any(Number),
        buyPower: expect.any(Number),
        volumeGrowth: expect.any(Number),
        rsi: expect.any(Number),
      }),
    );
    expect(snap.liveTradingUserConfirmed).toBe(false);
  });
  it("rejects malformed trade targets, duplicate close and live activation", async () => {
    for (const path of ["/api/buy", "/api/sell"]) {
      const r = await fetch(base + path, {
        method: "POST",
        headers,
        body: '{"symbol":"NOT-A-MARKET"}',
      });
      expect([400, 404, 422]).toContain(r.status);
      expect((await r.json()).ok).toBe(false);
    }
    const r = await fetch(base + "/api/trading/activate-live", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(r.status).toBe(403);
  });
  it("buys and sells through the actual HTTP aliases", async () => {
    server.orchestrator.startDemoTrading();
    server.orchestrator.startScanner();
    await server.orchestrator.stepCycle();
    let symbol: string | undefined;
    for (const sig of server.orchestrator.getSnapshot().topOpportunities) {
      const r = await fetch(base + "/api/buy", {
        method: "POST",
        headers,
        body: JSON.stringify({ symbol: sig.symbol, requestId: randomUUID() }),
      });
      if (r.ok) {
        symbol = sig.symbol;
        break;
      }
    }
    expect(symbol).toBeDefined();
    const r = await fetch(base + "/api/sell", {
      method: "POST",
      headers,
      body: JSON.stringify({ symbol, requestId: randomUUID() }),
    });
    expect(r.status).toBe(200);
    expect(
      (await r.json()).snapshot.openPositions.some(
        (p: { symbol: string }) => p.symbol === symbol,
      ),
    ).toBe(false);
    expect(
      (
        await fetch(base + "/api/sell", {
          method: "POST",
          headers,
          body: JSON.stringify({ symbol, requestId: randomUUID() }),
        })
      ).status,
    ).toBe(400);
  });
  it("executes one DEMO position close and prevents closing it twice", async () => {
    const engine = new Bit24AiTraderOrchestrator();
    engine.startDemoTrading();
    engine.startScanner();
    await engine.stepCycle();
    let symbol: string | undefined;
    for (const sig of engine.getSnapshot().topOpportunities) {
      if ((await engine.tryOpenCryptoPosition(sig)).ok) {
        symbol = sig.symbol;
        break;
      }
    }
    expect(symbol).toBeDefined();
    expect((await engine.closeDemoPosition(symbol!)).ok).toBe(true);
    expect((await engine.closeDemoPosition(symbol!)).ok).toBe(false);
  });
  it("blocks network access without configured token, including websockets", () => {
    const guard = createMobileAccess({ token: "" });
    const req = {
      headers: {},
      socket: { remoteAddress: "192.168.1.40" },
    } as IncomingMessage;
    expect(guard.verifyWebSocket(req)).toBe(false);
    const auth = createMobileAccess({ token: "abc" });
    expect(
      auth.verifyWebSocket({
        ...req,
        headers: {
          "sec-websocket-protocol": "bit24-dashboard, token.abc",
          origin: "http://localhost",
        },
      } as IncomingMessage),
    ).toBe(true);
  });
  it("has debug-only LAN cleartext and expected Capacitor identity", () => {
    const config = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
    expect(config.appId).toBe("com.bit24.trader");
    expect(config.webDir).toBe("dist/client");
    expect(config.server.cleartext).toBe(false);
    expect(
      readFileSync("android/app/src/main/AndroidManifest.xml", "utf8"),
    ).toContain('android:usesCleartextTraffic="false"');
    expect(
      readFileSync("android/app/src/debug/AndroidManifest.xml", "utf8"),
    ).toContain('android:usesCleartextTraffic="true"');
  });
});
describe("HTTP client failure safety", () => {
  it("normalizes only host origins, no paths or credentials", () => {
    expect(normalizeBackendBase(" http://192.168.1.20:3000/ ")).toBe(
      "http://192.168.1.20:3000",
    );
    for (const url of [
      "ftp://server",
      "http://user:pass@server",
      "https://server/api",
      "https://server?x=1",
    ])
      expect(() => normalizeBackendBase(url)).toThrow();
  });
  it("never retries a lost buy response and labels it UNKNOWN", async () => {
    let calls = 0;
    const client = new BackendClient({ baseUrl: "", token: "" }, async () => {
      calls++;
      throw Error("lost");
    });
    await expect(
      client.request("/api/buy", { symbol: "BTC/IRT" }),
    ).rejects.toMatchObject({ unknownWrite: true });
    expect(calls).toBe(1);
  });
  it("distinguishes explicit rejection from uncertain server result", async () => {
    for (const [status, unknownWrite] of [
      [400, false],
      [503, true],
    ] as const) {
      const client = new BackendClient(
        { baseUrl: "", token: "" },
        async () =>
          new Response(JSON.stringify({ ok: false }), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
      );
      await expect(
        client.request("/api/sell", { symbol: "BTC/IRT" }),
      ).rejects.toMatchObject({ unknownWrite });
    }
  });
  it("does not accept HTML or an unacknowledged write as success", async () => {
    for (const response of [
      new Response("<html/>"),
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ]) {
      const client = new BackendClient(
        { baseUrl: "", token: "" },
        async () => response,
      );
      await expect(client.request("/api/buy", {})).rejects.toBeInstanceOf(
        BackendError,
      );
    }
  });
});
