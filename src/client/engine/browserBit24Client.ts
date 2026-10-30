import { buildOrderBookSnapshot } from '../../core/indicators';
import { BIT24_MEME_SYMBOLS, isMemeCoinSymbol } from '../../core/memeAnalyzer';
import {
  Bit24MarketInfo,
  OhlcvCandle,
  OrderBookLevel,
  OrderBookSnapshot,
  QuoteCurrency,
} from '../../shared/types';

const DEFAULT_BIT24_BASE_URL = 'https://rest.bit24.cash';
const SAFE_BROWSER_RATE_LIMIT_PER_MIN = 210;

export class BrowserSecurityForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserSecurityForbiddenError';
  }
}

/**
 * Computes exact hex HMAC-SHA256 signature in browser using WebCrypto API.
 * Matches PHP `hash_hmac('sha256', $params, $secret)` from Bit24 official docs byte-for-byte.
 */
export async function signBit24ParamsBrowser(
  paramsString: string,
  secretKey: string
): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(paramsString));
  const bytes = new Uint8Array(sigBuf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function assertBrowserNoWithdraw(endpointPath: string): void {
  if (endpointPath.toLowerCase().includes('withdraw')) {
    throw new BrowserSecurityForbiddenError(
      'مسدودسازی امنیتی قطعی: عملیات برداشت وجه از طریق API در ربات وب به‌طور کامل ممنوع است.'
    );
  }
}

export class BrowserBit24OfficialClient {
  private reqTimestamps: number[] = [];
  private baseUrl: string = DEFAULT_BIT24_BASE_URL;

  public setBaseUrl(customProxyOrBaseUrl?: string): void {
    const cleaned = (customProxyOrBaseUrl || '').trim().replace(/\/+$/, '');
    this.baseUrl = cleaned.length > 0 ? cleaned : DEFAULT_BIT24_BASE_URL;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getRateLimitUsedLastMinute(): number {
    const cutoff = Date.now() - 60_000;
    this.reqTimestamps = this.reqTimestamps.filter((ts) => ts >= cutoff);
    return this.reqTimestamps.length;
  }

  private async request<T>(options: {
    method: 'GET' | 'POST';
    path: string;
    apiKey: string;
    secretKey?: string;
    requiresSignature?: boolean;
    params?: Record<string, string | number | undefined>;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    status: number;
    latencyMs: number;
    corsBlocked?: boolean;
    data?: T;
    errorFa?: string;
  }> {
    assertBrowserNoWithdraw(options.path);

    if (this.getRateLimitUsedLastMinute() >= SAFE_BROWSER_RATE_LIMIT_PER_MIN) {
      return {
        ok: false,
        status: 429,
        latencyMs: 0,
        errorFa: 'محافظ سقف ۲۵۰ درخواست در دقیقه بیت‌۲۴ فعال شد؛ چند ثانیه صبر کنید.',
      };
    }

    const searchParams = new URLSearchParams();
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) {
        if (v !== undefined && v !== null && v !== '') {
          searchParams.append(k, String(v));
        }
      }
    }

    if (options.requiresSignature) {
      if (!options.secretKey) {
        return {
          ok: false,
          status: 422,
          latencyMs: 0,
          errorFa:
            'برای ثبت یا لغو سفارش واقعی در بیت‌۲۴، وارد کردن کلید اختصاصی (Secret Key) الزامی است.',
        };
      }
      const signature = await signBit24ParamsBrowser(
        searchParams.toString(),
        options.secretKey
      );
      searchParams.append('signature', signature);
    }

    const url =
      options.method === 'GET' && searchParams.toString()
        ? `${this.baseUrl}${options.path}?${searchParams.toString()}`
        : `${this.baseUrl}${options.path}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-BIT24-APIKEY': options.apiKey,
    };
    if (options.method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
    const started = Date.now();
    this.reqTimestamps.push(started);

    try {
      const res = await fetch(url, {
        method: options.method,
        headers,
        body: options.method === 'POST' ? searchParams.toString() : undefined,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      const json: any = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        return {
          ok: false,
          status: res.status,
          latencyMs,
          errorFa:
            json?.error?.message ||
            (res.status === 401
              ? 'کلید API بیت‌۲۴ نامعتبر است یا محدودیت IP روی کلید فعال شده است (در حالت وب، محدودیت IP را خاموش بگذارید یا از پروکسی با IP ثابت استفاده کنید).'
              : `خطای پاسخ بیت‌۲۴ (کد ${res.status})`),
        };
      }

      return {
        ok: true,
        status: res.status,
        latencyMs,
        data: json.data as T,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - started;
      const isAbort = err?.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        latencyMs,
        corsBlocked: !isAbort,
        errorFa: isAbort
          ? 'مهلت پاسخ سرور بیت‌۲۴ به پایان رسید؛ اتصال اینترنت را بررسی کنید.'
          : 'مرورگر به دلیل سیاست امنیتی CORS اجازه ارسال مستقیم هدر X-BIT24-APIKEY را نداد؛ کافی است آدرس Cloudflare Worker رایگان (در فایل راهنما) یا سرور خود را در فیلد «پروکسی ارتباطی» وارد کنید تا ربات وب مستقیماً به بیت‌۲۴ متصل شود.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchMarkets(apiKey: string): Promise<{
    ok: boolean;
    latencyMs: number;
    corsBlocked?: boolean;
    markets: Bit24MarketInfo[];
    errorFa?: string;
  }> {
    const res = await this.request<{ results: any[] }>({
      method: 'GET',
      path: '/pro/capi/v2/markets',
      apiKey,
      params: { page: 1, per_page: 250 },
    });

    if (!res.ok || !Array.isArray(res.data?.results)) {
      return {
        ok: false,
        latencyMs: res.latencyMs,
        corsBlocked: res.corsBlocked,
        markets: [],
        errorFa: res.errorFa,
      };
    }

    const targetSymbols = new Set([
      'PAXG',
      'XAUT',
      'BTC',
      'ETH',
      'SOL',
      'TON',
      'XRP',
      'USDT',
      ...BIT24_MEME_SYMBOLS,
    ]);

    const mapped: Bit24MarketInfo[] = [];
    for (const item of res.data.results) {
      const base = String(item.base_coin?.symbol || '').toUpperCase();
      const quote = String(item.quote_coin?.symbol || '').toUpperCase();
      if (!targetSymbols.has(base) || (quote !== 'IRT' && quote !== 'USDT')) continue;
      if (base === 'USDT' && quote === 'USDT') continue;

      const info24 = item.market_24h_information || {};
      const category =
        base === 'PAXG' || base === 'XAUT'
          ? 'GOLD'
          : isMemeCoinSymbol(base)
            ? 'MEME'
            : 'CRYPTO';

      mapped.push({
        id: Number(item.id || 0),
        marketName: item.market_name || `${base}/${quote}`,
        baseSymbol: base,
        baseFaName: item.base_coin?.fa_name || base,
        quoteSymbol: quote as QuoteCurrency,
        category,
        eachPrice: Number(item.each_price || info24.last_price || 0),
        change24hPct: Number(info24.change_percent || 0),
        volume24hBase: Number(info24.base_volume || 0),
        volume24hQuote: Number(info24.quote_volume || 0),
        high24h: Number(info24.max_price || item.each_price || 0),
        low24h: Number(info24.min_price || item.each_price || 0),
        minOrderQuote: Number(item.total_min || (quote === 'IRT' ? 250_000 : 5)),
        spotActive: Boolean(item.each_price && Number(item.each_price) > 0),
        marginActive: Number(item.margin_order_status?.index) === 1,
        maxLeverage: Number(item.max_leverage || 1),
        hourlyRolloverFeePct: base === 'PAXG' || base === 'XAUT' ? 0.007 : 0.008,
      });
    }

    return {
      ok: true,
      latencyMs: res.latencyMs,
      markets: mapped,
    };
  }

  public async fetchOhlcv(
    apiKey: string,
    baseSymbol: string,
    quoteSymbol: QuoteCurrency,
    resolution = '1h',
    hoursBack = 140
  ): Promise<OhlcvCandle[] | null> {
    const toTs = Math.floor(Date.now() / 1000);
    const fromTs = toTs - hoursBack * 3600;
    const res = await this.request<{ results: any[] }>({
      method: 'GET',
      path: '/pro/capi/v2/markets/ohclv',
      apiKey,
      params: {
        from_ts: fromTs,
        to_ts: toTs,
        base_coin_symbol: baseSymbol,
        quote_coin_symbol: quoteSymbol,
        resolution,
      },
    });
    if (!res.ok || !Array.isArray(res.data?.results) || res.data.results.length === 0) {
      return null;
    }
    return res.data.results.map((r) => ({
      t: Number(r.t),
      o: Number(r.o),
      h: Number(r.h),
      l: Number(r.l),
      c: Number(r.c),
      v: Number(r.v),
    }));
  }

  public async fetchOrderBook(
    apiKey: string,
    baseSymbol: string,
    quoteSymbol: QuoteCurrency,
    targetQuoteSize: number
  ): Promise<OrderBookSnapshot | null> {
    const res = await this.request<{ buy_orders: any[]; sell_orders: any[] }>({
      method: 'GET',
      path: '/pro/capi/v2/markets/order-books',
      apiKey,
      params: {
        base_coin: baseSymbol,
        quote_coin: quoteSymbol,
      },
    });
    if (!res.ok || !res.data) return null;

    const bids: OrderBookLevel[] = (res.data.buy_orders || []).map((b) => ({
      price: Number(b.price),
      amount: Number(b.amount),
      total: Number(b.total),
    }));
    const asks: OrderBookLevel[] = (res.data.sell_orders || []).map((a) => ({
      price: Number(a.price),
      amount: Number(a.amount),
      total: Number(a.total),
    }));

    return buildOrderBookSnapshot(`${baseSymbol}/${quoteSymbol}`, bids, asks, targetQuoteSize);
  }

  public async submitSpotOrder(params: {
    apiKey: string;
    secretKey: string;
    baseSymbol: string;
    quoteSymbol: QuoteCurrency;
    side: 'BUY' | 'SELL';
    orderType: 'LIMIT' | 'MARKET';
    amount: number;
    price?: number;
  }): Promise<{ ok: boolean; orderId?: number; errorFa?: string }> {
    const res = await this.request<{ spot_order?: { id: number } }>({
      method: 'POST',
      path: '/pro/capi/v2/spot-orders/submit',
      apiKey: params.apiKey,
      secretKey: params.secretKey,
      requiresSignature: true,
      params: {
        base_coin_symbol: params.baseSymbol,
        quote_coin_symbol: params.quoteSymbol,
        side: params.side === 'BUY' ? 1 : 0,
        type: params.orderType === 'LIMIT' ? 0 : 1,
        amount: params.amount.toString(),
        price:
          params.orderType === 'LIMIT' && params.price ? params.price.toString() : undefined,
      },
    });
    return {
      ok: res.ok,
      orderId: res.data?.spot_order?.id,
      errorFa: res.errorFa,
    };
  }

  public async cancelSpotOrders(params: {
    apiKey: string;
    secretKey: string;
    orderId?: number;
  }): Promise<{ ok: boolean; errorFa?: string }> {
    const res = await this.request({
      method: 'POST',
      path: '/pro/capi/v2/spot-orders/cancel',
      apiKey: params.apiKey,
      secretKey: params.secretKey,
      requiresSignature: true,
      params: {
        order_id: params.orderId,
      },
    });
    return { ok: res.ok, errorFa: res.errorFa };
  }

  public async submitMarginOrder(params: {
    apiKey: string;
    secretKey: string;
    baseSymbol: string;
    quoteSymbol: QuoteCurrency;
    side: 'LONG' | 'SHORT';
    price: number;
    amount: number;
    leverage: number;
    takeProfit?: number;
    stopLoss?: number;
  }): Promise<{ ok: boolean; orderId?: number; errorFa?: string }> {
    const res = await this.request<{ margin_order?: { id: number } }>({
      method: 'POST',
      path: '/pro/capi/v2/margin-orders/orders/submit',
      apiKey: params.apiKey,
      secretKey: params.secretKey,
      requiresSignature: true,
      params: {
        base_coin_symbol: params.baseSymbol,
        quote_coin_symbol: params.quoteSymbol,
        side: params.side === 'LONG' ? 1 : 0,
        type: 0,
        price: params.price,
        amount: params.amount,
        leverage: params.leverage,
        take_profit: params.takeProfit,
        stop_loss: params.stopLoss,
      },
    });
    return {
      ok: res.ok,
      orderId: res.data?.margin_order?.id,
      errorFa: res.errorFa,
    };
  }

  public async cancelAllMarginOrders(params: {
    apiKey: string;
    secretKey: string;
  }): Promise<{ ok: boolean; errorFa?: string }> {
    const res = await this.request({
      method: 'POST',
      path: '/pro/capi/v2/margin-orders/orders/cancel',
      apiKey: params.apiKey,
      secretKey: params.secretKey,
      requiresSignature: true,
      params: {},
    });
    return { ok: res.ok, errorFa: res.errorFa };
  }
}
