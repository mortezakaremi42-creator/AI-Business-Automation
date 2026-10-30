import { LiveExchangeAdapter } from '../../core/platformRuntime.js';
import { ModuleId, VerifiedWalletBalance } from '../../shared/types.js';
import { Bit24OfficialClient } from '../bit24/bit24Client.js';
import { Bit24CredentialVault } from '../bit24/credentialVault.js';

export class ServerBit24Adapter implements LiveExchangeAdapter {
  constructor(
    public readonly vault: Bit24CredentialVault,
    public readonly client: Bit24OfficialClient
  ) {}

  isConfigured(): boolean {
    return this.vault.isConfigured();
  }

  getMaskedKey(): string | null {
    return this.vault.getMaskedKey();
  }

  getRateLimitUsed(): number {
    return this.client.getRateLimitUsedLastMinute();
  }

  redactText(text: string): string {
    return this.vault.redactSensitiveText(text);
  }

  async fetchLiveMarkets() {
    const creds = this.vault.getCredentials();
    if (!creds) {
      return {
        ok: false,
        latencyMs: 0,
        errorCategory: 'AUTH_OR_IP_ERROR' as const,
        markets: [],
        errorFa: 'کلید API تنظیم نشده است.',
      };
    }
    return this.client.fetchMarkets(creds.apiKey);
  }

  async fetchVerifiedWallet(): Promise<VerifiedWalletBalance> {
    const creds = this.vault.getCredentials();
    if (!creds) {
      return {
        confirmedByOfficialApi: false,
        totalIrt: null,
        totalUsdt: null,
        spotFreeIrt: null,
        spotFreeUsdt: null,
        assets: [],
        fetchedAt: null,
        noteFa: 'کلید API بیت‌۲۴ تنظیم نشده است؛ موجودی واقعی حساب نمایش داده نمی‌شود.',
      };
    }
    return this.client.fetchVerifiedWalletBalance(creds.apiKey);
  }

  async fetchOhlcv(baseSymbol: string, quoteSymbol: 'IRT' | 'USDT') {
    const creds = this.vault.getCredentials();
    if (!creds) return null;
    return this.client.fetchOhlcv(creds.apiKey, baseSymbol, quoteSymbol, '1h', 140);
  }

  async fetchOrderBook(
    baseSymbol: string,
    quoteSymbol: 'IRT' | 'USDT',
    targetQuoteSize: number
  ) {
    const creds = this.vault.getCredentials();
    if (!creds) return null;
    return this.client.fetchOrderBook(creds.apiKey, baseSymbol, quoteSymbol, targetQuoteSize);
  }

  async verifyOrderStatus(
    orderId: number,
    baseSymbol: string,
    quoteSymbol: 'IRT' | 'USDT'
  ): Promise<{ verified: boolean; filledPercent: number }> {
    const creds = this.vault.getCredentials();
    if (!creds || orderId <= 0) return { verified: false, filledPercent: 0 };
    const list = await this.client.fetchSpotOrders(creds.apiKey, baseSymbol, quoteSymbol);
    if (!list.ok) return { verified: false, filledPercent: 0 };
    const found = list.orders.find((o) => o.id === orderId);
    return {
      verified: Boolean(found),
      filledPercent: found?.filledPercent ?? 0,
    };
  }

  async submitLiveOrder(params: {
    module: ModuleId;
    baseSymbol: string;
    quoteSymbol: 'IRT' | 'USDT';
    side: 'LONG' | 'SHORT';
    amount: number;
    price: number;
    leverage: number;
    takeProfit: number;
    stopLoss: number;
  }) {
    const creds = this.vault.getCredentials();
    if (!creds || !creds.secretKey) {
      return {
        ok: false,
        errorCategory: 'AUTH_OR_IP_ERROR' as const,
        errorFa: 'کلید اختصاصی (Secret Key) بیت‌۲۴ برای ثبت سفارش واقعی در سرور تنظیم نشده است.',
      };
    }

    if (params.module === 'LEVERAGE_MARGIN') {
      return this.client.submitMarginOrder({
        apiKey: creds.apiKey,
        secretKey: creds.secretKey,
        baseSymbol: params.baseSymbol,
        quoteSymbol: params.quoteSymbol,
        side: params.side,
        price: params.price,
        amount: params.amount,
        leverage: params.leverage,
        takeProfit: params.takeProfit,
        stopLoss: params.stopLoss,
      });
    }

    return this.client.submitSpotOrder({
      apiKey: creds.apiKey,
      secretKey: creds.secretKey,
      baseSymbol: params.baseSymbol,
      quoteSymbol: params.quoteSymbol,
      side: 'BUY',
      orderType: 'LIMIT',
      amount: params.amount,
      price: params.price,
    });
  }

  async cancelAllOpenOrders() {
    const creds = this.vault.getCredentials();
    if (!creds || !creds.secretKey) {
      return { ok: false, errorFa: 'کلید اختصاصی برای لغو سفارش‌های باز تنظیم نشده است.' };
    }
    const spot = await this.client.cancelSpotOrders({
      apiKey: creds.apiKey,
      secretKey: creds.secretKey,
    });
    await this.client.cancelAllMarginOrders({
      apiKey: creds.apiKey,
      secretKey: creds.secretKey,
    });
    return spot;
  }

  async liquidateSpotAsset(params: {
    baseSymbol: string;
    quoteSymbol: 'IRT' | 'USDT';
    amount: number;
  }) {
    const creds = this.vault.getCredentials();
    if (!creds || !creds.secretKey) {
      return { ok: false, errorFa: 'کلید اختصاصی تنظیم نشده است.' };
    }
    return this.client.submitSpotOrder({
      apiKey: creds.apiKey,
      secretKey: creds.secretKey,
      baseSymbol: params.baseSymbol,
      quoteSymbol: params.quoteSymbol,
      side: 'SELL',
      orderType: 'MARKET',
      amount: params.amount,
    });
  }
}
