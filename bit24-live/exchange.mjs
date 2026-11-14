/** Read contract reviewed against https://docs.bit24.cash/ . No write/signature guesses. */
const ORIGIN = "https://rest.bit24.cash";
const PATHS = new Set([
  "/asset/capi/v1/wallet/assets/total",
  "/pro/capi/v2/markets",
  "/pro/capi/v2/spot-orders",
]);
export class ExchangeError extends Error {
  constructor(code, retryAfter = 0) {
    super(code);
    this.retryAfter = retryAfter;
  }
}
export function decimal(value, { signed = false } = {}) {
  if (
    typeof value !== "string" ||
    value.length > 60 ||
    !(signed ? /^-?\d+(\.\d{1,24})?$/ : /^\d+(\.\d{1,24})?$/).test(value)
  )
    throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
  return value;
}
function integer(n, min = 0, max = 10000000) {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
  return n;
}
function text(s) {
  if (typeof s !== "string" || s.length > 100)
    throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
  return s;
}
function symbol(s) {
  if (typeof s !== "string" || !/^([A-Z0-9]{1,24})\/IRT$/.test(s))
    throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
  return s;
}
export function parseTotals(data) {
  const user = data?.assets?.user;
  // USER wallet only: margin, investment and exchange bots are not bot-managed Spot capital.
  return {
    scope: "USER_WALLET_VALUATION",
    totalIrt: decimal(user?.total_assets_in_irt),
    availableValuationIrt: decimal(user?.available_assets_in_irt),
  };
}
export function parseMarkets(data) {
  if (!Array.isArray(data?.results) || data.results.length > 100)
    throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
  return data.results.map((m) => ({
    id: integer(m.id, 1),
    symbol: symbol(m.market_name),
    priceIrt: decimal(m.each_price),
    minimumNotionalIrt: decimal(m.total_min),
    baseDecimals: integer(m.base_coin_decimal, 0, 24),
    quoteDecimals: integer(m.quote_coin_decimal, 0, 24),
    change24hPct: decimal(m.market_24h_information?.change_percent, {
      signed: true,
    }),
    volume24hIrt: decimal(m.market_24h_information?.quote_volume),
  }));
}
export function parseOrders(data) {
  if (!Array.isArray(data?.results) || data.results.length > 100)
    throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
  return data.results.map((o) => ({
    id: integer(o.id, 1),
    symbol: symbol(o.market),
    side: integer(o.side?.index, 0, 1) === 1 ? "BUY" : "SELL",
    status: integer(o.status?.filter_index, 0, 3),
    filledQuantity: decimal(o.filled_value),
    averagePrice: o.fill_price === null ? null : decimal(o.fill_price),
    commission: decimal(o.total_commission),
    commissionCurrencyVerified: false,
    updatedAt: integer(o.updated_at, 0, 9999999999),
  }));
}
function pagination(data, page) {
  if (![0, 1].includes(data.has_paginate))
    throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
  if (data.has_paginate === 0) return false;
  if (integer(data.current_page, 1) !== page)
    throw new ExchangeError("EXCHANGE_PAGINATION_INVALID");
  return page < integer(data.last_page, 1, 1000);
}
export class Bit24ReadClient {
  constructor({ apiKey, fetcher = fetch, now = Date.now, timeoutMs = 8000 }) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.notBefore = 0;
    this.inFlight = null;
    this.snapshotDeadline = Infinity;
  }
  async get(path, params = {}) {
    if (!PATHS.has(path)) throw new ExchangeError("ENDPOINT_NOT_ALLOWED");
    if (!this.apiKey || /[\r\n]/.test(this.apiKey))
      throw new ExchangeError("API_KEY_REQUIRED");
    if (this.now() < this.notBefore)
      throw new ExchangeError("RATE_LIMITED", this.notBefore - this.now());
    const url = new URL(path, ORIGIN);
    for (const [k, v] of Object.entries(params))
      url.searchParams.set(k, String(v));
    const requestBudget = Math.min(
      this.timeoutMs,
      this.snapshotDeadline - this.now(),
    );
    if (requestBudget <= 0) throw new ExchangeError("SNAPSHOT_TOO_OLD");
    const controller = new AbortController();
    let timer;
    try {
      // Enforced deadline includes body consumption, even if an injected transport ignores abort.
      return await Promise.race([
        (async () => {
          const r = await this.fetcher(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "X-BIT24-APIKEY": this.apiKey,
            },
            redirect: "error",
            signal: controller.signal,
          });
          if (r.status === 429) {
            const retry = r.headers.get("retry-after");
            const ms = /^\d+$/.test(retry || "")
              ? Number(retry) * 1000
              : Date.parse(retry || "") - this.now();
            const delay = Number.isFinite(ms)
              ? Math.max(1000, Math.min(ms, 3600000))
              : 60000;
            this.notBefore = this.now() + delay;
            throw new ExchangeError("RATE_LIMITED", delay);
          }
          if (!r.ok)
            throw new ExchangeError(
              r.status === 401 || r.status === 403
                ? "EXCHANGE_AUTH_REJECTED"
                : "EXCHANGE_UNAVAILABLE",
            );
          if (!r.headers.get("content-type")?.includes("application/json"))
            throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
          // Bound streamed responses; untrusted upstream messages are NEVER forwarded to browser/logs.
          const reader = r.body?.getReader();
          if (!reader) throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
          let size = 0;
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) {
              await reader.cancel();
              throw new ExchangeError("EXCHANGE_RESPONSE_TOO_LARGE");
            }
            chunks.push(value);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (body.success !== true || body.status_code !== 200 || !body.data)
            throw new ExchangeError("EXCHANGE_RESPONSE_REJECTED");
          return body.data;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ExchangeError("EXCHANGE_TIMEOUT"));
          }, requestBudget);
        }),
      ]);
    } catch (e) {
      if (e instanceof ExchangeError) throw e;
      throw new ExchangeError("EXCHANGE_NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  async pages(path, parse, params) {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const data = await this.get(path, { ...params, page, per_page: 40 });
      all.push(...parse(data));
      if (!pagination(data, page)) return all;
    }
    throw new ExchangeError("EXCHANGE_PAGE_LIMIT");
  }
  snapshot() {
    if (this.inFlight) return this.inFlight;
    const startedAt = this.now();
    this.snapshotDeadline = startedAt + 20000;
    this.inFlight = (async () => {
      const totals = parseTotals(
        await this.get("/asset/capi/v1/wallet/assets/total"),
      );
      const markets = await this.pages("/pro/capi/v2/markets", parseMarkets, {
        quote_coin_symbol: "IRT",
      });
      const orders = await this.pages(
        "/pro/capi/v2/spot-orders",
        (d) =>
          parseOrders({
            ...d,
            results: d.results?.filter((o) => {
              if (
                typeof o?.market !== "string" ||
                !/^([A-Z0-9]{1,24})\/([A-Z0-9]{1,24})$/.test(o.market)
              )
                throw new ExchangeError("EXCHANGE_SCHEMA_CHANGED");
              return o.market.endsWith("/IRT");
            }),
          }),
        {},
      );
      if (
        new Set(markets.map((m) => m.id)).size !== markets.length ||
        new Set(orders.map((o) => o.id)).size !== orders.length
      )
        throw new ExchangeError("EXCHANGE_PAGINATION_INVALID");
      if (this.now() - startedAt > 20000)
        throw new ExchangeError("SNAPSHOT_TOO_OLD");
      return {
        totals,
        markets,
        orders,
        receivedAt: startedAt,
        source: "BIT24_AUTHENTICATED_REST",
        profitIrt: null,
        winRate: null,
      };
    })().finally(() => {
      this.snapshotDeadline = Infinity;
      this.inFlight = null;
    });
    return this.inFlight;
  }
}
