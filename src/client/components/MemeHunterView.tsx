import React from 'react';
import {
  CheckCircle2,
  Flame,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { PlatformSnapshot, SmartSignal } from '../../shared/types';
import {
  formatCompactIrt,
  formatPct,
  formatPrice,
  getBotStatusBadge,
} from '../utils/format';

interface Props {
  snapshot: PlatformSnapshot;
  onScanMemeMarkets: () => void;
  onToggleMemeBot: (enabled: boolean) => void;
  onExecutePaperSignal: (signalId: string) => void;
}

export const MemeHunterView: React.FC<Props> = ({
  snapshot,
  onScanMemeMarkets,
  onToggleMemeBot,
  onExecutePaperSignal,
}) => {
  const memeSignals = snapshot.signals.filter((s) => s.module === 'MEME_HUNTER');
  const memeReport = snapshot.reports.MEME_HUNTER;
  const memeEnabled = snapshot.settings.modules.MEME_HUNTER.enabled;
  const memeRisk = snapshot.settings.modules.MEME_HUNTER.risk;
  const badge = getBotStatusBadge(memeReport.status);

  return (
    <div className="space-y-4">
      {/* Hero Banner */}
      <div className="rounded-2xl border border-fuchsia-500/35 bg-gradient-to-br from-fuchsia-500/15 via-slate-900/95 to-emerald-500/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Rocket className="h-5 w-5 text-fuchsia-400" />
              <h2 className="text-base font-black text-white">
                رادار شکار میم‌کوین در کف حمایتی و استارت موج پامپ (صرافی بیت‌۲۴)
              </h2>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${badge.colorClass}`}
              >
                {badge.labelFa}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
              اسکن زنده میم‌کوین‌های لیست‌شده در بیت‌۲۴ (<strong>DOGE، PEPE، SHIB، WIF، BONK، FLOKI، NOT و...</strong>): شناسایی میم‌کوین‌هایی که پس از اصلاح روی <strong>کف حمایتی</strong> با <strong>جهش ناگهانی حجم (آغاز پامپ)</strong> در حال چرخش رو به بالا هستند و <strong>فروش خودکار پله‌ای هنگام رشد</strong> (+{memeRisk.takeProfit1Pct}٪ پله اول + حد ضرر متحرک روی موج پامپ).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onScanMemeMarkets}
              className="flex items-center gap-1.5 rounded-xl border border-fuchsia-400/50 bg-fuchsia-500/20 px-3.5 py-2.5 text-xs font-extrabold text-fuchsia-200 hover:bg-fuchsia-500/30"
            >
              <RefreshCw className="h-4 w-4" />
              اسکن لحظه‌ای پامپ میم‌کوین‌ها
            </button>

            {memeEnabled ? (
              <button
                type="button"
                onClick={() => onToggleMemeBot(false)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-500/20 px-3.5 py-2.5 text-xs font-extrabold text-rose-200 hover:bg-rose-500/30"
              >
                <PauseCircle className="h-4 w-4" />
                توقف ربات میم‌کوین
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onToggleMemeBot(true)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/20 px-3.5 py-2.5 text-xs font-extrabold text-emerald-200 hover:bg-emerald-500/30"
              >
                <PlayCircle className="h-4 w-4" />
                فعال‌سازی شکارچی میم‌کوین
              </button>
            )}
          </div>
        </div>

        {/* 4 Key Meme Safety Rules */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RuleTile
            label="بودجه مستقل میم‌کوین"
            val={formatCompactIrt(memeReport.allocatedCapitalIrt)}
          />
          <RuleTile
            label="فروش خودکار در رشد"
            val={`پله ۱: +${memeRisk.takeProfit1Pct}٪ | پله ۲: +${memeRisk.takeProfit2Pct}٪`}
          />
          <RuleTile
            label="فیلتر ضد تله قله پامپ"
            val="رد خودکار RSI > 70 (ضد دامپ)"
          />
          <RuleTile
            label="حداکثر ریسک هر شکار"
            val={`${memeRisk.riskPerTradePct}٪ سرمایه بخش میم‌کوین`}
          />
        </div>

        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-slate-950/65 px-3 py-2 text-[11px] text-amber-200">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            <strong>منطق بدون ادعای کف مطلق:</strong> ربات هرگز در میانه ریزش آبشاری خرید نمی‌کند؛ ورود فقط زمانی مجاز است که کف حمایتی حفظ شده و ورود حجم خرید (شروع پامپ) تایید شود.
          </span>
        </div>
      </div>

      {/* Meme Coin Radar Grid */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        {memeSignals.map((sig) => (
          <MemeSignalCard
            key={sig.id}
            signal={sig}
            onExecutePaper={() => onExecutePaperSignal(sig.id)}
          />
        ))}
      </div>
    </div>
  );
};

const RuleTile: React.FC<{ label: string; val: string }> = ({ label, val }) => (
  <div className="rounded-xl border border-fuchsia-500/20 bg-slate-950/70 p-2.5">
    <div className="text-[10px] text-fuchsia-200/80">{label}</div>
    <div className="mt-0.5 text-xs font-extrabold text-white">{val}</div>
  </div>
);

const MemeSignalCard: React.FC<{
  signal: SmartSignal;
  onExecutePaper: () => void;
}> = ({ signal, onExecutePaper }) => {
  const { technicals: t, costs: c, memeMetrics: m } = signal;
  const isBuy = signal.action === 'BUY_CONFIRMED';
  const isFomoTrap = m?.pumpStage === 'LATE_PUMP_FOMO_TRAP';

  return (
    <div
      className={`glass-panel flex flex-col justify-between rounded-2xl p-4 ${
        isBuy ? 'border-emerald-500/45' : isFomoTrap ? 'border-rose-500/35' : ''
      }`}
    >
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Flame
                className={`h-4 w-4 ${
                  isBuy ? 'text-emerald-400' : isFomoTrap ? 'text-rose-400' : 'text-fuchsia-400'
                }`}
              />
              <h3 className="text-base font-black text-white">{signal.marketName}</h3>
              <span className="text-xs text-slate-400">{signal.baseFaName}</span>
            </div>
            <div className="font-mono-num mt-1 text-sm font-bold text-white">
              {formatPrice(signal.currentPrice, signal.quoteSymbol)}{' '}
              <span
                className={`text-xs ${
                  signal.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                ({formatPct(signal.change24hPct)})
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <span
              className={`rounded-xl border px-3 py-1 text-xs font-extrabold ${
                isBuy
                  ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                  : isFomoTrap
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-200'
                    : 'border-slate-700 bg-slate-800/90 text-slate-300'
              }`}
            >
              {m?.pumpStageFa || (isBuy ? 'شکار پامپ تاییدشده' : 'در حال رصد')}
            </span>
            {signal.securityReport && (
              <span
                className={`rounded-lg border px-2 py-0.5 text-[10px] font-extrabold ${
                  signal.securityReport.securityScore >= 80
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : signal.securityReport.securityScore >= 60
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                }`}
              >
                ANTI-RUG: {signal.securityReport.securityScore}/100
              </span>
            )}
          </div>
        </div>

        {/* Meme Pump Telemetry */}
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-950/80 p-2.5 text-[11px]">
          <div>
            <span className="text-slate-400">اصلاح از سقف اخیر:</span>
            <div className="font-mono-num font-bold text-cyan-300">
              -{m?.drawdownFromRecentHighPct ?? 0}٪ (فاصله کف)
            </div>
          </div>
          <div>
            <span className="text-slate-400">جهش حجم (پامپ):</span>
            <div className="font-mono-num font-bold text-fuchsia-300">
              {m?.volumeSurgeMultiple ?? t.volumeRatio}x برابر میانگین
            </div>
          </div>
          <div>
            <span className="text-slate-400">شتاب / RSI(14):</span>
            <div className="font-mono-num font-bold text-amber-200">
              {formatPct(m?.pumpVelocityPct ?? 0)} | {t.rsi14.toFixed(1)}
            </div>
          </div>
          <div>
            <span className="text-slate-400">کف حمایتی معتبر:</span>
            <div className="font-mono-num font-semibold text-emerald-300">
              {formatPrice(t.supportLevel, signal.quoteSymbol)}
            </div>
          </div>
          <div>
            <span className="text-slate-400">مقاومت هدف اول:</span>
            <div className="font-mono-num font-semibold text-amber-300">
              {formatPrice(t.resistanceLevel, signal.quoteSymbol)}
            </div>
          </div>
          <div>
            <span className="text-slate-400">اسپرد / کارمزد کل:</span>
            <div className="font-mono-num font-semibold text-slate-200">
              {c.spreadPct}٪ / {c.totalFrictionPct}٪
            </div>
          </div>
        </div>

        {/* Analytical Explanations */}
        <div className="mt-2.5 space-y-1 text-xs">
          {signal.reasonsFa.slice(0, 3).map((r, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{r}</span>
            </div>
          ))}
          {signal.rejectionReasonsFa.map((rej, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-rose-300">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{rej}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Exit Plan When Grown */}
      <div className="mt-3 border-t border-slate-800 pt-3">
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg bg-rose-500/10 p-2">
            <div className="text-rose-300">حد ضرر کف (SL)</div>
            <div className="font-mono-num font-bold text-white">
              {formatPrice(signal.stopLoss, signal.quoteSymbol)}
            </div>
          </div>
          <div className="rounded-lg bg-emerald-500/10 p-2">
            <div className="text-emerald-300">فروش ۵۰٪ اول (TP1)</div>
            <div className="font-mono-num font-bold text-white">
              {formatPrice(signal.takeProfit1, signal.quoteSymbol)}
            </div>
          </div>
          <div className="rounded-lg bg-fuchsia-500/15 p-2">
            <div className="text-fuchsia-200">فروش اوج پامپ (TP2)</div>
            <div className="font-mono-num font-bold text-white">
              {formatPrice(signal.takeProfit2, signal.quoteSymbol)}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs text-slate-300">
            <ShieldCheck className="h-4 w-4 text-fuchsia-400" />
            <span>
              R:R خالص: <strong className="text-white">{c.netRiskRewardRatio}</strong> | امتیاز پامپ:{' '}
              <strong className="text-fuchsia-300">{signal.confidenceScore}/100</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={onExecutePaper}
            className="rounded-xl border border-fuchsia-500/50 bg-fuchsia-500/20 px-3 py-1.5 text-xs font-extrabold text-fuchsia-200 hover:bg-fuchsia-500/30"
          >
            ورود آزمایشی میم‌کوین
          </button>
        </div>
      </div>
    </div>
  );
};
