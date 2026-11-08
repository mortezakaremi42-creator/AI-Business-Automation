import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperTradingEngine } from '../lib/trading-engine.mjs';
import { calculateMacd, calculateRsi } from '../lib/indicators.mjs';
import { assertSpotOnlyPermissions, enforceSlippageCap, Bit24SpotAdapter, fetchWithTimeoutAndRetry } from '../lib/bit24-adapter.mjs';

const makeEngine = (options = {}) => {
  let time = Date.UTC(2026, 0, 1, 12);
  const engine = new PaperTradingEngine({ startingCash: 10_000, now: () => time, ...options });
  return { engine, setTime: (value) => { time = value; }, now: () => time };
};

test('closed-trade statistics include winning and losing exits, not open positions', () => {
  const { engine } = makeEngine();
  engine.start();
  const winner = engine.openLong({ symbol: 'BTC/USDT', quantity: 1, price: 100 });
  engine.closePosition(winner.id, 110);
  const loser = engine.openLong({ symbol: 'ETH/USDT', quantity: 1, price: 100 });
  engine.closePosition(loser.id, 90);
  engine.openLong({ symbol: 'SOL/USDT', quantity: 1, price: 100 });
  assert.equal(engine.stats.closedTrades, 2);
  assert.equal(engine.stats.winningTrades, 1);
  assert.equal(engine.stats.losingTrades, 1);
  assert.equal(engine.stats.winRate, 50);
  assert.equal(engine.positions.size, 1);
  assert.equal(engine.stats.netProfit, -0.8);
});

test('demo deposits and withdrawals do not alter daily trading drawdown', () => {
  const { engine } = makeEngine();
  engine.adjustPaperCash({ direction: 'deposit', amount: 500 });
  assert.equal(engine.stats.dailyPnl, 0);
  engine.adjustPaperCash({ direction: 'withdraw', amount: 200 });
  assert.equal(engine.stats.dailyPnl, 0);
  assert.equal(engine.stats.cash, 10_300);
});

test('small orders retain sub-cent fee precision', () => {
  const { engine } = makeEngine();
  engine.start();
  const p = engine.openLong({ symbol: 'BTC/USDT', quantity: 0.001, price: 100 });
  assert.equal(p.entryFee, 0.0002);
  const trade = engine.closePosition(p.id, 100);
  assert.equal(trade.fees, 0.0004);
  assert.equal(trade.netPnl, -0.0004);
});

test('charges a 0.20% fee on entry and actual exit notional; net break-even loss is 0.4%', () => {
  const { engine } = makeEngine();
  engine.start();
  const p = engine.openLong({ symbol: 'BTC/USDT', quantity: 1, price: 100 });
  const trade = engine.closePosition(p.id, 100);
  assert.equal(trade.grossPnl, 0);
  assert.equal(trade.fees, 0.4);
  assert.equal(trade.netPnl, -0.4);
  assert.equal(engine.stats.winRate, 0);
});

test('realized partial exits count toward net profit before the remaining position closes', () => {
  const { engine } = makeEngine();
  engine.start();
  engine.openLong({ symbol: 'BTC/USDT', quantity: 1, price: 100 });
  engine.onPrice('BTC/USDT', 110);
  assert.equal(engine.stats.closedTrades, 0);
  assert.ok(engine.stats.netProfit > 0);
  assert.ok(engine.positions.size === 1);
});

test('two take-profit tiers sell 30% of original quantity each; trailing stop closes the remainder', () => {
  const { engine } = makeEngine();
  engine.start();
  const p = engine.openLong({ symbol: 'BTC/USDT', quantity: 1, price: 100 });
  const first = engine.onPrice('BTC/USDT', 110);
  assert.equal(first.events.filter((e) => e.type === 'PARTIAL_TAKE_PROFIT').length, 1);
  assert.equal(engine.positions.get(p.id).remainingQty, 0.7);
  engine.onPrice('BTC/USDT', 120);
  assert.ok(Math.abs(engine.positions.get(p.id).remainingQty - 0.4) < 1e-10);
  const exit = engine.onPrice('BTC/USDT', 116);
  assert.equal(exit.events.some((e) => e.reason === 'TRAILING_STOP'), true);
  assert.equal(engine.positions.size, 0);
  assert.equal(engine.closedTrades[0].reason, 'TRAILING_STOP');
});

test('hard protective stop closes a losing spot position', () => {
  const { engine } = makeEngine();
  engine.start();
  engine.openLong({ symbol: 'BTC/USDT', quantity: 1, price: 100 });
  const result = engine.onPrice('BTC/USDT', 94.9);
  assert.equal(result.events.some((e) => e.reason === 'PROTECTIVE_STOP'), true);
  assert.equal(engine.positions.size, 0);
  assert.equal(engine.stats.closedTrades, 1);
});

