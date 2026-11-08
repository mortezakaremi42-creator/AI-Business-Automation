import {
  decimalPrice,
  enforcePriceDeviation,
} from "../../shared/priceDeviation.js";
export {
  decimalPrice,
  enforcePriceDeviation,
} from "../../shared/priceDeviation.js";
import { randomUUID } from "node:crypto";

/** These are NORMALIZED adapter contracts, not guessed Bit24 REST endpoint/field names. */
export interface SpotPermissions {
  spotTrade: boolean;
  read: boolean;
  withdraw: boolean;
  transfer: boolean;
  accountId: string;
  checkedAt: number;
}
export interface SpotQuote {
  bid: string;
  ask: string;
  observedAt: number;
}
export interface SpotOrder {
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  type: "LIMIT_IOC" | "MARKET";
  limitPrice?: string;
}
export interface OrderStatus {
  status: "OPEN" | "FILLED" | "CANCELLED" | "REJECTED" | "UNKNOWN";
  orderId: string;
  clientOrderId: string;
  // The integration must settle exact exchange executions and actual fees, never an ACK as a fill.
}
export interface VerifiedSpotAdapter {
  readonly reviewedDocumentation: string;
  permissions(signal: AbortSignal): Promise<SpotPermissions>;
  quote(symbol: string, signal: AbortSignal): Promise<SpotQuote>;
  /** Must obey instrument lot/tick/minNotional and support client IDs + IOC; no market fallback. */
  submit(order: SpotOrder, signal: AbortSignal): Promise<{ orderId: string }>;
  lookup(clientOrderId: string, signal: AbortSignal): Promise<OrderStatus>;
  listManagedOrders(
    signal: AbortSignal,
  ): Promise<{ orderId: string; clientOrderId: string }[]>;
  cancel(orderId: string, signal: AbortSignal): Promise<void>;
  /** Dedicated bot inventory only. Never return holdings of other strategies/users. */
  managedInventory(
    signal: AbortSignal,
  ): Promise<{ symbol: string; quantity: string }[]>;
}
export interface LiveIntent {
  id: string;
  order: SpotOrder;
  status: "UNKNOWN" | "OPEN" | "FILLED" | "CANCELLED" | "REJECTED";
  orderId?: string;
}
export interface ExecutionJournal {
  /** Implementations MUST fsync atomically before returning; isolated from paper account. */
  load(): {
    halted: boolean;
    intents: LiveIntent[];
    cancelUncertain?: string[];
  };
  save(state: {
    halted: boolean;
    intents: LiveIntent[];
    cancelUncertain?: string[];
  }): void;
}
export class RateLimited extends Error {
  constructor(readonly retryAfterMs: number) {
    super("EXCHANGE_RATE_LIMIT");
  }
}
const SCALE = 10n ** 12n;
function formatPrice(n: bigint) {
  return `${n / SCALE}.${(n % SCALE).toString().padStart(12, "0")}`;
}
/** Provider-independent safety kernel. NO production exchange adapter is bundled/enabled. */
export class SafeSpotExecution {
  private state: ReturnType<ExecutionJournal["load"]>;
  private busy = false;
  private faulted = false;
  private haltGeneration = 0;
  constructor(
    private adapter: VerifiedSpotAdapter,
    private journal: ExecutionJournal,
    private options: {
      accountId: string;
      reviewed: boolean;
      clock?: () => number;
    },
  ) {
    this.state = structuredClone(journal.load());
    // A restart never re-arms live trading. Unknown intents remain and must be reconciled.
    this.state.halted = true;
    this.persist();
  }
  private now() {
    return this.options.clock?.() ?? Date.now();
  }
  private persist() {
    try {
      this.journal.save(structuredClone(this.state));
    } catch {
      this.faulted = true;
      this.state.halted = true;
      throw Error("LIVE_JOURNAL_FAULT");
    }
  }
  snapshot() {
    return structuredClone({ ...this.state, faulted: this.faulted });
  }
  private unresolved() {
    return this.state.intents.some(
      (i) => i.status === "UNKNOWN" || i.status === "OPEN",
    );
  }
  private async timed<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error("TIMEOUT"));
          }, 8000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async read<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    // Rate-limit read backoff only. Financial writes are NEVER automatically retried.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.timed(operation);
      } catch (error) {
        if (
          error instanceof RateLimited &&
          attempt === 0 &&
          error.retryAfterMs >= 0 &&
          error.retryAfterMs <= 2000
        ) {
          await new Promise((r) => setTimeout(r, error.retryAfterMs));
          continue;
        }
        throw Error(
          error instanceof RateLimited
            ? "RATE_LIMIT_COOLDOWN"
            : "EXCHANGE_READ_UNAVAILABLE",
        );
      }
    }
  }
  private async permissions() {
    if (
      this.faulted ||
      !this.options.reviewed ||
      !this.adapter.reviewedDocumentation.startsWith("https://")
    )
      throw Error("OFFICIAL_API_REVIEW_REQUIRED");
    const p = await this.read((signal) => this.adapter.permissions(signal)),
      age = this.now() - p.checkedAt;
    if (
      p.accountId !== this.options.accountId ||
      p.spotTrade !== true ||
      p.read !== true ||
      p.withdraw !== false ||
      p.transfer !== false ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 10000
    )
      throw Error("SPOT_ONLY_PERMISSION_REQUIRED");
  }
  async arm() {
    if (this.busy || this.unresolved() || this.state.cancelUncertain?.length)
      throw Error("UNRESOLVED_OR_BUSY");
    this.busy = true;
    const generation = this.haltGeneration;
    try {
      await this.permissions();
      if (
        (await this.read((signal) => this.adapter.listManagedOrders(signal)))
          .length
      )
        throw Error("PENDING_ORDERS_EXIST");
      if (generation !== this.haltGeneration) throw Error("KILL_SWITCH_ACTIVE");
      this.state.halted = false;
      this.persist();
    } finally {
      this.busy = false;
    }
  }
  halt() {
    this.haltGeneration++;
    this.state.halted = true;
    this.persist();
  }
  async submit(params: {
    requestId: string;
    symbol: string;
    side: "BUY" | "SELL";
    quantity: string;
    referencePrice: string;
  }) {
    if (this.faulted || this.busy || this.state.halted || this.unresolved())
      throw Error("EXECUTION_HALTED_OR_BUSY");
    if (
      !/^[A-Z0-9]+\/IRT$/.test(params.symbol) ||
      !["BUY", "SELL"].includes(params.side) ||
      !/^\d+(?:\.\d{1,18})?$/.test(params.quantity) ||
      params.quantity.length > 40 ||
      !/[1-9]/.test(params.quantity) ||
      !params.requestId ||
      params.requestId.length > 100
    )
      throw Error("INVALID_SPOT_ORDER");
    const existing = this.state.intents.find((i) => i.id === params.requestId);
    if (existing) throw Error("REQUEST_ALREADY_JOURNALED");
    this.busy = true;
    try {
      await this.permissions();
      const quote = await this.read((signal) =>
        this.adapter.quote(params.symbol, signal),
      );
      const age = this.now() - quote.observedAt;
      if (
        !Number.isFinite(age) ||
        age < 0 ||
        age > 1500 ||
        decimalPrice(quote.bid) > decimalPrice(quote.ask)
      )
        throw Error("STALE_OR_INVALID_QUOTE");
      enforcePriceDeviation(
        params.referencePrice,
        params.side === "BUY" ? quote.ask : quote.bid,
      );
      const reference = decimalPrice(params.referencePrice);
      const limit =
        params.side === "BUY"
          ? (reference * 10030n) / 10000n
          : (reference * 9970n + 9999n) / 10000n;
      if (this.state.halted) throw Error("KILL_SWITCH_ACTIVE");
      return await this.dispatch({
        clientOrderId: params.requestId,
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        type: "LIMIT_IOC",
        limitPrice: formatPrice(limit),
      });
    } finally {
      this.busy = false;
    }
  }
  private async dispatch(order: SpotOrder) {
    const intent: LiveIntent = {
      id: order.clientOrderId,
      order,
      status: "UNKNOWN",
    };
    this.state.intents.push(intent);
    this.persist(); // Commit before touching the network.
    try {
      const ack = await this.timed((signal) =>
        this.adapter.submit(order, signal),
      );
      if (!ack.orderId) throw Error();
      intent.orderId = ack.orderId;
      // An ACK is NOT a fill. Lookup reconciliation must confirm terminal status.
      this.persist();
      return structuredClone(intent);
    } catch {
      this.state.halted = true;
      this.persist();
      throw Error("SUBMISSION_UNKNOWN_DO_NOT_RETRY");
    }
  }
  async reconcile() {
    if (this.busy) throw Error("EXECUTION_BUSY");
    this.busy = true;
    try {
      await this.permissions();
      for (const id of [...(this.state.cancelUncertain ?? [])]) {
        const order = await this.read((signal) =>
          this.adapter.lookup(id, signal),
        );
        if (order.clientOrderId !== id || !order.orderId)
          throw Error("ORDER_IDENTITY_MISMATCH");
        if (["CANCELLED", "FILLED", "REJECTED"].includes(order.status)) {
          this.state.cancelUncertain = this.state.cancelUncertain?.filter(
            (x) => x !== id,
          );
          this.persist();
        }
      }
      for (const intent of this.state.intents.filter(
        (i) => i.status === "UNKNOWN" || i.status === "OPEN",
      )) {
        const found = await this.read((signal) =>
          this.adapter.lookup(intent.id, signal),
        );
        if (
          found.clientOrderId !== intent.id ||
          !found.orderId ||
          (intent.orderId && found.orderId !== intent.orderId)
        )
          throw Error("ORDER_IDENTITY_MISMATCH");
        if (
          !["OPEN", "FILLED", "CANCELLED", "REJECTED", "UNKNOWN"].includes(
            found.status,
          )
        )
          throw Error("ORDER_STATUS_UNKNOWN");
        intent.status = found.status;
        intent.orderId = found.orderId;
        this.persist();
      }
    } finally {
      this.busy = false;
    }
  }
  async panic(): Promise<{ ok: boolean; reason?: string }> {
    this.halt(); // Synchronous latch preempts a quote/permission read already in flight.
    if (this.busy)
      return { ok: false, reason: "IN_FLIGHT_OPERATION_RECONCILE_REQUIRED" };
    this.busy = true;
    try {
      await this.permissions();
      const pending = await this.read((signal) =>
        this.adapter.listManagedOrders(signal),
      );
      // Cancel first, verify zero pending, then sell only bot-managed inventory.
      for (const order of pending) {
        this.state.cancelUncertain = [
          ...(this.state.cancelUncertain ?? []).filter(
            (id) => id !== order.clientOrderId,
          ),
          order.clientOrderId,
        ];
        this.persist();
        try {
          await this.timed((signal) =>
            this.adapter.cancel(order.orderId, signal),
          );
        } catch {
          return { ok: false, reason: "CANCEL_UNKNOWN_VERIFY_EXCHANGE" };
        }
        const status = await this.read((signal) =>
          this.adapter.lookup(order.clientOrderId, signal),
        );
        if (
          status.clientOrderId !== order.clientOrderId ||
          status.orderId !== order.orderId ||
          !["CANCELLED", "FILLED", "REJECTED"].includes(status.status)
        )
          return { ok: false, reason: "CANCELLATION_NOT_FINAL" };
        this.state.cancelUncertain = this.state.cancelUncertain.filter(
          (id) => id !== order.clientOrderId,
        );
        this.persist();
      }
      if (
        (await this.read((signal) => this.adapter.listManagedOrders(signal)))
          .length
      )
        return { ok: false, reason: "ORDERS_STILL_PENDING" };
      // A complete scoped exchange query proves pending cancellation, but UNKNOWN submissions still need lookup.
      if (this.unresolved() || this.state.cancelUncertain?.length)
        return { ok: false, reason: "RECONCILE_UNKNOWN_ORDERS_FIRST" };
      for (const p of await this.read((signal) =>
        this.adapter.managedInventory(signal),
      )) {
        if (
          !/^[A-Z0-9]+\/IRT$/.test(p.symbol) ||
          !/^\d+(?:\.\d{1,18})?$/.test(p.quantity) ||
          !/[1-9]/.test(p.quantity)
        )
          return { ok: false, reason: "INVALID_MANAGED_INVENTORY" };
        await this.permissions();
        await this.dispatch({
          clientOrderId: randomUUID(),
          symbol: p.symbol,
          quantity: p.quantity,
          side: "SELL",
          type: "MARKET",
        });
        // A market ACK is not a fill. Bounded terminal polling before processing the next asset.
        const intent = this.state.intents[this.state.intents.length - 1];
        for (let attempt = 0; attempt < 4; attempt++) {
          const status = await this.read((signal) =>
            this.adapter.lookup(intent.id, signal),
          );
          if (
            status.clientOrderId !== intent.id ||
            status.orderId !== intent.orderId
          )
            throw Error("ORDER_IDENTITY_MISMATCH");
          if (["FILLED", "CANCELLED", "REJECTED"].includes(status.status)) {
            intent.status = status.status;
            this.persist();
            break;
          }
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000));
        }
        if (intent.status !== "FILLED")
          return {
            ok: false,
            reason: "LIQUIDATION_INCOMPLETE_RECONCILE_REQUIRED",
          };
      }
      if (
        (await this.read((signal) => this.adapter.managedInventory(signal)))
          .length
      )
        return { ok: false, reason: "INVENTORY_REMAINS_VERIFY_EXCHANGE" };
      return { ok: true };
    } catch {
      return { ok: false, reason: "PANIC_INCOMPLETE_VERIFY_EXCHANGE" };
    } finally {
      this.busy = false;
    }
  }
}
