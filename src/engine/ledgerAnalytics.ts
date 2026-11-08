import type {
  ActivePosition,
  TradeHistoryRecord,
} from "../shared/contracts.js";

/** A partial sale is one closed exit, NOT one completed position. Keep both denominators visible. */
export interface OutcomeStatistics {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePct: number | null;
}
export function outcomeStatistics(pnls: number[]): OutcomeStatistics {
  if (pnls.some((p) => !Number.isFinite(p))) throw Error("INVALID_LEDGER_PNL");
  // Monetary reports settle to the nearest toman. Sub-toman float dust is not a win/loss.
  const normalized = pnls.map((p) => Math.round(p));
  const wins = normalized.filter((p) => p > 0).length;
  return {
    count: pnls.length,
    wins,
    losses: normalized.filter((p) => p < 0).length,
    breakeven: normalized.filter((p) => p === 0).length,
    winRatePct: pnls.length
      ? Number(((100 * wins) / pnls.length).toFixed(2))
      : null,
  };
}
export function ledgerAnalytics(
  trades: TradeHistoryRecord[],
  open: ActivePosition[],
  mode: "DEMO" | "LIVE",
  segment: "CRYPTO" | "GOLD" | "ALL" = "ALL",
) {
  const records = new Map<string, TradeHistoryRecord>();
  for (const t of trades) {
    if (t.mode !== mode || (segment !== "ALL" && t.segment !== segment))
      continue;
    const prior = records.get(t.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(t))
      throw Error("CONFLICTING_FILL_ID");
    records.set(t.id, t);
  }
  const exits = [...records.values()];
  const activeIds = new Set(
    open.filter((p) => p.mode === mode).map((p) => p.id),
  );
  const groups = new Map<string, { pnl: number; closedAt: number }>();
  for (const t of exits) {
    // Old records without a position ID can contribute exit P&L, but cannot prove full closure.
    if (!t.positionId || activeIds.has(t.positionId)) continue;
    const key = `${t.mode}:${t.segment}:${t.positionId}`;
    const g = groups.get(key) ?? { pnl: 0, closedAt: 0 };
    g.pnl += t.netPnlIrt;
    g.closedAt = Math.max(g.closedAt, t.sellTime);
    groups.set(key, g);
  }
  const realizedPnlIrt = exits.reduce((s, t) => s + t.netPnlIrt, 0);
  const totalFeesIrt = exits.reduce((s, t) => s + t.totalFeeIrt, 0);
  return {
    scope: `${mode}:${segment}` as string,
    closedExits: outcomeStatistics(exits.map((t) => t.netPnlIrt)),
    closedPositions: outcomeStatistics([...groups.values()].map((p) => p.pnl)),
    realizedPnlIrt,
    totalFeesIrt,
    grossPnlIrt: realizedPnlIrt + totalFeesIrt,
  };
}