test('daily equity drawdown at 3% stops, liquidates paper positions and locks for 24 hours', () => {
  const { engine, now, setTime } = makeEngine({ startingCash: 100_000 });
  engine.start();
  engine.openLong({ symbol: 'BTC/USDT', quantity: 80, price: 1_000 });
  engine.openLong({ symbol: 'ETH/USDT', quantity: 10, price: 1_000 });
  const result = engine.onPrice('BTC/USDT', 949);
  assert.equal(result.events.some((e) => e.type === 'DAILY_DRAWDOWN_CUTOFF'), true);
  assert.equal(engine.running, false);
  assert.equal(engine.positions.size, 0);
  assert.equal(engine.pausedUntil, now() + 86_400_000);
  assert.throws(() => engine.start(), /lockout/i);
  setTime(now() + 86_400_001);
  engine.start();
  assert.equal(engine.running, true);
  assert.equal(engine.pausedUntil, null);
});

test('panic stop cancels pending demo orders, closes all positions and latches engine', () => {
  const { engine } = makeEngine();
  engine.start();
  engine.openLong({ symbol: 'BTC/USDT', quantity: 1, price: 100 });
  engine.pendingOrders.set('pending-1', { id: 'pending-1' });
  const result = engine.panicStop();
  assert.equal(result.cancelledOrders, 1);
  assert.equal(result.closed.length, 1);
  assert.equal(engine.positions.size, 0);
  assert.equal(engine.running, false);
  assert.equal(engine.killLatched, true);
  assert.throws(() => engine.start(), /latched/i);
});

test('orders beyond 0.3% slippage are rejected', () => {
  const { engine } = makeEngine();
  engine.start();
  assert.throws(() => engine.openLong({ symbol: 'BTC/USDT', quantity: 1, price: 100.31, referencePrice: 100 }), /slippage/i);
  assert.doesNotThrow(() => engine.openLong({ symbol: 'ETH/USDT', quantity: 1, price: 100.3, referencePrice: 100, manual: true }));
  const protectedQuote = enforceSlippageCap({ side: 'BUY', referencePrice: 100, liveQuote: 100.2 });
  assert.ok(Math.abs(protectedQuote.limitPrice - 100.3) < 1e-10);
  assert.equal(protectedQuote.timeInForce, 'IOC');
  assert.throws(() => enforceSlippageCap({ side: 'SELL', referencePrice: 100, liveQuote: 99.69 }), /cancelled/i);
});

test('indicator functions reject open candles and produce RSI/MACD from closed candles', () => {
  const candles = Array.from({ length: 40 }, (_, i) => ({ close: 100 + i * i, closed: true }));
  assert.equal(calculateRsi(candles), 100);
  assert.ok(calculateMacd(candles).histogram > 0);
  assert.throws(() => calculateRsi([...candles.slice(0, -1), { close: 140, closed: false }]), /not confirmed closed/i);
});

test('permission validation enforces spot-only and blocks withdraw privileges', () => {
  assert.equal(assertSpotOnlyPermissions(['spotTrade']), true);
  assert.throws(() => assertSpotOnlyPermissions(['spotTrade', 'withdraw']), /prohibited/i);
  assert.throws(() => assertSpotOnlyPermissions(['read']), /Spot Trade/i);
});

test('safe quote reads retry rate limits, while order submissions cannot use retry helper', async () => {
  let calls = 0, sleeps = 0;
  const fetchImpl = async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '1' } }) : new Response('ok', { status: 200 });
  };
  const response = await fetchWithTimeoutAndRetry('https://api.example.test/quote', {}, { fetchImpl, sleep: async () => { sleeps++; } });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
  await assert.rejects(fetchWithTimeoutAndRetry('https://api.example.test/order', { method: 'POST' }), /idempotent/i);
});

test('panic adapter attempts all liquidations even if cancellation and one sale fail', async () => {
  const sold = [];
  const transport = {
    async cancelAll() { throw new Error('cancel endpoint error'); },
    async getSpotPositions() { return [
      { symbol: 'AAA/USDT', freeQuantity: 1, referencePrice: 100 },
      { symbol: 'BBB/USDT', freeQuantity: 2, referencePrice: 100 },
    ]; },
    async getQuote() { return { bid: 100, ask: 100 }; },
    async placeIocLimit(order) { sold.push(order.symbol); if (order.symbol === 'AAA/USDT') throw new Error('venue rejected'); return { id: 'demo-order' }; },
  };
  const adapter = new Bit24SpotAdapter({ apiKey: 'test-only', secretKey: 'test-only', permissions: ['spotTrade'], transport });
  const result = await adapter.panicFlatten();
  assert.deepEqual(sold, ['AAA/USDT', 'BBB/USDT']);
  assert.equal(result.errors.length, 2);
  assert.equal(result.complete, false);
  assert.equal(result.results.length, 1);
});
