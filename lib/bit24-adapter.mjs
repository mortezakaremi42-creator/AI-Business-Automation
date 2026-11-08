/**
 * Fail-closed Bit24 spot adapter boundary.
 * Bit24 endpoint paths, signature rules and IOC support must be implemented against
 * the exchange's current official documentation before a real order is possible.
 * This module deliberately does not invent an endpoint or submit a request.
 */
export class LiveTradingUnavailableError extends Error {
  constructor(message = 'Live trading is disabled until the official Bit24 API contract is verified and configured.') {
    super(message); this.name = 'LiveTradingUnavailableError'; this.statusCode = 503;
  }
}

export function assertSpotOnlyPermissions(permissions) {
  if (!Array.isArray(permissions) || !permissions.includes('spotTrade')) {
    throw new Error('API key must have explicit Spot Trade permission.');
  }
  if (permissions.some((permission) => /withdraw|transfer|margin|futures/i.test(permission))) {
    throw new Error('API key contains a prohibited permission; use Spot Trade only.');
  }
  return true;
}

/**
 * Retries safe/idempotent quote reads, honoring Retry-After and aborting on timeout.
 * Do not use this helper to blindly retry order submissions (duplicate order risk).
 */
export async function fetchWithTimeoutAndRetry(url, options = {}, {
  timeoutMs = 4_000, maxAttempts = 3, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
    throw new Error('Retry helper only accepts idempotent GET/HEAD requests.');
  }
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Network timeout')), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === maxAttempts) return response;
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : Math.min(250 * (2 ** (attempt - 1)), 4_000);
        await sleep(waitMs);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleep(Math.min(250 * (2 ** (attempt - 1)), 4_000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('Network request failed.');
}

/** Validate the live price against a signal/reference price before an IOC-limit order. */
export function enforceSlippageCap({ side, referencePrice, liveQuote, maxSlippage = 0.003 }) {
  for (const [name, value] of Object.entries({ referencePrice, liveQuote, maxSlippage })) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive and finite.`);
  }
  if (!['BUY', 'SELL'].includes(side)) throw new TypeError('Side must be BUY or SELL.');
  const deviation = Math.abs(liveQuote - referencePrice) / referencePrice;
  if (deviation > maxSlippage + 1e-12) throw new Error(`Quote moved ${(deviation * 100).toFixed(4)}%; exceeding the ${(maxSlippage * 100).toFixed(2)}% slippage cap. Order cancelled.`);
  const limitPrice = side === 'BUY' ? referencePrice * (1 + maxSlippage) : referencePrice * (1 - maxSlippage);
  return { limitPrice, deviation, timeInForce: 'IOC' };
}

/**
 * Inject a verified, test-covered transport once official Bit24 docs are supplied.
 * No credentials are accepted by the browser; these remain server-side only.
 */
export class Bit24SpotAdapter {
  constructor({ apiKey, secretKey, transport = null, permissions = [] } = {}) {
    if (!apiKey || !secretKey) throw new LiveTradingUnavailableError('Set API_KEY and SECRET_KEY in the server secret store; never in the frontend.');
    assertSpotOnlyPermissions(permissions);
    if (!transport || typeof transport.getQuote !== 'function' || typeof transport.placeIocLimit !== 'function' || typeof transport.cancelAll !== 'function' || typeof transport.getSpotPositions !== 'function') {
      throw new LiveTradingUnavailableError('A Bit24 transport matching verified official API documentation is not configured.');
    }
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.transport = transport;
  }

  async placeProtectedOrder({ symbol, side, quantity, referencePrice }) {
    const quote = await this.transport.getQuote(symbol); // read only; retry with timeout policy in transport
    const reference = side === 'BUY' ? quote.ask : quote.bid;
    const { limitPrice } = enforceSlippageCap({ side, referencePrice, liveQuote: reference });
    // IOC-limit bounds worst price and prevents an unfilled remainder remaining pending.
    return this.transport.placeIocLimit({ symbol, side, quantity, limitPrice, timeInForce: 'IOC' });
  }

  async panicFlatten() {
    // Best-effort emergency sequence: attempt cancellation, then attempt every
    // free-spot liquidation independently so one failure does not skip later assets.
    const results = [];
    const errors = [];
    try { await this.transport.cancelAll(); }
    catch (error) { errors.push({ step: 'cancelAll', error: error.message }); }
    let positions = [];
    try { positions = await this.transport.getSpotPositions(); }
    catch (error) { errors.push({ step: 'getSpotPositions', error: error.message }); }
    for (const position of positions) {
      if (!(position.freeQuantity > 0)) continue;
      try {
        const order = await this.placeProtectedOrder({ symbol: position.symbol, side: 'SELL', quantity: position.freeQuantity, referencePrice: position.referencePrice });
        results.push({ symbol: position.symbol, order });
      } catch (error) { errors.push({ step: 'sell', symbol: position.symbol, quantity: position.freeQuantity, error: error.message }); }
    }
    return { results, errors, complete: errors.length === 0 };
  }
}
