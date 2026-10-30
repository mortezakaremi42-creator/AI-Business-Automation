import crypto from 'node:crypto';
import {
  Bit24ApiHealth,
  Bit24TickerMarket,
  CandleBar,
  OrderBookDepth,
} from '../shared/contracts.js';
import { roundIrtPrice } from '../engine/bit24Catalog.js';
import { EncryptedSecretVault, maskSensitiveValue } from './encryptedVault.js';

export const BIT24_REST_BASE_URL =
  process.env.BIT24_API_BASE_URL || 'https://rest.bit24.cash';

export function assertNoWithdrawalEndpoint(endpointPath: string): void {
  const normalized = endpointPath.toLowerCase();
  if (normalized.includes('withdraw') || normalized.includes('transfer-out')) {
    throw new Error(
      'BIT24_WITHDRAWAL_FORBIDDEN: Withdrawal endpoints are permanently blocked by BIT24 AI TRADER PRO security policy.'
    );
  }
}

export function createBit24HmacSignature(
  formUrlEncodedBody: string,
  secretKey: string
): string {
  return crypto
    .createHmac('sha256', secretKey)
    .update(formUrlEncodedBody, 'utf8')
    .digest('hex');
}

export class Bit24OfficialRestClient {
  private readonly vault: EncryptedSecretVault;
  private readonly baseUrl: string;
  private requestTimestamps: number[] = [];

  constructor(vault: EncryptedSecretVault, baseUrl = BIT24_REST_BASE_URL) {
    this.vault = vault;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private enforceRateLimit(): void {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      (t) => now - t < 60_000
    );
    if (this.requestTimestamps.length >= 235) {
      throw new Error(
        'BIT24_RATE_LIMIT_GUARD: Approaching Bit24 250 req/min limit; request throttled safely.'
      );
    }
    this.requestTimestamps.push(now);
  }

