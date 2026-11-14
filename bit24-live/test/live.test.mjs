import { request as httpRequest } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Bit24ReadClient,
  ExchangeError,
  decimal,
  parseTotals,
  parseMarkets,
  parseOrders,
} from "../exchange.mjs";
import { createLiveConsole } from "../server.mjs";
const envelope = (data) =>
  new Response(JSON.stringify({ success: true, status_code: 200, data }), {
    headers: { "content-type": "application/json" },
  });
// EXPLICIT UNIT FIXTURES ONLY. These are never imported by runtime or displayed as real balances.
const totals = {
  assets: {
    user: {
      total_assets_in_irt: "123.456789",
      available_assets_in_irt: "90.123456",
    },
    margin: { total_assets_in_irt: "9999999" },
  },
};
const market = {
  id: 1,
  market_name: "BTC/IRT",
  each_price: "100.0000000000000000",
  total_min: "70000",
  base_coin_decimal: 8,
  quote_coin_decimal: 0,
  market_24h_information: { change_percent: "-1.2", quote_volume: "234.1234" },
};
const order = {
  id: 1,
  market: "BTC/IRT",
  side: { index: 1 },
  status: { filter_index: 3 },
  filled_value: "0.01",
  fill_price: "100",
  total_commission: "0.02",
  updated_at: 1700000000,
};
const page = (results) => ({
  results,
  has_paginate: 1,
  current_page: 1,
  last_page: 1,
});
test("parses exact decimal strings without float financial calculations", () => {
  assert.equal(
    decimal("12345678901234567890.00000001"),
    "12345678901234567890.00000001",
  );
  for (const s of ["1e9", "NaN", 1, "-1", "Infinity", "<script>"])
    assert.throws(() => decimal(s));
});
test("main wallet valuation is not mistaken for all-wallet margin funds or spendable IRT", () => {
  assert.deepEqual(parseTotals(totals), {
    scope: "USER_WALLET_VALUATION",
    totalIrt: "123.456789",
    availableValuationIrt: "90.123456",
  });
  assert.throws(() =>
    parseTotals({ assets: { total_assets: { total_assets_in_irt: "1" } } }),
  );
});
test("validates documented market contract without fake signal scores", () => {
  assert.equal(parseMarkets(page([market]))[0].priceIrt, market.each_price);
  assert.throws(() =>
    parseMarkets(page([{ ...market, market_name: "BTC/USDT" }])),
  );
  assert.throws(() => parseMarkets(page([{ ...market, each_price: "NaN" }])));
});
test("partial orders are not presented as completed trades or fee currencies assumed", () => {
  const o = parseOrders(page([order]))[0];
  assert.equal(o.status, 3);
  assert.equal(o.commissionCurrencyVerified, false);
  assert.equal(
    parseOrders(page([{ ...order, fill_price: null }]))[0].averagePrice,
    null,
  );
});
test("missing API key never calls network", async () => {
  let calls = 0;
  const c = new Bit24ReadClient({ apiKey: "", fetcher: () => calls++ });
  await assert.rejects(c.snapshot(), /API_KEY_REQUIRED/);
  assert.equal(calls, 0);
});
test("transport rejects withdrawal, transfer, arbitrary URLs and unreviewed endpoints", async () => {
  const c = new Bit24ReadClient({ apiKey: "test-only" });
  for (const path of [
    "/lite/capi/v1/withdraw/submit",
    "https://evil.invalid",
    "/pro/capi/v2/spot-orders/submit",
  ])
    await assert.rejects(c.get(path), /ENDPOINT_NOT_ALLOWED/);
});
test("only documented origin and header are used; API errors and keys never echoed", async () => {
  const c = new Bit24ReadClient({
    apiKey: "fixture-not-real",
    fetcher: async (url, options) => {
      assert.equal(url.origin, "https://rest.bit24.cash");
      assert.equal(options.method, "GET");
      assert.equal(options.headers["X-BIT24-APIKEY"], "fixture-not-real");
      assert.equal(options.redirect, "error");
      return new Response("secret fixture-not-real", { status: 401 });
    },
  });
  await assert.rejects(
    c.snapshot(),
    (e) => e.message === "EXCHANGE_AUTH_REJECTED",
  );
});
test("hard timeout terminates waiting even when transport ignores abort", async () => {
  const c = new Bit24ReadClient({
    apiKey: "fixture",
    timeoutMs: 15,
    fetcher: () => new Promise(() => {}),
  });
  await assert.rejects(c.snapshot(), /EXCHANGE_TIMEOUT/);
});
test("429 applies Retry-After cooldown without retrying requests", async () => {
  let n = 0;
  const c = new Bit24ReadClient({
    apiKey: "fixture",
    now: () => 1000,
    fetcher: async () => {
      n++;
      return new Response("", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    },
  });
  await assert.rejects(c.snapshot(), /RATE_LIMITED/);
  await assert.rejects(c.snapshot(), /RATE_LIMITED/);
  assert.equal(n, 1);
});
test("provider success false and malformed JSON cannot become a connected account", async () => {
  for (const response of [
    () => envelope(null),
    () =>
      new Response(
        JSON.stringify({ success: false, status_code: 401, data: totals }),
        { headers: { "content-type": "application/json" } },
      ),
    () =>
      new Response("invalid", {
        headers: { "content-type": "application/json" },
      }),
  ]) {
    const c = new Bit24ReadClient({
      apiKey: "fixture",
      fetcher: async () => response(),
    });
    await assert.rejects(c.snapshot());
  }
});
test("fresh authenticated complete read produces no manufactured P&L and deduplicates concurrent sync", async () => {
  let calls = 0;
  const c = new Bit24ReadClient({
    apiKey: "fixture",
    now: () => 1000,
    fetcher: async (u) => {
      calls++;
      if (u.pathname.includes("assets/total")) return envelope(totals);
      if (u.pathname.endsWith("/markets")) return envelope(page([market]));
      return envelope(page([order]));
    },
  });
  const [a, b] = await Promise.all([c.snapshot(), c.snapshot()]);
  assert.equal(a, b);
  assert.equal(calls, 3);
  assert.equal(a.profitIrt, null);
  assert.equal(a.winRate, null);
  assert.equal(a.receivedAt, 1000);
});
test("duplicate IDs and unexpected pagination reject the entire snapshot", async () => {
  for (const data of [
    page([market, market]),
    { ...page([market]), current_page: 2 },
  ]) {
    const c = new Bit24ReadClient({
      apiKey: "fixture",
      fetcher: async (u) =>
        envelope(u.pathname.includes("assets/total") ? totals : u.pathname.endsWith("/spot-orders")?page([order]):data),
    });
    await assert.rejects(c.snapshot(), /PAGINATION_INVALID/);
  }
});
test("partial snapshot failure never returns any financial snapshot", async () => {
  const c = new Bit24ReadClient({
    apiKey: "fixture",
    fetcher: async (u) => {
      if (u.pathname.includes("assets/total")) return envelope(totals);
      throw Error("private upstream secret");
    },
  });
  await assert.rejects(
    c.snapshot(),
    (e) => e.message === "EXCHANGE_NETWORK_ERROR",
  );
});
test("server rejects short owner passwords and insecure deployment origins", () => {
  assert.throws(() =>
    createLiveConsole({
      origin: "https://app.example",
      ownerPassword: "short",
    }),
  );
  assert.throws(() =>
    createLiveConsole({
      origin: "http://public.example",
      ownerPassword: "x".repeat(40),
    }),
  );
});
async function withServer(fn, { client, now } = {}) {
  const server = createLiveConsole({
    origin: "http://localhost",
    ownerPassword: "x".repeat(40),
    client: client || {
      snapshot: async () => {
        throw new ExchangeError("API_KEY_REQUIRED");
      },
    },
    now,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (
    path,
    {
      method = "GET",
      body,
      cookie,
      origin = "http://localhost",
      host = "localhost",
    } = {},
  ) =>
    new Promise((resolve, reject) => {
      const r = httpRequest(
        base + path,
        {
          method,
          headers: {
            Host: host,
            Origin: origin,
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (b) => chunks.push(b));
          res.on("end", () =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers: res.headers,
              }),
            ),
          );
        },
      );
      r.on("error", reject);
      r.end(body ? JSON.stringify(body) : undefined);
    });
  try {
    await fn(call);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
async function login(call) {
  const r = await call("/api/login", {
    method: "POST",
    body: { password: "x".repeat(40) },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  return r.headers.get("set-cookie").split(";")[0];
}
test("private data requires owner login and no wildcard origin is allowed", () =>
  withServer(async (call) => {
    assert.equal((await call("/api/state")).status, 401);
    assert.equal(
      (
        await call("/api/login", {
          method: "POST",
          body: { password: "x".repeat(40) },
          origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/state", { host: "evil.invalid" })).status,
      421,
    );
  }));
test("no key: null snapshot, explicit missing prerequisite, never a fabricated zero balance", () =>
  withServer(async (call) => {
    const cookie = await login(call);
    const data = await (await call("/api/state", { cookie })).json();
    assert.equal(data.snapshot, null);
    assert.equal(data.error, "API_KEY_REQUIRED");
    assert.equal(data.execution.enabled, false);
    assert.equal(data.limits.enforcedForExecution, false);
    assert.ok(!JSON.stringify(data).includes("x".repeat(40)));
  }));
test("all writes remain locked even after owner login, including panic/liquidation requests", () =>
  withServer(async (call) => {
    const cookie = await login(call);
    for (const path of [
      "/api/buy",
      "/api/withdraw",
      "/api/activate",
      "/api/panic",
    ]) {
      const r = await call(path, { method: "POST", body: {}, cookie });
      assert.equal(r.status, 423);
      assert.equal((await r.json()).orderSubmitted, false);
    }
  }));
test("logout invalidates the session", () =>
  withServer(async (call) => {
    const cookie = await login(call);
    assert.equal(
      (await call("/api/logout", { method: "POST", body: {}, cookie })).status,
      200,
    );
    assert.equal((await call("/api/state", { cookie })).status, 401);
  }));
test("login is rate limited", () =>
  withServer(async (call) => {
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await call("/api/login", {
            method: "POST",
            body: { password: "wrong" },
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await call("/api/login", {
          method: "POST",
          body: { password: "wrong" },
        })
      ).status,
      429,
    );
  }));
test("upstream loss clears earlier verified data; no stale connected account after failure", async () => {
  let time = 1000,
    fail = false,
    calls = 0;
  await withServer(
    async (call) => {
      const cookie = await login(call);
      const first = await (await call("/api/state", { cookie })).json();
      assert.equal(first.connection, "AUTHENTICATED_READ");
      await call("/api/state", { cookie });
      assert.equal(calls, 1);
      time += 16000;
      fail = true;
      const next = await (await call("/api/state", { cookie })).json();
      assert.equal(next.connection, "DISCONNECTED");
      assert.equal(next.snapshot, null);
    },
    {
      now: () => time,
      client: {
        snapshot: async () => {
          calls++;
          if (fail) throw Error("private account detail");
          return {
            receivedAt: time,
            totals: parseTotals(totals),
            markets: [],
            orders: [],
          };
        },
      },
    },
  );
});
test("frontend contains no demo bootstrap; security headers and PWA shell are served", () =>
  withServer(async (call) => {
    const r = await call("/");
    assert.match(
      r.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal(r.headers.get("cache-control"), "no-store");
    const manifest = await (await call("/manifest.webmanifest")).json();
    assert.equal(manifest.display, "standalone");
    const sw = await (await call("/sw.js")).text();
    assert.ok(!sw.includes("'/api/state'"));
    const js = await (await call("/app.js")).text();
    assert.ok(!js.includes("localStorage"));
  }));

test("session expires after eight hours without authorizing another request", async () => {
  let time = 0;
  await withServer(
    async (call) => {
      const cookie = await login(call);
      time = 8 * 3600000 + 1;
      assert.equal((await call("/api/state", { cookie })).status, 401);
    },
    { now: () => time },
  );
});

test("slow multi-page synchronization cannot label old wallet data as newly fresh", async () => {
  let time = 0,
    calls = 0;
  const c = new Bit24ReadClient({
    apiKey: "fixture",
    now: () => time,
    fetcher: async (u) => {
      calls++;
      time += 11000;
      return envelope(
        u.pathname.includes("assets/total") ? totals : page([market]),
      );
    },
  });
  await assert.rejects(c.snapshot(), /SNAPSHOT_TOO_OLD/);
  assert.equal(calls, 2);
});
