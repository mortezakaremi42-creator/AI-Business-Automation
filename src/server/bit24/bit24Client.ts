import crypto from 'node:crypto';
import {
  Bit24MarketInfo,
  ExchangeErrorCategory,
  OhlcvCandle,
  OrderBookLevel,
  OrderBookSnapshot,
  QuoteCurrency,
  VerifiedWalletAssetItem,
  VerifiedWalletBalance,
} from '../../shared/types.js';
import { buildOrderBookSnapshot } from '../../core/indicators.js';
import { BIT24_MEME_SYMBOLS, isMemeCoinSymbol } from '../../core/memeAnalyzer.js';

const BIT24_BASE_URL = 'https://rest.bit24.cash';
const SAFE_RATE_LIMIT_PER_MIN = 210; // Official Bit24 limit is 250 req/min

export class SecurityForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityForbiddenError';
  }
}

export interface Bit24ApiCallResult<T> {
  ok: boolean;
  status: number;
  latencyMs: number;
  errorCategory: ExchangeErrorCategory;
  data?: T;
  errorFa?: string;
}

export class Bit24OfficialClient {
  private requestTimestamps: number[] = [];

  public getRateLimitUsedLastMinute(): number {
    const cutoff = Date.now() - 60_000;
    this.requestTimestamps = this.requestTimestamps.filter((ts) => ts >= cutoff);
    return this.requestTimestamps.length;
  }

  /**
   * Computes official Bit24 HMAC-SHA256 signature over query/body parameters.
   * Reference: https://docs.bit24.cash/#section/احراز-هویت
   */
  public static signParameters(paramsString: string, secretKey: string): string {
    return crypto.createHmac('sha256', secretKey).update(paramsString).digest('hex');
  }

  /**
   * HARD SECURITY INVARIANT:
   * Blocks any call containing `withdraw` so no funds can EVER be withdrawn via API.
   */
  public static assertNoWithdrawalPath(endpointPath: string): void {
    const normalized = endpointPath.toLowerCase();
    if (normalized.includes('withdraw')) {
      throw new SecurityForbiddenError(
        'مسدودسازی امنیتی قطعی: عملیات برداشت وجه از طریق API در این پلتفرم به‌طور کامل ممنوع و غیرفعال است.'
      );
    }
  }

  private async request<T>(options: {
    method: 'GET' | 'POST';
    path: string;
    apiKey: string;
    secretKey?: string;
    requiresSignature?: boolean;
    params?: Record<string, string | number | undefined>;
    timeoutMs?: number;
  }): Promise<Bit24ApiCallResult<T>> {
    Bit24OfficialClient.assertNoWithdrawalPath(options.path);

    if (this.getRateLimitUsedLastMinute() >= SAFE_RATE_LIMIT_PER_MIN) {
      return {
        ok: false,
        status: 429,
        latencyMs: 0,
        errorCategory: 'RATE_LIMIT_ERROR',
        errorFa: 'کنترل نرخ درخواست داخلی فعال شد (محافظت از سقف ۲۵۰ درخواست در دقیقه بیت‌۲۴).',
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
          errorCategory: 'AUTH_OR_IP_ERROR',
          errorFa: 'برای ثبت یا لغو سفارش واقعی، کلید اختصاصی (Secret Key) بیت‌۲۴ الزامی است.',
        };
      }
      const sig = Bit24OfficialClient.signParameters(searchParams.toString(), options.secretKey);
      searchParams.append('signature', sig);
    }

    const url =
      options.method === 'GET' && searchParams.toString()
        ? `${BIT24_BASE_URL}${options.path}?${searchParams.toString()}`
        : `${BIT24_BASE_URL}${options.path}`;

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
    this.requestTimestamps.push(started);

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
        let errorCategory: ExchangeErrorCategory = 'ORDER_REJECTED_BY_EXCHANGE';
        if (res.status === 401 || res.status === 403) {
          errorCategory = 'AUTH_OR_IP_ERROR';
        } else if (res.status === 429) {
          errorCategory = 'RATE_LIMIT_ERROR';
        } else if (res.status >= 500) {
          errorCategory = 'NETWORK_TIMEOUT_OR_OFFLINE';
        }