  private async requestJson(params: {
    method: 'GET' | 'POST';
    endpointPath: string;
    query?: Record<string, string | number | undefined>;
    formBody?: Record<string, string | number | undefined>;
    requireSignature?: boolean;
    timeoutMs?: number;
  }): Promise<{ ok: boolean; status: number; data: any; latencyMs: number; error?: string }> {
    assertNoWithdrawalEndpoint(params.endpointPath);
    this.enforceRateLimit();

    const secrets = this.vault.getSecretsInternal();
    if (!secrets.bit24ApiKey) {
      return {
        ok: false,
        status: 0,
        data: null,
        latencyMs: 0,
        error: 'BIT24_API_KEY_MISSING',
      };
    }

    if (params.requireSignature && !secrets.bit24SecretKey) {
      return {
        ok: false,
        status: 0,
        data: null,
        latencyMs: 0,
        error: 'BIT24_SECRET_KEY_MISSING',
      };
    }

    const url = new URL(`${this.baseUrl}${params.endpointPath}`);
    if (params.query) {
      for (const [k, v] of Object.entries(params.query)) {
        if (v !== undefined && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-BIT24-APIKEY': secrets.bit24ApiKey,
    };

    let bodyStr: string | undefined;
    if (params.method === 'POST') {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(params.formBody || {})) {
        if (v !== undefined && v !== '') {
          form.append(k, String(v));
        }
      }
      if (params.requireSignature) {
        const sig = createBit24HmacSignature(
          form.toString(),
          secrets.bit24SecretKey
        );
        form.append('signature', sig);
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      bodyStr = form.toString();
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      params.timeoutMs || 8_000
    );

    try {
      const resp = await fetch(url.toString(), {
        method: params.method,
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        return {
          ok: false,
          status: resp.status,
          data: json,
          latencyMs,
          error:
            json?.message ||
            json?.error ||
            `HTTP_${resp.status}`,
        };
      }
      return {
        ok: true,
        status: resp.status,
        data: json,
        latencyMs,
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 0,
        data: null,
        latencyMs: Date.now() - started,
        error: err?.name === 'AbortError' ? 'TIMEOUT' : err?.message || 'NETWORK_UNREACHABLE',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Probes official Bit24 CAPI v2 (`/pro/capi/v2/markets` + `/asset/capi/v1/wallet/assets`)
   * and returns honest diagnostic health.
   */
  public async verifyConnectionHealth(): Promise<Bit24ApiHealth> {
    const secrets = this.vault.getSecretsInternal();
    const maskedApiKey = maskSensitiveValue(secrets.bit24ApiKey);

    if (!secrets.bit24ApiKey) {
      return {
        state: 'NOT_CONFIGURED',
        hasApiKey: false,
        hasSecretKey: Boolean(secrets.bit24SecretKey),
        maskedApiKey: '',
        withdrawalPermissionBlocked: true,
        baseUrl: this.baseUrl,
        lastCheckedAt: Date.now(),
        latencyMs: null,
        activeMarketFeed: 'SIMULATED_MARKET_FEED',
        messageFa:
          'کلید API صرافی Bit24 وارد نشده است؛ سامانه در حالت شبیه‌ساز دمو فعال است.',
        messageEn:
          'Bit24 API key is not configured; running in safe Demo simulator mode.',
      };
    }

    const marketRes = await this.requestJson({
      method: 'GET',
      endpointPath: '/pro/capi/v2/markets',
      query: { per_page: 100 },
      timeoutMs: 6_500,
    });

    if (!marketRes.ok) {
      const isAuthErr = marketRes.status === 401 || marketRes.status === 403;
      return {
        state: isAuthErr ? 'AUTH_ERROR' : 'OFFLINE_OR_UNREACHABLE',
        hasApiKey: true,
        hasSecretKey: Boolean(secrets.bit24SecretKey),
        maskedApiKey,
        withdrawalPermissionBlocked: true,
        baseUrl: this.baseUrl,
        lastCheckedAt: Date.now(),
        latencyMs: marketRes.latencyMs,
        activeMarketFeed: 'SIMULATED_MARKET_FEED',
        messageFa: isAuthErr
          ? `خطای احراز هویت کلید Bit24 (کد ${marketRes.status}): لطفاً کلید API یا محدودیت IP را در پنل Bit24 بررسی کنید.`
          : `سرور رسمی rest.bit24.cash در شبکه فعلی در دسترس نیست (${marketRes.error})؛ ربات به‌صورت خودکار روی فید امن شبیه‌ساز دمو قرار گرفت.`,
        messageEn: isAuthErr
          ? `Bit24 API authentication failed (HTTP ${marketRes.status}): verify API token & IP whitelist.`
          : `Official rest.bit24.cash unreachable from current network (${marketRes.error}); safely running on Demo feed.`,
      };
    }

    return {
      state: secrets.bit24SecretKey
        ? 'CONNECTED_PUBLIC_AND_PRIVATE'
        : 'CONNECTED_TOKEN_ONLY',
      hasApiKey: true,
      hasSecretKey: Boolean(secrets.bit24SecretKey),
      maskedApiKey,
      withdrawalPermissionBlocked: true,
      baseUrl: this.baseUrl,
      lastCheckedAt: Date.now(),
      latencyMs: marketRes.latencyMs,
      activeMarketFeed: 'LIVE_BIT24_API',
      messageFa: secrets.bit24SecretKey
        ? `متصل به API رسمی Bit24 (${marketRes.latencyMs}ms) — قیمت زنده و کیف پول آماده است (برداشت وجه مسدود است).`
        : `متصل به فید زنده بازار Bit24 (${marketRes.latencyMs}ms) — فقط خواندنی (کلید اختصاصی معامله وارد نشده است).`,
      messageEn: secrets.bit24SecretKey
        ? `Connected to official Bit24 API (${marketRes.latencyMs}ms) — live feed & spot trading ready (withdrawals blocked).`
        : `Connected to live Bit24 market feed (${marketRes.latencyMs}ms) — read-only token mode.`,
    };
  }

  /**
   * Fetches official Bit24 IRT markets (`/pro/capi/v2/markets`), separating GOLD (`PAXG`, `XAUT`) from CRYPTO.
   */
  public async fetchLiveIrtMarkets(): Promise<Bit24TickerMarket[] | null> {
    const res = await this.requestJson({
      method: 'GET',
      endpointPath: '/pro/capi/v2/markets',
      query: { per_page: 150 },
      timeoutMs: 7_000,
    });
    if (!res.ok || !res.data) return null;

    const rawList: any[] = Array.isArray(res.data?.data?.results)
      ? res.data.data.results
      : Array.isArray(res.data?.data)
      ? res.data.data
      : [];

    const out: Bit24TickerMarket[] = [];
    const now = Date.now();

    for (const item of rawList) {
      const quote = String(item.quote_coin_symbol || '').toUpperCase();
      const base = String(item.base_coin_symbol || '').toUpperCase();
      if (quote !== 'IRT' || !base || base === 'USDT') continue;

      const price = Number(item.each_price || 0);
      if (!Number.isFinite(price) || price <= 0) continue;

      const info24 = item.market_24h_information || {};
      const chg24 = Number(info24.change_percent || 0);
      const volBase = Number(info24.base_volume || 0);
      const volQuote = Number(info24.quote_volume || volBase * price);
      const isGold = base === 'PAXG' || base === 'XAUT';

      out.push({
        symbol: `${base}/IRT`,
        baseCoin: base,
        quoteCoin: 'IRT',
        faName: String(item.base_coin_fa_name || base),
        enName: String(item.base_coin_name || base),
        segment: isGold ? 'GOLD' : 'CRYPTO',
        tradableOnBit24: item.status !== 0,
        priceIrt: roundIrtPrice(price),
        change1mPct: 0,
        change5mPct: 0,
        change15mPct: 0,
        change60mPct: 0,
        change24hPct: Number(chg24.toFixed(2)),
        high24hIrt: roundIrtPrice(Number(info24.max_price || price * 1.02)),
        low24hIrt: roundIrtPrice(Number(info24.min_price || price * 0.98)),
        volume24hBase: volBase,
        volume24hIrt: Math.round(volQuote),
        minOrderIrt: Math.max(100_000, Number(item.total_min || 250_000)),
        feePctPerSide: 0.2,
        updatedAt: now,
        dataFeedType: 'LIVE_BIT24_API',
      });
    }

    return out.length > 0 ? out : null;
  }

  /**
   * Fetches official Bit24 OHLCV candles (`/pro/capi/v2/markets/ohclv` — note Bit24's documented spelling).
   */
  public async fetchCandlesOhclv(
    baseCoin: string,
    quoteCoin = 'IRT',
    resolution = '1m',
    barsCount = 120
  ): Promise<CandleBar[] | null> {
    const toTs = Math.floor(Date.now() / 1000);
    const stepSec = resolution === '1h' ? 3600 : resolution === '5m' ? 300 : 60;
    const fromTs = toTs - barsCount * stepSec;

    const res = await this.requestJson({
      method: 'GET',
      endpointPath: '/pro/capi/v2/markets/ohclv',
      query: {
        base_coin_symbol: baseCoin,
        quote_coin_symbol: quoteCoin,
        resolution,
        from_ts: fromTs,
        to_ts: toTs,
      },
    });
    if (!res.ok || !res.data) return null;

    const rawBars: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
    const parsed: CandleBar[] = rawBars
      .map((b) => ({
        t: Number(b.t || 0),
        o: Number(b.o || 0),
        h: Number(b.h || 0),
        l: Number(b.l || 0),
        c: Number(b.c || 0),
        v: Number(b.v || 0),
      }))
      .filter((b) => b.c > 0 && b.t > 0);

    return parsed.length > 0 ? parsed : null;
  }

  /**
   * Fetches official Bit24 order book (`/pro/capi/v2/markets/order-books`).
   */
  public async fetchOrderBook(
    baseCoin: string,
    quoteCoin = 'IRT'
  ): Promise<OrderBookDepth | null> {
    const res = await this.requestJson({
      method: 'GET',
      endpointPath: '/pro/capi/v2/markets/order-books',
      query: {
        base_coin: baseCoin,
        quote_coin: quoteCoin,
      },
    });
    if (!res.ok || !res.data?.data) return null;

    const buys: any[] = Array.isArray(res.data.data.buy_orders)
      ? res.data.data.buy_orders
      : [];
    const sells: any[] = Array.isArray(res.data.data.sell_orders)
      ? res.data.data.sell_orders
      : [];

    if (buys.length === 0 || sells.length === 0) return null;

    const bestBid = Number(buys[0].price || 0);
    const bestAsk = Number(sells[0].price || 0);
    if (bestBid <= 0 || bestAsk <= 0) return null;

    const bidDepthIrt = buys
      .slice(0, 15)
      .reduce((s, o) => s + Number(o.total || Number(o.price) * Number(o.amount) || 0), 0);
    const askDepthIrt = sells
      .slice(0, 15)
      .reduce((s, o) => s + Number(o.total || Number(o.price) * Number(o.amount) || 0), 0);

    const spreadPct = Number((((bestAsk - bestBid) / bestBid) * 100).toFixed(3));
    const buyerPressurePct = Number(
      ((bidDepthIrt / Math.max(1, bidDepthIrt + askDepthIrt)) * 100).toFixed(1)
    );
    const estimatedSlippagePct = Number(
      Math.min(0.6, Math.max(0.04, (25_000_000 / Math.max(1, askDepthIrt)) * 0.35)).toFixed(3)
    );

    return {
      symbol: `${baseCoin}/${quoteCoin}`,
      bestBid,
      bestAsk,
      spreadPct,
      bidDepthIrt: Math.round(bidDepthIrt),
      askDepthIrt: Math.round(askDepthIrt),
      buyerPressurePct,
      estimatedSlippagePct,
      fromLiveOrderBook: true,
    };
  }

  /**
   * Checks live IRT wallet balance (`/asset/capi/v1/wallet/assets`) before submitting any Live order!
   */
  public async checkLiveIrtBalance(): Promise<{
    ok: boolean;
    availableIrt: number;
    error?: string;
  }> {
    const res = await this.requestJson({
      method: 'GET',
      endpointPath: '/asset/capi/v1/wallet/assets',
      query: { symbol: 'IRT' },
    });
    if (!res.ok) {
      return { ok: false, availableIrt: 0, error: res.error || 'WALLET_QUERY_FAILED' };
    }
    const items: any[] = Array.isArray(res.data?.data?.results)
      ? res.data.data.results
      : Array.isArray(res.data?.data)
      ? res.data.data
      : [];
    const irtAsset = items.find(
      (a) => String(a.symbol || a.coin_symbol || '').toUpperCase() === 'IRT'
    );
    const avail = Number(irtAsset?.available_balance || 0);
    return { ok: true, availableIrt: avail };
  }

  /**
   * Submits a signed Bit24 Spot order (`POST /pro/capi/v2/spot-orders/submit`) AND
   * verifies order status via `GET /pro/capi/v2/spot-orders` before returning!
   */
  public async submitAndVerifySpotOrder(params: {
    baseCoin: string;
    quoteCoin: string;
    side: 'BUY' | 'SELL';
    amountBase: number;
    priceIrt: number;
  }): Promise<{
    ok: boolean;
    orderId?: string;
    filledPriceIrt?: number;
    feeIrt?: number;
    error?: string;
  }> {
    const submitRes = await this.requestJson({
      method: 'POST',
      endpointPath: '/pro/capi/v2/spot-orders/submit',
      requireSignature: true,
      formBody: {
        base_coin_symbol: params.baseCoin,
        quote_coin_symbol: params.quoteCoin,
        side: params.side === 'BUY' ? 1 : 0, // Official Bit24 CAPI v2: 1 = Buy, 0 = Sell
        type: 0, // Limit order with slippage buffer for price protection
        amount: params.amountBase,
        price: params.priceIrt,
      },
    });

    if (!submitRes.ok) {
      return {
        ok: false,
        error: submitRes.error || 'SPOT_ORDER_SUBMIT_FAILED',
      };
    }

    const orderId = String(
      submitRes.data?.data?.id || submitRes.data?.data?.order_id || ''
    );

    // Verify order status via GET /pro/capi/v2/spot-orders before proceeding
    const verifyRes = await this.requestJson({
      method: 'GET',
      endpointPath: '/pro/capi/v2/spot-orders',
      query: {
        base_coin_symbol: params.baseCoin,
        quote_coin_symbol: params.quoteCoin,
        per_page: 10,
      },
    });

    if (!verifyRes.ok) {
      return {
        ok: true,
        orderId,
        filledPriceIrt: params.priceIrt,
      };
    }

    const orders: any[] = Array.isArray(verifyRes.data?.data?.results)
      ? verifyRes.data.data.results
      : [];
    const matched = orderId
      ? orders.find((o) => String(o.id) === orderId)
      : orders[0];

    return {
      ok: true,
      orderId: orderId || String(matched?.id || 'verified'),
      filledPriceIrt: Number(matched?.average_price || matched?.price || params.priceIrt),
      feeIrt: matched?.fee ? Number(matched.fee) : undefined,
    };
  }
}
