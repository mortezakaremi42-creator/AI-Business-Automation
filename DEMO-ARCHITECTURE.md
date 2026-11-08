> v3 additions and current limitations: see [BIT24-REMEDIATION-FA.md](BIT24-REMEDIATION-FA.md). Live remains disconnected; the independently tested Spot kernel is not an official Bit24 adapter.

# Demo architecture / developer notes

## Reviewed scope

The runnable root application is React/Vite + a TypeScript/Express Node server. Review covered the root engine, shared contracts, server and network adapters, controller and UI components, PWA assets/configuration, tests, package scripts and Capacitor/Android configuration. Other independent projects (`enterprise`, `orbit-trader`, shop/radar/media directories) are not dependencies of this app, were not modified for this task, and are not in the deliverable. Binary media were not treated as source code.

## Boundaries

- Browser is a controller only. It never creates the trading engine or estimates an account balance locally.
- `traderOrchestrator.ts` owns the synthetic feed, portfolios, protective exits, cash ledger, fills and risk latch.
- Every new entry is manual. Start Demo does not authorize autonomous buys. Protective exits keep operating when ordinary trading/scanning is stopped; emergency stop additionally liquidates DEMO positions.
- Root server imports NO exchange REST adapter, secret vault or outbound notification adapter. Legacy adapters are retained for compatibility/tests, but their constructors throw. Injected engine live/notification executors are ignored. Live health cannot switch the feed; activation always refuses. No HTTP route can call a live executor.
- Telegram-looking engine logs are local events only. No external delivery occurs.

## Accounting

Cash and executed quantities/prices are authoritative; the UI rounds display only. Entry fee = 0.2% of allocated cash; quantity = (allocation - entry fee) / slipped entry price. At sale, net cash = quantity * slipped observed price * 0.998. Cost basis is allocated in proportion to remaining quantity. Net realized P&L = net sale proceeds - allocated entry cost, which already contains entry fee. Fee reporting prorates the actual entry fee, avoiding double deduction. Closed-fill history is never truncated; UI may display a window.

Unrealized P&L uses estimated **net liquidation** value (exit slippage and fee included). Crypto net equity = available cash + remaining cost + unrealized P&L. Deposits/withdrawals do not exist: signed cash adjustments only change paper cash, are recorded separately and excluded from profit. Gold retains its own 50M starting cash; crypto starts at 100M. Win/loss statistics aggregate a position's partial exits and count only fully closed positions, not each profitable partial fill as a new win.

Risk sizing includes a 0.6 percentage point friction allowance on top of the configured stop; allocation and cash-reserve caps also apply. This is an estimate, NOT a guarantee: a gap beyond the stop can lose more than the nominal risk budget. No fill is guaranteed at a stop/TP threshold. Settings for protective exits are copied into each new position; later edits apply only to future entries.

Synthetic feed ticks aggregate into minute candles. Volume is anchored to the seeded synthetic volume instead of compounding at every tick. Synthetic scenarios include oscillation so all non-trap symbols do not accidentally become RSI-overbought. PEPE remains a deliberately blocked overpump example. All prices and analysis are labelled hypothetical, including gold catalogue availability; no tradability has been checked with an exchange.

## Daily limit

UTC calendar day, persisted start-of-day total net liquidation equity for BOTH demo accounts, and signed paper cash flows. Day P&L = current total net liquidation equity - day baseline - day cash flows. Drawdown is measured against the day baseline, not a rolling 24h realized-profit window. The 3% default limit covers realized AND unrealized losses. Reaching it latches new-entry blocking for the rest of that UTC day, even if prices recover, cash is added, settings change or server restarts. Protective exits remain enabled. At the next day the budget resets but trading is not automatically restarted. The maximum concurrent position count (default 3) is global across crypto and gold, although their cash and realized profit reports remain separate.

## Durability / idempotency

All server mutations and ticks share a single sequential queue. Public status is the last committed snapshot, not partially mutated state. Financial mutations require a UUID requestId. The same key and canonical payload returns the original durable outcome without applying it again; changed payload/side gives 409. Definite risk rejections are also receipts. State and receipts are one checksummed, versioned envelope. Validation rejects LIVE state, non-finite values, invalid remaining quantity, duplicate positions and unsupported format. Atomic temp-file write + fsync + rename precedes success. Directory fsync is used on Linux; filesystem/power-loss guarantees depend on OS/storage.

A proper-lockfile sidecar provides one writer and stale-lock handling (30 seconds). Do not run clustered workers against this file. Snapshot write failure rolls engine memory back, returns 503 and halts all further state mutations/ticks until the storage problem is resolved and the process restarted. If rename already committed before a later filesystem error, the HTTP result is UNKNOWN; restart loads the receipt, not a duplicate operation. Corruption never silently resets the account.

The client writes its pending ID before sending and does not automatically retry financial POSTs. After an ambiguous response, `GET /api/demo/receipts/:id` can clear the local block only when a committed outcome exists. A missing receipt is not proof of no execution. Browser refresh, changing address, clearing storage or another device do not reconcile an order. On shared clients/tabs, server-side serialization, symbol duplicates and global capacity still apply.

## PWA and Android

PWA caches only successful same-origin static GETs. API requests and cross-origin resources are never cached; only navigations may fall back to the cached HTML. Offline mode is a disconnected controller, not a local simulator. Real PWA installation in LAN browsers requires a secure context (HTTPS; localhost exception applies only to that device). Capacitor bundles Vite output from `dist/client`; no remote `server.url` or Node engine is embedded. Debug Android allows private-LAN HTTP; release cleartext is disabled. Background server availability is independent of whether the phone UI remains alive.

## Extend safely

Replace file storage with transactional SQLite/PostgreSQL before adding many users or very large histories. Keep state + financial receipt commit atomic, enforce unique request IDs and positions, and preserve the no-network invariant. Do not connect the dormant live adapter as a shortcut. A real-trading project would require a separate user request, independent reconciliation/persistence/security design and verification; passing these paper tests does not certify live operation.
