import { randomUUID } from 'node:crypto';

const FEE_PER_SIDE = 0.002; // 0.20% per fill: 0.40% for a same-notional round trip.
// Preserve asset/quote precision (USDT and crypto fees routinely need >2 decimals).
const money = (value) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const assertPositive = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number.`);
};

/**
 * Deterministic spot-only paper execution engine. No exchange side effects.
 * Prices are quote-currency units; quantity is base-asset units.
 */
export class PaperTradingEngine {
  constructor({ startingCash = 10_000, feePerSide = FEE_PER_SIDE, dailyLossLimit = 0.03, hardStop = 0.05, trailingDistance = 0.03, takeProfitTiers = [{ gain: 0.10, fraction: 0.30 }, { gain: 0.20, fraction: 0.30 }], now = Date.now } = {}) {
    assertPositive(startingCash, 'startingCash');
    this.now = now;
    this.config = { feePerSide, dailyLossLimit, hardStop, trailingDistance, takeProfitTiers: structuredClone(takeProfitTiers) };
    this.cash = money(startingCash);
    this.startingCash = this.cash;
    this.positions = new Map();
    this.closedTrades = [];
    this.pendingOrders = new Map();
    this.running = false;
    this.killLatched = false;
    this.pausedUntil = null;
    this.day = dayKey(this.now());
    this.dayStartEquity = this.cash;
    this.dailyPnl = 0;
    this.dailyCutoffTriggeredAt = null;
  }

  get equity() {
    return money(this.cash + [...this.positions.values()].reduce((sum, p) => sum + p.remainingQty * p.markPrice, 0));
  }

  get unrealizedPnl() {
    return money([...this.positions.values()].reduce((sum, p) => sum + (p.markPrice - p.entryPrice) * p.remainingQty, 0));
  }

  get totalNetProfit() {
    // Include realized partial exits from still-open positions; open-trade unrealized PnL is separate.
    const closed = this.closedTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
    const partialRealized = [...this.positions.values()].reduce((sum, position) => sum + position.realizedNet, 0);
    return money(closed + partialRealized);
  }

  get totalFees() {
    return money(this.closedTrades.reduce((sum, trade) => sum + trade.fees, 0) + [...this.positions.values()].reduce((sum, p) => sum + p.feesPaid, 0));
  }

  get stats() {
    const closed = this.closedTrades.length;
    const winners = this.closedTrades.filter((trade) => trade.netPnl > 0).length;
    return {
      closedTrades: closed,
      winningTrades: winners,
      losingTrades: this.closedTrades.filter((trade) => trade.netPnl < 0).length,
      winRate: closed ? money((winners / closed) * 100) : 0,
      netProfit: this.totalNetProfit,
      fees: this.totalFees,
      dailyPnl: this.dailyPnl,
      dayStartEquity: this.dayStartEquity,
      equity: this.equity,
      cash: this.cash,
      openPositions: this.positions.size,
      botRunning: this.running,
      killLatched: this.killLatched,
      cooldownUntil: this.pausedUntil,
      mode: 'PAPER',
    };
  }

  start() {
    if (this.killLatched) throw new Error('Panic stop is latched; reset it explicitly before starting.');
    const now = this.now();
    if (this.pausedUntil && now < this.pausedUntil) throw new Error(`Daily loss lockout active until ${new Date(this.pausedUntil).toISOString()}.`);
    if (this.pausedUntil && now >= this.pausedUntil) {
      this.pausedUntil = null;
      this.dayStartEquity = this.equity;
      this.dailyPnl = 0;
    }
    this.#rollDay(now);
    this.running = true;
    return this.stats;
  }

  stop() { this.running = false; return this.stats; }

  adjustPaperCash({ direction, amount }) {
    assertPositive(amount, 'amount');
    if (!['deposit', 'withdraw'].includes(direction)) throw new TypeError('Direction must be deposit or withdraw.');
    const delta = direction === 'deposit' ? amount : -amount;
    if (this.cash + delta < 0) throw new Error('Insufficient demo cash.');
    this.cash = money(this.cash + delta);
    // Paper deposits/withdrawals are cash flows, not trading drawdown.
    this.dayStartEquity = money(this.dayStartEquity + delta);
    this.#updateDailyPnl(this.now());
    return this.stats;
  }

  resetPanicLatch() {
    if (this.pausedUntil && this.now() < this.pausedUntil) throw new Error('Daily loss cooldown is still active.');
    this.killLatched = false;
    return this.stats;
  }

  /** Buy spot only; selling is only permitted by reducing an existing long. */
  openLong({ symbol, quantity, price, referencePrice = price, manual = false, now = this.now() }) {
    if (!this.running && !manual) throw new Error('Trading engine is stopped.');
    if (this.killLatched) throw new Error('Panic stop is latched.');
    if (this.pausedUntil && now < this.pausedUntil) throw new Error('Daily loss cooldown is active.');
    if (!/^[A-Z0-9]{2,16}\/[A-Z0-9]{2,16}$/.test(symbol)) throw new TypeError('Symbol must use BASE/QUOTE format.');
    assertPositive(quantity, 'quantity'); assertPositive(price, 'price'); assertPositive(referencePrice, 'referencePrice');
    this.#rollDay(now);
    this.#assertSlippage(referencePrice, price, 'BUY');
    const notional = quantity * price;
    const fee = money(notional * this.config.feePerSide);
    const totalCost = money(notional + fee);
    if (totalCost > this.cash) throw new Error('Insufficient paper cash including fees.');
    this.cash = money(this.cash - totalCost);
    const position = {
      id: randomUUID(), symbol, side: 'LONG', initialQty: quantity, remainingQty: quantity,
      entryPrice: price, markPrice: price, highestPrice: price, openedAt: now,
      entryFee: fee, entryFeeAllocated: 0, feesPaid: fee, realizedGross: 0, realizedNet: 0,
      hitTiers: [], status: 'OPEN',
    };
    this.positions.set(position.id, position);
    this.#updateDailyPnl(now);
    return structuredClone(position);
  }

  /** A single closed-candle/market-price event updates stops and staged exits. */
  onPrice(symbol, price, now = this.now()) {
    assertPositive(price, 'price');
    this.#rollDay(now);
    const events = [];
    for (const p of [...this.positions.values()]) {
      if (p.symbol !== symbol) continue;
      p.markPrice = price;
      p.highestPrice = Math.max(p.highestPrice, price);
      for (let i = 0; i < this.config.takeProfitTiers.length; i++) {
        const tier = this.config.takeProfitTiers[i];
        if (!p.hitTiers.includes(i) && price + price * 1e-12 >= p.entryPrice * (1 + tier.gain) && p.remainingQty > 0) {
          const qty = Math.min(p.remainingQty, p.initialQty * tier.fraction);
          this.#reducePosition(p, qty, price, `TAKE_PROFIT_${Math.round(tier.gain * 100)}%`, now);
          p.hitTiers.push(i);
          events.push({ type: 'PARTIAL_TAKE_PROFIT', positionId: p.id, quantity: qty, price, tier: tier.gain });
        }
      }
      if (!this.positions.has(p.id)) continue;
      const hardStopPrice = p.entryPrice * (1 - this.config.hardStop);
      const trailingActive = p.highestPrice > p.entryPrice;
      const trailingStopPrice = trailingActive ? p.highestPrice * (1 - this.config.trailingDistance) : -Infinity;
      const stopPrice = Math.max(hardStopPrice, trailingStopPrice);
      if (price <= stopPrice) {
        const reason = trailingStopPrice >= hardStopPrice ? 'TRAILING_STOP' : 'PROTECTIVE_STOP';
        this.closePosition(p.id, price, reason, now);
        events.push({ type: 'STOP_EXIT', positionId: p.id, price, reason });
      }
    }
    this.#updateDailyPnl(now);
    if (this.dailyPnl <= -(this.dayStartEquity * this.config.dailyLossLimit) && !this.pausedUntil) {
      this.running = false;
      this.pausedUntil = now + 24 * 60 * 60 * 1000;
      this.dailyCutoffTriggeredAt = now;
      for (const p of [...this.positions.values()]) this.closePosition(p.id, p.markPrice, 'DAILY_DRAWDOWN_CUTOFF', now);
      events.push({ type: 'DAILY_DRAWDOWN_CUTOFF', pausedUntil: this.pausedUntil });
    }
    this.#updateDailyPnl(now);
    return { events, stats: this.stats };
  }

  closePosition(positionId, price, reason = 'MANUAL', now = this.now()) {
    assertPositive(price, 'price');
    const p = this.positions.get(positionId);
    if (!p) throw new Error('Open position not found.');
    this.#reducePosition(p, p.remainingQty, price, reason, now);
    return this.closedTrades.at(-1);
  }

  /** Closes all paper positions and clears paper pending orders; latches the stop. */
  panicStop(now = this.now()) {
    this.running = false;
    this.killLatched = true;
    const cancelledOrders = this.pendingOrders.size;
    this.pendingOrders.clear();
    const closed = [];
    for (const p of [...this.positions.values()]) closed.push(this.closePosition(p.id, p.markPrice, 'PANIC_STOP', now));
    this.#updateDailyPnl(now);
    return { closed, cancelledOrders, stats: this.stats };
  }

  addPendingOrder(order) {
    if (!this.running || this.killLatched) throw new Error('Engine is not accepting orders.');
    const pending = { id: randomUUID(), ...order, createdAt: this.now() };
    this.pendingOrders.set(pending.id, pending);
    return structuredClone(pending);
  }

  #reducePosition(p, quantity, price, reason, now) {
    if (!(quantity > 0 && quantity <= p.remainingQty + 1e-12)) throw new RangeError('Invalid reduction quantity.');
    const entryFeeAllocated = money(p.entryFee * (quantity / p.initialQty));
    const exitFee = money(quantity * price * this.config.feePerSide);
    const gross = money((price - p.entryPrice) * quantity);
    const net = money(gross - entryFeeAllocated - exitFee);
    this.cash = money(this.cash + quantity * price - exitFee);
    p.remainingQty = Math.max(0, p.remainingQty - quantity);
    p.entryFeeAllocated = money(p.entryFeeAllocated + entryFeeAllocated);
    p.feesPaid = money(p.feesPaid + exitFee);
    p.realizedGross = money(p.realizedGross + gross);
    p.realizedNet = money(p.realizedNet + net);
    p.markPrice = price;
    p.lastExitAt = now;
    if (p.remainingQty <= 1e-12) {
      p.remainingQty = 0;
      p.status = 'CLOSED';
      const trade = {
        id: p.id, symbol: p.symbol, side: 'LONG', entryPrice: p.entryPrice, exitPrice: price,
        quantity: p.initialQty, grossPnl: p.realizedGross, fees: p.feesPaid, netPnl: p.realizedNet,
        reason, openedAt: p.openedAt, closedAt: now,
      };
      this.positions.delete(p.id);
      this.closedTrades.push(trade);
    }
  }

  #assertSlippage(referencePrice, executionPrice, side) {
    const deviation = Math.abs(executionPrice - referencePrice) / referencePrice;
    if (deviation > 0.003 + 1e-12) throw new Error(`Slippage ${money(deviation * 100)}% exceeds 0.30%; order rejected.`);
    const tolerance = referencePrice * 1e-12;
    if (side === 'BUY' && executionPrice > referencePrice * 1.003 + tolerance) throw new Error('Buy price exceeds slippage cap.');
    if (side === 'SELL' && executionPrice < referencePrice * 0.997 - tolerance) throw new Error('Sell price exceeds slippage cap.');
  }

  #rollDay(now) {
    const key = dayKey(now);
    if (key === this.day) return;
    this.day = key;
    this.dayStartEquity = this.equity;
    this.dailyPnl = 0;
    this.pausedUntil = this.pausedUntil && now >= this.pausedUntil ? null : this.pausedUntil;
  }

  #updateDailyPnl(now) {
    this.dailyPnl = money(this.equity - this.dayStartEquity);
  }
}

export const TRADING_DEFAULTS = Object.freeze({ feePerSide: FEE_PER_SIDE, roundTripFeeRate: FEE_PER_SIDE * 2, slippageLimit: 0.003, hardStop: 0.05, trailingDistance: 0.03, dailyDrawdownLimit: 0.03, cooldownMs: 86_400_000 });
