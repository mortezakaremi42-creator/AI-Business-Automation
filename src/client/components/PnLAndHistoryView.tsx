import React, { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Download,
  History,
  ShieldX,
  Terminal,
} from 'lucide-react';
import { ModuleId, PlatformSnapshot } from '../../shared/types';
import {
  formatCompactIrt,
  formatPct,
  formatPrice,
  formatTimeFa,
  getBotStatusBadge,
  getModuleTitleFa,
} from '../utils/format';
import { EquityMiniSvgChart } from './HomeOverview';

interface Props {
  snapshot: PlatformSnapshot;
  onDownloadCsv: () => void;
  onRequestSeparateLiquidation: () => void;
}

export const PnLAndHistoryView: React.FC<Props> = ({
  snapshot,
  onDownloadCsv,
  onRequestSeparateLiquidation,
}) => {
  const [historyFilter, setHistoryFilter] = useState<'ALL' | ModuleId>('ALL');
  const {
    reports,
    periodSummaries,
    performanceCurve,
    tradeHistory,
    rejectedAudit,
    openPositions,
    logs,
    isPnlSimulationEstimated,
  } = snapshot;

  const filteredHistory = tradeHistory.filter((t) =>
    historyFilter === 'ALL' ? true : t.module === historyFilter
  );

  return (
    <div className="space-y-5">
      {/* 1. Daily, Weekly, and Monthly Performance + Chart + CSV Export (Stage 6) */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-white">
              <BarChart3 className="h-5 w-5 text-emerald-400" />
              گزارش عملکرد روزانه، هفتگی و ماهانه + نمودار بازدهی
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              وضعیت ارقام فعلی:{' '}
              <strong className={isPnlSimulationEstimated ? 'text-cyan-300' : 'text-emerald-300'}>
                {isPnlSimulationEstimated
                  ? 'شبیه‌سازی آزمایشی (Paper Trading — غیرواقعی)'
                  : 'قطعی و تاییدشده از معاملات واقعی API'}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDownloadCsv}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400"
            >
              <Download className="h-4 w-4" />
              خروجی CSV از تاریخچه
            </button>

            {openPositions.length > 0 && (
              <button
                type="button"
                onClick={onRequestSeparateLiquidation}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/60 bg-rose-600/20 px-3 py-2 text-xs font-extrabold text-rose-200 hover:bg-rose-600/35"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                بستن همه موقعیت‌های باز (انتخاب جداگانه)
              </button>
            )}
          </div>
        </div>

        <EquityMiniSvgChart points={performanceCurve} />

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[periodSummaries.daily, periodSummaries.weekly, periodSummaries.monthly].map((p) => (
            <div
              key={p.periodId}
              className="rounded-2xl border border-slate-800 bg-slate-950/75 p-3.5 text-xs"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-black text-white">{p.labelFa}</h3>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                  {p.isEstimatedSimulation ? 'تخمینی آزمایشی' : 'قطعی'}
                </span>
              </div>
              <div className="space-y-1.5">
                <Row
                  label="سود/زیان تحقق‌یافته"
                  val={`${p.realizedPnlIrt >= 0 ? '+' : ''}${formatCompactIrt(p.realizedPnlIrt)}`}
                  tone={p.realizedPnlIrt >= 0 ? 'pos' : 'neg'}
                />
                <Row
                  label="سود/زیان تحقق‌نیافته (باز)"
                  val={`${p.unrealizedPnlIrt >= 0 ? '+' : ''}${formatCompactIrt(p.unrealizedPnlIrt)}`}
                  tone={p.unrealizedPnlIrt >= 0 ? 'pos' : 'neg'}
                />
                <Row label="کارمزد کسرشده" val={formatCompactIrt(p.feesPaidIrt)} />
                <Row
                  label="سود/زیان خالص دوره"
                  val={`${p.netPnlIrt >= 0 ? '+' : ''}${formatCompactIrt(p.netPnlIrt)}`}
                  tone={p.netPnlIrt >= 0 ? 'pos' : 'neg'}
                />
                <Row
                  label="معاملات موفق / ناموفق"
                  val={`${p.winningTrades} موفق / ${p.losingTrades} ناموفق`}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Separate PnL Reports Per Module (Gold vs Crypto Strictly Separated) */}
      <section className="glass-panel rounded-2xl p-4">
        <h2 className="mb-3 flex items-center gap-2 text-base font-black text-white">
          <BarChart3 className="h-5 w-5 text-amber-400" />
          تفکیک کامل سود و زیان ماژول طلا از ماژول رمزارزها
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            ['DIGITAL_GOLD', 'SPOT_CRYPTO', 'MEME_HUNTER', 'LEVERAGE_MARGIN'] as ModuleId[]
          ).map((mod) => {
            const r = reports[mod];
            const badge = getBotStatusBadge(r.status);
            return (
              <div
                key={mod}
                className={`rounded-2xl border p-4 ${
                  mod === 'DIGITAL_GOLD'
                    ? 'gold-card'
                    : mod === 'MEME_HUNTER'
                      ? 'border-fuchsia-500/35 bg-slate-950/80'
                      : 'border-slate-800 bg-slate-950/75'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-black text-white">{r.titleFa}</h3>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.colorClass}`}
                  >
                    {badge.labelFa}
                  </span>
                </div>

                <div className="mt-3 space-y-2 text-xs">
                  <Row label="سرمایه اختصاصی بخش" val={formatCompactIrt(r.allocatedCapitalIrt)} />
                  <Row label="سرمایه درگیر فعلی" val={formatCompactIrt(r.engagedCapitalIrt)} />
                  <Row
                    label="تحقق‌یافته ۲۴ ساعته"
                    val={`${r.dailyRealizedPnlIrt >= 0 ? '+' : ''}${formatCompactIrt(r.dailyRealizedPnlIrt)}`}
                    tone={r.dailyRealizedPnlIrt >= 0 ? 'pos' : 'neg'}
                  />
                  <Row
                    label="تحقق‌نیافته فعلی"
                    val={`${r.dailyUnrealizedPnlIrt >= 0 ? '+' : ''}${formatCompactIrt(r.dailyUnrealizedPnlIrt)}`}
                    tone={r.dailyUnrealizedPnlIrt >= 0 ? 'pos' : 'neg'}
                  />
                  <Row
                    label="سود/زیان خالص تجمعی"
                    val={`${r.totalNetPnlIrt >= 0 ? '+' : ''}${formatCompactIrt(r.totalNetPnlIrt)}`}
                    tone={r.totalNetPnlIrt >= 0 ? 'pos' : 'neg'}
                  />
                  <Row
                    label="موفق / ناموفق"
                    val={`${r.winningTrades} موفق / ${r.losingTrades} ناموفق`}
                  />
                  <Row label="کارمزد پرداختی بخش" val={formatCompactIrt(r.totalFeesPaidIrt)} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Full Trade History */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-white">
            <History className="h-5 w-5 text-cyan-400" />
            تاریخچه معاملات بسته‌شده ({filteredHistory.length})
          </h2>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {(
              [
                ['ALL', 'همه'],
                ['DIGITAL_GOLD', 'طلای دیجیتال'],
                ['SPOT_CRYPTO', 'رمزارز اسپات'],
                ['MEME_HUNTER', 'میم‌کوین اسپات'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setHistoryFilter(id)}
                className={`rounded-lg px-2.5 py-1 font-bold ${
                  historyFilter === id
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-400">
            هنوز معامله بسته‌شده‌ای در این بخش ثبت نشده است.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-900/90 text-slate-400">
                <tr>
                  <th className="p-2.5">ماژول</th>
                  <th className="p-2.5">بازار</th>
                  <th className="p-2.5">نوع داده</th>
                  <th className="p-2.5">ورود / خروج</th>
                  <th className="p-2.5">کارمزد</th>
                  <th className="p-2.5">سود/زیان خالص</th>
                  <th className="p-2.5">علت خروج</th>
                  <th className="p-2.5">زمان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 bg-slate-950/60">
                {filteredHistory.map((tr) => (
                  <tr key={tr.id}>
                    <td className="p-2.5 text-slate-300">{getModuleTitleFa(tr.module)}</td>
                    <td className="p-2.5 font-bold text-white">{tr.marketName}</td>
                    <td className="p-2.5">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          tr.isConfirmedLiveFill
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-cyan-500/20 text-cyan-300'
                        }`}
                      >
                        {tr.isConfirmedLiveFill
                          ? `قطعی (#${tr.bit24OrderId})`
                          : 'تخمینی آزمایشی'}
                      </span>
                    </td>
                    <td className="font-mono-num p-2.5 text-slate-300">
                      {formatPrice(tr.entryPrice, tr.quoteSymbol)} ←{' '}
                      {formatPrice(tr.exitPrice, tr.quoteSymbol)}
                    </td>
                    <td className="font-mono-num p-2.5 text-slate-400">
                      {formatCompactIrt(tr.feesPaidQuote)}
                    </td>
                    <td
                      className={`font-mono-num p-2.5 font-extrabold ${
                        tr.netPnlQuote >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatPct(tr.netPnlPct)}
                    </td>
                    <td className="p-2.5 text-slate-300">{tr.exitReasonFa}</td>
                    <td className="font-mono-num p-2.5 text-slate-400">
                      {formatTimeFa(tr.closedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Rejected Signals Audit Log (Stage 7 Requirement) */}
      {rejectedAudit.length > 0 && (
        <section className="glass-panel rounded-2xl p-4">
          <h2 className="mb-2.5 flex items-center gap-2 text-sm font-black text-white">
            <ShieldX className="h-4 w-4 text-rose-400" />
            گزارش معاملات ردشده توسط موتور ریسک و نقدشوندگی
          </h2>
          <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-xl bg-slate-950/80 p-3 text-xs">
            {rejectedAudit.slice(0, 15).map((rej) => (
              <div
                key={rej.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900 pb-1.5"
              >
                <span className="font-bold text-rose-300">
                  {rej.marketName} ({getModuleTitleFa(rej.module)}):{' '}
                  <span className="font-normal text-slate-300">{rej.reasonFa}</span>
                </span>
                <span className="font-mono-num text-[11px] text-slate-500">
                  {formatTimeFa(rej.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Sanitized Security & Audit Event Log (No secrets ever printed) */}
      <section className="glass-panel rounded-2xl p-4">
        <h2 className="mb-2.5 flex items-center gap-2 text-sm font-black text-white">
          <Terminal className="h-4 w-4 text-emerald-400" />
          گزارش امنیتی و رویدادهای سیستم (بدون چاپ اطلاعات محرمانه)
        </h2>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-slate-950/80 p-3 text-xs">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 border-b border-slate-900 pb-1.5">
              <span className="font-mono-num shrink-0 text-[11px] text-slate-500">
                {formatTimeFa(l.timestamp)}
              </span>
              <span
                className={
                  l.level === 'ERROR'
                    ? 'text-rose-400'
                    : l.level === 'WARN'
                      ? 'text-amber-300'
                      : l.level === 'SUCCESS'
                        ? 'text-emerald-300'
                        : 'text-slate-300'
                }
              >
                {l.messageFa}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const Row: React.FC<{ label: string; val: string; tone?: 'pos' | 'neg' }> = ({
  label,
  val,
  tone,
}) => (
  <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
    <span className="text-slate-400">{label}</span>
    <span
      className={`font-mono-num font-bold ${
        tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white'
      }`}
    >
      {val}
    </span>
  </div>
);