        return {
          ok: false,
          status: res.status,
          latencyMs,
          errorCategory,
          errorFa:
            json?.error?.message ||
            (res.status === 401 || res.status === 403
              ? 'خطای احراز هویت: کلید API بیت‌۲۴ نامعتبر است یا IP سرور در لیست مجاز (IP Whitelist) قرار ندارد.'
              : res.status === 429
                ? 'محدودیت نرخ درخواست بیت‌۲۴ (HTTP 429)؛ درخواست جدید متوقف شد.'
                : `خطای برگشتی صرافی بیت‌۲۴ (کد ${res.status})`),
        };
      }

      return {
        ok: true,
        status: res.status,
        latencyMs,
        errorCategory: 'NONE',
        data: json.data as T,
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - started,
        errorCategory: 'NETWORK_TIMEOUT_OR_OFFLINE',
        errorFa:
          err?.name === 'AbortError'
            ? 'خطای اتصال شبکه: مهلت زمانی پاسخ سرور بیت‌۲۴ به پایان رسید (سفارش تایید نشده است).'
            : 'خطای اتصال شبکه: عدم دسترسی مستقیم به rest.bit24.cash؛ حالت ایمن تحلیل/آزمایشی فعال است.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GET /pro/capi/v2/markets
   */
  public async fetchMarkets(apiKey: string): Promise<{
    ok: boolean;
    latencyMs: number;
    errorCategory: ExchangeErrorCategory;
    markets: Bit24MarketInfo[];
    errorFa?: string;
  }> {
    const res = await this.request<{ results: any[] }>({
      method: 'GET',
      path: '/pro/capi/v2/markets',
      apiKey,
      params: { page: 1, per_page: 250 },
    });

    if (!res.ok || !res.data?.results) {
      return {
        ok: false,
        latencyMs: res.latencyMs,
        errorCategory: res.errorCategory,
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
        dataSource: 'BIT24_OFFICIAL_API',
      });
    }

    return {
      ok: true,
      latencyMs: res.latencyMs,
      errorCategory: 'NONE',
      markets: mapped,
    };
  }

  /**
   * GET /pro/capi/v2/markets/ohclv (official Bit24 spelling: ohclv)
   */
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

  /**
   * GET /pro/capi/v2/markets/order-books
   */
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

    return buildOrderBookSnapshot(
      `${baseSymbol}/${quoteSymbol}`,
      bids,
      asks,
      targetQuoteSize,
      true
    );
  }

  /**
   * Verified Wallet Balance:
   * GET /asset/capi/v1/wallet/assets/total + GET /asset/capi/v1/wallet/assets
   * Returns confirmedByOfficialApi = true ONLY when Bit24 responds with HTTP 200 & success: true!
   */
  public async fetchVerifiedWalletBalance(apiKey: string): Promise<VerifiedWalletBalance> {
    const [totalRes, assetsRes] = await Promise.all([
      this.request<{ assets: any }>({
        method: 'GET',
        path: '/asset/capi/v1/wallet/assets/total',
        apiKey,
      }),
      this.request<{ results?: any[] }>({
        method: 'GET',
        path: '/asset/capi/v1/wallet/assets',
        apiKey,
        params: { page: 1, per_page: 50 },
      }),
    ]);

    if (!totalRes.ok || !totalRes.data?.assets) {
      return {
        confirmedByOfficialApi: false,
        totalIrt: null,
        totalUsdt: null,
        spotFreeIrt: null,
        spotFreeUsdt: null,
        assets: [],
        fetchedAt: null,
        noteFa:
          totalRes.errorFa ||
          'موجودی واقعی حساب هنوز از API رسمی بیت‌۲۴ تأیید نشده است؛ ارقام آزمایشی جداگانه نمایش داده می‌شوند.',
      };
    }

    const mappedAssets: VerifiedWalletAssetItem[] = [];
    let spotFreeIrt: number | null = null;
    let spotFreeUsdt: number | null = null;

    if (assetsRes.ok && Array.isArray(assetsRes.data?.results)) {
      for (const a of assetsRes.data.results) {
        const sym = String(a.coin?.symbol || a.symbol || '').toUpperCase();
        const avail = Number(a.available_balance || 0);
        const inOrd = Number(a.in_orders || 0);
        const balIrt = Number(a.balance_irt || 0);
        const balUsdt = Number(a.balance_usdt || 0);
        if (sym === 'IRT') spotFreeIrt = avail;
        if (sym === 'USDT') spotFreeUsdt = avail;
        if (avail > 0 || inOrd > 0 || balIrt > 10_000) {
          mappedAssets.push({
            symbol: sym,
            faName: a.coin?.fa_name || sym,
            available: avail,
            inOrders: inOrd,
            balanceIrt: balIrt,
            balanceUsdt: balUsdt,
          });
        }
      }
    }

    const totalIrt = Number(totalRes.data.assets?.total_assets?.irt ?? 0);
    const totalUsdt = Number(totalRes.data.assets?.total_assets?.usdt ?? 0);

    return {
      confirmedByOfficialApi: true,
      totalIrt,
      totalUsdt,
      spotFreeIrt,
      spotFreeUsdt,
      assets: mappedAssets,
      fetchedAt: Date.now(),
      noteFa: 'موجودی واقعی کیف پول مستقیماً از API رسمی بیت‌۲۴ دریافت و تأیید شد.',
    };
  }

  /**
   * GET /pro/capi/v2/spot-orders — Official order status verification!
   */
  public async fetchSpotOrders(
    apiKey: string,
    baseSymbol?: string,
    quoteSymbol?: QuoteCurrency
  ): Promise<{
    ok: boolean;
    orders: { id: number; status: number; filledPercent: number; symbol: string }[];
    errorFa?: string;
  }> {
    const res = await this.request<{ results?: any[] }>({
      method: 'GET',
      path: '/pro/capi/v2/spot-orders',
      apiKey,
      params: {
        page: 1,
        per_page: 25,
        base_coin_symbol: baseSymbol,
        quote_coin_symbol: quoteSymbol,
      },
    });
    if (!res.ok || !Array.isArray(res.data?.results)) {
      return { ok: false, orders: [], errorFa: res.errorFa };
    }
    return {
      ok: true,
      orders: res.data.results.map((o) => ({
        id: Number(o.id || 0),
        status: Number(o.status?.index ?? o.status ?? 0),
        filledPercent: Number(o.filled_percent || 0),
        symbol: String(o.market_name || ''),
      })),
    };
  }

  /**
   * POST /pro/capi/v2/spot-orders/submit
   * NEVER reports `ok: true` unless Bit24 returns HTTP 200, `success: true`, AND a valid numeric `spot_order.id`!
   */
  public async submitSpotOrder(params: {
    apiKey: string;
    secretKey: string;
    baseSymbol: string;
    quoteSymbol: QuoteCurrency;
    side: 'BUY' | 'SELL';
    orderType: 'LIMIT' | 'MARKET';
    amount: number;
    price?: number;
  }): Promise<{
    ok: boolean;
    orderId?: number;
    errorCategory: ExchangeErrorCategory;
    errorFa?: string;
  }> {
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
        price: params.orderType === 'LIMIT' && params.price ? params.price.toString() : undefined,
      },
    });

    const confirmedId = Number(res.data?.spot_order?.id || 0);
    if (!res.ok || confirmedId <= 0) {
      return {
        ok: false,
        errorCategory: res.ok ? 'ORDER_REJECTED_BY_EXCHANGE' : res.errorCategory,
        errorFa:
          res.errorFa ||
          'پاسخ صرافی فاقد شناسه سفارش تاییدشده (order_id) بود؛ طبق قانون ایمنی، سفارش موفق تلقی نشد.',
      };
    }

    return {
      ok: true,
      orderId: confirmedId,
      errorCategory: 'NONE',
    };
  }

  /**
   * POST /pro/capi/v2/spot-orders/cancel
   */
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

  /**
   * POST /pro/capi/v2/margin-orders/orders/submit
   */
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
  }): Promise<{
    ok: boolean;
    orderId?: number;
    errorCategory: ExchangeErrorCategory;
    errorFa?: string;
  }> {
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

    const confirmedId = Number(res.data?.margin_order?.id || 0);
    if (!res.ok || confirmedId <= 0) {
      return {
        ok: false,
        errorCategory: res.ok ? 'ORDER_REJECTED_BY_EXCHANGE' : res.errorCategory,
        errorFa:
          res.errorFa || 'پاسخ مارجین صرافی فاقد شناسه سفارش تاییدشده بود.',
      };
    }

    return {
      ok: true,
      orderId: confirmedId,
      errorCategory: 'NONE',
    };
  }

  /**
   * POST /pro/capi/v2/margin-orders/orders/cancel
   */
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
