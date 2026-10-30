import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Scale,
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
  onStartGoldAnalysis: () => void;
  onToggleGoldBot: (enabled: boolean) => void;
  onExecutePaperSignal: (signalId: string) => void;
}

export const GoldEngineView: React.FC<Props> = ({
  snapshot,
  onStartGoldAnalysis,
  onToggleGoldBot,
  onExecutePaperSignal,
}) => {
  const goldSignals = snapshot.signals.filter((s) => s.module === 'DIGITAL_GOLD');
  const goldReport = snapshot.reports.DIGITAL_GOLD;
  const goldEnabled = snapshot.settings.modules.DIGITAL_GOLD.enabled;
  const badge = getBotStatusBadge(goldReport.status);

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="gold-card rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-black text-amber-200">
                ماژول اختصاصی و مستقل طلا (PAXG / XAUT در اسپات بیت‌۲۴)
              </h2>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${badge.colorClass}`}
              >
                {badge.labelFa}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/85">
              تحلیل چندگانه EMA 9/21/50، تایم‌فریم ۴ ساعته، شاخص RSI، نوسان ATR(14)، اسپرد دفتر سفارشات
              بیت‌۲۴ و مقایسه زنده با انس جهانی طلا (<span className="font-mono-num">XAU/USD: ${snapshot.globalGoldUsd.toFixed(2)}</span>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onStartGoldAnalysis}
              className="flex items-center gap-1.5 rounded-xl border border-amber-400/50 bg-amber-500/20 px-3.5 py-2.5 text-xs font-extrabold text-amber-200 hover:bg-amber-500/30"
            >
              <RefreshCw className="h-4 w-4" />
              بروزرسانی تحلیل طلا
            </button>

            {goldEnabled ? (
              <button
                type="button"
                onClick={() => onToggleGoldBot(false)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-500/20 px-3.5 py-2.5 text-xs font-extrabold text-rose-200 hover:bg-rose-500/30"
              >
                <PauseCircle className="h-4 w-4" />
                توقف ماژول طلا
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onToggleGoldBot(true)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/20 px-3.5 py-2.5 text-xs font-extrabold text-emerald-200 hover:bg-emerald-500/30"
              >
                <PlayCircle className="h-4 w-4" />
                فعال‌سازی ماژول طلا
              </button>
            )}
          </div>
        </div>

        {/* Stage 4 Transparent Gold Market & Instrument Audit */}
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-slate-950/75 p-3 text-xs leading-relaxed text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-amber-300">
            <span>نتیجه بررسی بازارهای طلا و وضعیت اتصال API رسمی (مرحله چهارم):</span>
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">
              تفکیک ۱۰۰٪ حساب و PnL طلا از رمزارزها
            </span>
          </div>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-[11px] text-slate-300">
            <li>
              <strong className="text-emerald-300">گزینه الف (فعال از طریق CAPI v2 بیت‌۲۴):</strong>{' '}
              توکن‌های طلای دیجیتال با پشتوانه فیزیکی <code>PAXG</code> (پکس‌گلد) و <code>XAUT</code> (تترگلد) در بازار اسپات بیت‌۲۴ با واحد قیمت تومان (<code>IRT</code>) و تتر (<code>USDT</code>) به صورت ۲۴/۷ قابل تحلیل و سفارش‌گذاری رسمی هستند.
            </li>
            <li>
              <strong className="text-amber-300">گزینه ب (انس جهانی XAU/USD کارگزار فارکس — برچسب: «تکمیل نشده»):</strong>{' '}
              اتصال معاملاتی مستقیم به بروکر فارکس/CFD برای نماد جهانی XAU/USD در این نسخه پیاده‌سازی نشده و ساختگی نیست؛ نرخ XAU/USD صرفاً به عنوان شاخص مرجع تشخیص حباب دلاری توکن‌های طلا نمایش داده می‌شود (بازار جهانی شنبه و یکشنبه تعطیل است).
            </li>
          </ul>
        </div>

        {/* Strict Gold Rules Pill Strip */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <RuleBadge
            title="ریسک هر معامله طلا"
            value={`حداکثر ${snapshot.settings.modules.DIGITAL_GOLD.risk.riskPerTradePct}٪ سرمایه طلا`}
          />
          <RuleBadge
            title="سود و زیان خالص طلا (مجزا)"
            value={`${goldReport.totalNetPnlIrt >= 0 ? '+' : ''}${formatCompactIrt(goldReport.totalNetPnlIrt)}`}
          />
          <RuleBadge
            title="ارز حساب و واحد پایه"
            value={goldReport.quoteCurrency === 'IRT' ? 'تومان (IRT) اسپات بیت‌۲۴' : 'تتر (USDT) اسپات بیت‌۲۴'}
          />
          <RuleBadge
            title="سرمایه مستقل تخصیص‌یافته طلا"
            value={formatCompactIrt(goldReport.allocatedCapitalIrt)}
          />
        </div>
      </div>

      {/* Gold Pair Cards (PAXG/IRT, XAUT/IRT, PAXG/USDT, XAUT/USDT) */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        {goldSignals.map((sig) => (
          <GoldSignalCard
            key={sig.id}
            signal={sig}
            onExecutePaper={() => onExecutePaperSignal(sig.id)}
          />
        ))}
      </div>
    </div>
  );
};

const RuleBadge: React.FC<{ title: string; value: string }> = ({ title, value }) => (
  <div className="rounded-xl border border-amber-500/20 bg-slate-950/65 p-2.5">
    <div className="text-[10px] text-amber-200/70">{title}</div>
    <div className="mt-0.5 text-xs font-extrabold text-white">{value}</div>
  </div>
);

const GoldSignalCard: React.FC<{
  signal: SmartSignal;
  onExecutePaper: () => void;
}> = ({ signal, onExecutePaper }) => {
  const { technicals: t, costs: c, goldComparison: g } = signal;
  const isBuy = signal.action === 'BUY_CONFIRMED';

  return (
    <div className="glass-panel flex flex-col justify-between rounded-2xl p-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-amber-300">{signal.marketName}</h3>
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

          <span
            className={`rounded-xl border px-3 py-1 text-xs font-extrabold ${
              isBuy
                ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                : signal.action === 'AVOID_UNFAVORABLE'
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                  : 'border-slate-600 bg-slate-800/80 text-slate-300'
            }`}
          >
            {isBuy
              ? 'سیگنال خرید تأییدشده'
              : signal.action === 'AVOID_UNFAVORABLE'
                ? 'عدم معامله (فیلتر ریسک)'
                : 'در حال رصد سطوح'}
          </span>
        </div>

        {/* Explicit Product Type, Price Unit & Trading Hours (Stage 4 requirement) */}
        {g && (
          <div className="mt-2.5 space-y-1 rounded-xl border border-slate-800 bg-slate-950/75 p-2.5 text-[11px] text-slate-300">
            <div>
              <strong className="text-amber-300">نوع محصول:</strong> {g.productTypeFa}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <strong className="text-slate-200">واحد قیمت:</strong> {g.priceUnitFa}
              </span>
              <span>
                <strong className="text-slate-200">ارز حساب:</strong> {g.accountCurrencyFa}
              </span>
            </div>
            <div className="flex items-start gap-1 text-slate-400">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <span>{g.tradingHoursFa}</span>
            </div>
          </div>
        )}

        {/* Technical Indicator Matrix including ATR & Multi-Timeframe */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-xl bg-slate-950/75 p-2.5 text-[11px]">
          <div>
            <span className="text-slate-400">روند ۱h / ۴h:</span>
            <div className="font-mono-num font-bold text-slate-200">
              {t.shortTermTrend === 'BULLISH' ? 'صعودی' : t.shortTermTrend === 'BEARISH' ? 'نزولی' : 'خنثی'}{' '}
              / {t.htfTrend === 'BULLISH' ? 'صعودی' : t.htfTrend === 'BEARISH' ? 'نزولی' : 'خنثی'}
            </div>
          </div>
          <div>
            <span className="text-slate-400">نوسان ATR(14):</span>
            <div className="font-mono-num font-bold text-cyan-300">
              {t.atrPct.toFixed(2)}٪ ({formatPrice(t.atr14, signal.quoteSymbol)})
            </div>
          </div>
          <div>
            <span className="text-slate-400">RSI(14) / حجم:</span>
            <div className="font-mono-num font-bold text-amber-200">
              {t.rsi14.toFixed(1)} | {t.volumeRatio.toFixed(2)}x
            </div>
          </div>
          <div>
            <span className="text-slate-400">حمایت معتبر:</span>
            <div className="font-mono-num font-semibold text-emerald-300">
              {formatPrice(t.supportLevel, signal.quoteSymbol)}
            </div>
          </div>
          <div>
            <span className="text-slate-400">مقاومت پیش‌رو:</span>
            <div className="font-mono-num font-semibold text-amber-300">
              {formatPrice(t.resistanceLevel, signal.quoteSymbol)}
            </div>
          </div>
          <div>
            <span className="text-slate-400">اسپرد / کل هزینه:</span>
            <div className="font-mono-num font-semibold text-cyan-300">
              {c.spreadPct}٪ / {c.totalFrictionPct}٪
            </div>
          </div>
        </div>

        {/* Global XAU/USD Comparison Box */}
        {g && (
          <div className="mt-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-amber-100/90">
            <div className="flex flex-wrap items-center justify-between gap-1 font-bold text-amber-300">
              <span className="flex items-center gap-1">
                <Scale className="h-3.5 w-3.5" />
                مقایسه با نرخ مرجع انس جهانی (XAU/USD: ${g.globalXauUsd})
              </span>
              <span className="font-mono-num">
                معادل دلاری توکن: ${g.tokenImpliedUsd} ({formatPct(g.basisVsXauPct)})
              </span>
            </div>
            <p className="mt-1 leading-relaxed text-slate-300">{g.noteFa}</p>
          </div>
        )}

        {/* Reasons or Filter Rejection Explanations */}
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

      {/* Defined SL, TP1, TP2 & Action */}
      <div className="mt-3 border-t border-slate-800 pt-3">
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-lg bg-rose-500/10 p-2">
            <div className="text-rose-300">حد ضرر (SL تخمینی)</div>
            <div className="font-mono-num font-bold text-white">
              {formatPrice(signal.stopLoss, signal.quoteSymbol)}
            </div>
          </div>
          <div className="rounded-lg bg-emerald-500/10 p-2">
            <div className="text-emerald-300">حد سود ۱ (۵۰٪)</div>
            <div className="font-mono-num font-bold text-white">
              {formatPrice(signal.takeProfit1, signal.quoteSymbol)}
            </div>
          </div>
          <div className="rounded-lg bg-emerald-500/15 p-2">
            <div className="text-emerald-200">حد سود ۲ (نهایی)</div>
            <div className="font-mono-num font-bold text-white">
              {formatPrice(signal.takeProfit2, signal.quoteSymbol)}
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-200/80">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
          <span>حد ضرر اجرای دقیق در همان قیمت را تضمین نمی‌کند (احتمال اسلیپیج در نوسان شدید).</span>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs text-slate-300">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <span>
              R:R خالص: <strong className="text-white">{c.netRiskRewardRatio}</strong> | امتیاز
              سیگنال: <strong className="text-amber-300">{signal.confidenceScore}/100</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={onExecutePaper}
            className="rounded-xl border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-xs font-extrabold text-amber-200 hover:bg-amber-500/30"
          >
            ثبت تست آزمایشی (Paper)
          </button>
        </div>
      </div>
    </div>
  );
};
