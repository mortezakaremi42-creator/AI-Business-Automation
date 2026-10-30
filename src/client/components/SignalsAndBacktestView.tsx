import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart2,
  CheckCircle2,
  Filter,
  Play,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { BacktestSummary, ModuleId, PlatformSnapshot } from '../../shared/types';
import {
  formatCompactIrt,
  formatPct,
  formatPrice,
  getModuleTitleFa,
} from '../utils/format';

interface Props {
  snapshot: PlatformSnapshot;
  onExecutePaperSignal: (signalId: string) => void;
  onRunBacktest: (
    module: 'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER',
    marketName?: string
  ) => Promise<BacktestSummary>;
}

export const SignalsAndBacktestView: React.FC<Props> = ({
  snapshot,
  onExecutePaperSignal,
  onRunBacktest,
}) => {
  const [filterModule, setFilterModule] = useState<'ALL' | ModuleId>('ALL');
  const [btModule, setBtModule] = useState<'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER'>('DIGITAL_GOLD');
  const [btMarket, setBtMarket] = useState<string>('PAXG/IRT');
  const [btResult, setBtResult] = useState<BacktestSummary | null>(null);
  const [btRunning, setBtRunning] = useState(false);

  const runBt = async (mod: 'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER', mkt: string) => {
    setBtRunning(true);
    try {
      const res = await onRunBacktest(mod, mkt);
      setBtResult(res);
    } finally {
      setBtRunning(false);
    }
  };

  useEffect(() => {
    runBt('DIGITAL_GOLD', 'PAXG/IRT');
  }, []);

  const filteredSignals = snapshot.signals.filter((s) =>
    filterModule === 'ALL' ? true : s.module === filterModule
  );

  const marketOptions = snapshot.markets.filter((m) =>
    btModule === 'DIGITAL_GOLD'
      ? m.category === 'GOLD'
      : btModule === 'MEME_HUNTER'
        ? m.category === 'MEME'
        : m.category === 'CRYPTO'
  );

  return (
    <div className="space-y-5">
      {/* 1. Ranked Signals Feed with Explicit Entry & Rejection Reasons */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-black text-white">
              فهرست سیگنال‌ها، امتیاز رتبه‌بندی و دلایل ورود یا رد معامله
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            {(
              [
                ['ALL', 'همه ماژول‌ها'],
                ['DIGITAL_GOLD', 'طلای دیجیتال'],
                ['SPOT_CRYPTO', 'رمزارز اسپات'],
                ['MEME_HUNTER', 'میم‌کوین اسپات'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilterModule(id)}
                className={`rounded-lg px-2.5 py-1 font-bold ${
                  filterModule === id
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 space-y-2.5">
          {filteredSignals.map((sig) => {
            const confirmed =
              sig.action === 'BUY_CONFIRMED' || sig.action === 'SHORT_MARGIN_CONFIRMED';
            return (
              <div
                key={sig.id}
                className={`rounded-xl border p-3.5 ${
                  confirmed
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-slate-800 bg-slate-950/70'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">{sig.marketName}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                      {getModuleTitleFa(sig.module)}
                    </span>
                    <span className="text-xs font-bold text-amber-300">
                      امتیاز سیگنال: {sig.confidenceScore}/100
                    </span>
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-cyan-300">
                      ATR: {sig.technicals.atrPct.toFixed(2)}٪ | حجم: {sig.technicals.volumeRatio}x
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-extrabold ${
                        confirmed
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : sig.action === 'AVOID_UNFAVORABLE'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {confirmed
                        ? 'سیگنال ورود تأییدشده'
                        : sig.action === 'AVOID_UNFAVORABLE'
                          ? 'رد معامله (شرایط نامناسب)'
                          : 'رصد (بدون تایید کافی)'}
                    </span>

                    <button
                      type="button"
                      onClick={() => onExecutePaperSignal(sig.id)}
                      className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25"
                    >
                      شبیه‌سازی آزمایشی
                    </button>
                  </div>
                </div>

                <p className="mt-1.5 text-xs text-slate-300">{sig.summaryFa}</p>

                {/* Explicit Entry & Rejection Reasons */}
                <div className="mt-2 space-y-1 text-[11px]">
                  {sig.reasonsFa.slice(0, 2).map((r, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-emerald-300">
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                  {sig.rejectionReasonsFa.map((rej, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 text-rose-300">
                      <XCircle className="h-3 w-3 shrink-0" />
                      <span>دلیل رد: {rej}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                  <span>ورود پیشنهادی: {formatPrice(sig.suggestedEntry, sig.quoteSymbol)}</span>
                  <span className="text-rose-300">
                    حد ضرر: {formatPrice(sig.stopLoss, sig.quoteSymbol)}
                  </span>
                  <span className="text-emerald-300">
                    TP1: {formatPrice(sig.takeProfit1, sig.quoteSymbol)} | TP2:{' '}
                    {formatPrice(sig.takeProfit2, sig.quoteSymbol)}
                  </span>
                  <span>
                    کارمزد+اسپرد+اسلیپیج: {sig.costs.totalFrictionPct}٪ | R:R خالص:{' '}
                    <strong className="text-white">{sig.costs.netRiskRewardRatio}</strong>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Stage 7 Zero-Lookahead Historical Backtesting Engine */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <BarChart2 className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-black text-white">
                موتور بک‌تست بدون سوگیری آینده‌نگری (Zero Look-Ahead Bias)
              </h2>
              <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-200">
                شبیه‌سازی آزمایشی (غیرواقعی)
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              سیگنال فقط با داده‌های گذشته بسته شده و ورود روی قیمت باز شدن کندل بعدی به همراه کارمزد ۰.۲٪، اسپرد و اسلیپیج محاسبه می‌شود. نتایج آزمایشی را با سود واقعی اشتباه نگیرید.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={btModule}
              onChange={(e) => {
                const nextMod = e.target.value as
                  | 'DIGITAL_GOLD'
                  | 'SPOT_CRYPTO'
                  | 'MEME_HUNTER';
                setBtModule(nextMod);
                const nextDefault =
                  nextMod === 'DIGITAL_GOLD'
                    ? 'PAXG/IRT'
                    : nextMod === 'MEME_HUNTER'
                      ? 'DOGE/IRT'
                      : 'BTC/IRT';
                setBtMarket(nextDefault);
                runBt(nextMod, nextDefault);
              }}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-white"
            >
              <option value="DIGITAL_GOLD">ماژول طلا (PAXG/XAUT)</option>
              <option value="SPOT_CRYPTO">ماژول رمزارز اسپات</option>
              <option value="MEME_HUNTER">زیرماژول میم‌کوین اسپات</option>
            </select>

            <select
              value={btMarket}
              onChange={(e) => {
                setBtMarket(e.target.value);
                runBt(btModule, e.target.value);
              }}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-white"
            >
              {marketOptions.map((m) => (
                <option key={m.marketName} value={m.marketName}>
                  {m.marketName} ({m.baseFaName})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => runBt(btModule, btMarket)}
              disabled={btRunning}
              className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-amber-400"
            >
              <Play className="h-3.5 w-3.5" />
              اجرای بک‌تست
            </button>
          </div>
        </div>

        {btResult && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <StatTile
                label="سود خالص شبیه‌سازی"
                val={formatPct(btResult.netProfitPct)}
                positive={btResult.netProfitIrt >= 0}
              />
              <StatTile
                label="سرمایه نهایی آزمایشی"
                val={formatCompactIrt(btResult.finalCapitalIrt)}
              />
              <StatTile
                label="تعداد معاملات و نرخ برد"
                val={`${btResult.totalTrades} معامله (${btResult.winRatePct}٪)`}
              />
              <StatTile
                label="حداکثر افت سرمایه (Drawdown)"
                val={`${btResult.maxDrawdownPct}٪`}
              />
              <StatTile
                label="معاملات ردشده توسط فیلتر"
                val={`${btResult.filteredBadSetupsCount} مورد`}
              />
            </div>

            {/* Performance Breakdown Across Market Regimes (Stage 7 Requirement) */}
            <div className="grid gap-2.5 sm:grid-cols-3">
              {btResult.regimeBreakdown.map((reg, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-800 bg-slate-950/75 p-2.5 text-xs"
                >
                  <div className="font-bold text-slate-200">{reg.regimeFa}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span>تعداد معامله: {reg.trades}</span>
                    <span
                      className={`font-mono-num font-bold ${
                        reg.netPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      بازده: {formatPct(reg.netPnlPct)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                تأیید عدم استفاده از داده آینده (Causal Slice): <strong>فعال</strong> • کارمزد و اسلیپیج کسرشده:{' '}
                <strong className="text-amber-300">
                  {formatCompactIrt(btResult.totalFeesAndSlippageIrt)}
                </strong>
              </span>
            </div>

            {btResult.sampleTrades.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-900/90 text-slate-400">
                    <tr>
                      <th className="p-2.5">نماد</th>
                      <th className="p-2.5">شرایط بازار</th>
                      <th className="p-2.5">قیمت ورود (با اسلیپیج)</th>
                      <th className="p-2.5">قیمت خروج</th>
                      <th className="p-2.5">بازده خالص</th>
                      <th className="p-2.5">علت خروج</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 bg-slate-950/50">
                    {btResult.sampleTrades.map((tr, i) => (
                      <tr key={i}>
                        <td className="p-2.5 font-bold text-white">{btResult.marketName}</td>
                        <td className="p-2.5 text-slate-300">{tr.regimeFa}</td>
                        <td className="font-mono-num p-2.5">
                          {tr.entryPrice.toLocaleString('fa-IR')}
                        </td>
                        <td className="font-mono-num p-2.5">
                          {tr.exitPrice.toLocaleString('fa-IR')}
                        </td>
                        <td
                          className={`font-mono-num p-2.5 font-bold ${
                            tr.netPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatPct(tr.netPnlPct)}
                        </td>
                        <td className="p-2.5 text-slate-300">{tr.reasonFa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Rejected Setups Log in Backtest (Stage 7 Requirement) */}
            {btResult.rejectedSampleReasons.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/65 p-3 text-xs">
                <div className="mb-1.5 font-bold text-rose-300">
                  نمونه دلایل ثبت‌شده رد معاملات پرریسک در بک‌تست:
                </div>
                <div className="space-y-1 text-[11px] text-slate-300">
                  {btResult.rejectedSampleReasons.slice(0, 4).map((r, idx) => (
                    <div key={idx}>
                      • کندل #{r.candleIndex} (قیمت {r.price.toLocaleString('fa-IR')}): {r.reasonFa}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[11px] text-amber-200/85">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>
                هشدار صریح: نتایج بک‌تست و Paper Trading صرفاً شبیه‌سازی هستند و با سود واقعی اشتباه گرفته نشوند.
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

const StatTile: React.FC<{ label: string; val: string; positive?: boolean }> = ({
  label,
  val,
  positive,
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
    <div className="text-[11px] text-slate-400">{label}</div>
    <div
      className={`font-mono-num mt-1 text-sm font-black ${
        positive === true
          ? 'text-emerald-400'
          : positive === false
            ? 'text-rose-400'
            : 'text-white'
      }`}
    >
      {val}
    </div>
  </div>
);
