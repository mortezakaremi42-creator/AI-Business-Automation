import React, { useState } from 'react';
import {
  AlertTriangle,
  Lock,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { ModuleId, PlatformSnapshot } from '../../shared/types';
import {
  formatCompactIrt,
  formatPct,
  formatPrice,
  getBotStatusBadge,
} from '../utils/format';

interface Props {
  snapshot: PlatformSnapshot;
  onStartCryptoAnalysis: () => void;
  onToggleModule: (mod: ModuleId, enabled: boolean, ackLeverage?: boolean) => void;
  onExecutePaperSignal: (signalId: string) => void;
}

export const SpotAndLeverageView: React.FC<Props> = ({
  snapshot,
  onStartCryptoAnalysis,
  onToggleModule,
  onExecutePaperSignal,
}) => {
  const [ackLeverage, setAckLeverage] = useState(
    snapshot.settings.modules.LEVERAGE_MARGIN.userAcknowledgedLeverageRisk
  );

  const spotSignals = snapshot.signals.filter((s) => s.module === 'SPOT_CRYPTO');
  const levSignals = snapshot.signals.filter((s) => s.module === 'LEVERAGE_MARGIN');
  const spotReport = snapshot.reports.SPOT_CRYPTO;
  const levReport = snapshot.reports.LEVERAGE_MARGIN;
  const spotEnabled = snapshot.settings.modules.SPOT_CRYPTO.enabled;
  const levEnabled = snapshot.settings.modules.LEVERAGE_MARGIN.enabled;

  return (
    <div className="space-y-5">
      {/* SECTION 1: SPOT CRYPTO BOT */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-cyan-400" />
              <h2 className="text-base font-black text-white">
                بخش ۱: ربات ارز دیجیتال اسپات بیت‌۲۴
              </h2>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                  getBotStatusBadge(spotReport.status).colorClass
                }`}
              >
                {getBotStatusBadge(spotReport.status).labelFa}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              اسکن خودکار جفت‌ارزهای اسپات بیت‌۲۴ (BTC، ETH، SOL، TON، XRP) با بودجه کاملاً جدا از طلا ({formatCompactIrt(spotReport.allocatedCapitalIrt)}) و ریسک کنترل‌شده {snapshot.settings.modules.SPOT_CRYPTO.risk.riskPerTradePct}٪ در هر معامله.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStartCryptoAnalysis}
              className="flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-xs font-extrabold text-cyan-200 hover:bg-cyan-500/25"
            >
              <RefreshCw className="h-4 w-4" />
              اسکن مجدد کریپتو
            </button>
            {spotEnabled ? (
              <button
                type="button"
                onClick={() => onToggleModule('SPOT_CRYPTO', false)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/20 px-3 py-2 text-xs font-extrabold text-rose-200"
              >
                <PauseCircle className="h-4 w-4" />
                توقف ربات ارز دیجیتال
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onToggleModule('SPOT_CRYPTO', true)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-3 py-2 text-xs font-extrabold text-emerald-200"
              >
                <PlayCircle className="h-4 w-4" />
                شروع ربات ارز دیجیتال
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {spotSignals.map((sig) => (
            <div
              key={sig.id}
              className="rounded-xl border border-slate-700/80 bg-slate-950/75 p-3.5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-black text-white">{sig.marketName}</span>
                  <span className="mr-2 text-xs text-slate-400">{sig.baseFaName}</span>
                </div>
                <span
                  className={`rounded-lg px-2.5 py-0.5 text-[11px] font-bold ${
                    sig.action === 'BUY_CONFIRMED'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {sig.action === 'BUY_CONFIRMED' ? 'خرید تأییدشده' : 'فیلتر / در انتظار'}
                </span>
              </div>

              <div className="font-mono-num mt-1.5 text-xs text-slate-200">
                قیمت: <strong>{formatPrice(sig.currentPrice, sig.quoteSymbol)}</strong> (
                <span className={sig.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {formatPct(sig.change24hPct)}
                </span>
                ) • RSI: {sig.technicals.rsi14.toFixed(1)} • R:R خالص:{' '}
                <strong>{sig.costs.netRiskRewardRatio}</strong>
              </div>

              <p className="mt-1.5 text-xs text-slate-400">{sig.summaryFa}</p>

              <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px]">
                <span className="text-slate-400">
                  SL: <strong className="text-rose-300">{formatPrice(sig.stopLoss, sig.quoteSymbol)}</strong>{' '}
                  | TP2:{' '}
                  <strong className="text-emerald-300">
                    {formatPrice(sig.takeProfit2, sig.quoteSymbol)}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => onExecutePaperSignal(sig.id)}
                  className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 font-bold text-cyan-200 hover:bg-cyan-500/25"
                >
                  تست آزمایشی
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 3: LEVERAGE / MARGIN BOT (DISABLED BY DEFAULT) */}
      <section className="glass-panel rounded-2xl border-rose-500/25 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-rose-400" />
              <h2 className="text-base font-black text-white">
                بخش ۳: ربات معاملات اهرم‌دار مارجین (پیش‌فرض خاموش)
              </h2>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                  getBotStatusBadge(levReport.status).colorClass
                }`}
              >
                {getBotStatusBadge(levReport.status).labelFa}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              مستندات رسمی CAPI v2 بیت‌۲۴ (<code className="text-amber-300">/pro/capi/v2/margin-orders/orders/submit</code>) از ثبت سفارش اهرم‌دار{' '}
              <strong>صرفاً به شکل Limit (نوع ۰)</strong> روی نمادهای مجاز پشتیبانی می‌کند. به دلیل ریسک لیکویید شدن (آستانه ۱۰٪ بیت‌۲۴) و کارمزد ساعتی تمدید اعتبار (HRL)، این بخش به‌طور پیش‌فرض غیرفعال است.
            </p>
          </div>

          {levEnabled && (
            <button
              type="button"
              onClick={() => onToggleModule('LEVERAGE_MARGIN', false)}
              className="flex items-center gap-1.5 rounded-xl border border-rose-500/60 bg-rose-600/80 px-3.5 py-2 text-xs font-extrabold text-white"
            >
              <PauseCircle className="h-4 w-4" />
              خاموش کردن فوری بخش اهرم‌دار
            </button>
          )}
        </div>

        {!levEnabled && (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <label className="flex cursor-pointer items-start gap-2 text-amber-100">
              <input
                type="checkbox"
                checked={ackLeverage}
                onChange={(e) => setAckLeverage(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 accent-amber-500"
              />
              <span>
                <AlertTriangle className="ml-1 inline h-4 w-4 text-amber-400" />
                از ریسک بالای معاملات اهرم‌دار، کارمزد ساعتی وام (HRL) و احتمال لیکویید شدن آگاه هستم
                و می‌خواهم تحلیل/تست محافظه‌کارانه (حداکثر اهرم{' '}
                {snapshot.settings.modules.LEVERAGE_MARGIN.risk.maxLeverage || 2}x) فعال شود.
              </span>
            </label>
            <div className="mt-2.5 flex justify-end">
              <button
                type="button"
                disabled={!ackLeverage}
                onClick={() => onToggleModule('LEVERAGE_MARGIN', true, true)}
                className="rounded-xl border border-amber-500/50 bg-amber-500/20 px-3.5 py-2 text-xs font-extrabold text-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                فعال‌سازی محتاطانه بخش اهرم‌دار
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 grid gap-2.5 md:grid-cols-2">
          {levSignals.slice(0, 4).map((sig) => (
            <div
              key={sig.id}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">
                  {sig.marketName} (سقف اهرم مجاز ربات: {sig.leverage}x)
                </span>
                <span className="text-[11px] text-slate-400">
                  لیکوییدی تخمینی:{' '}
                  <strong className="text-rose-300">
                    {sig.liquidationPrice
                      ? formatPrice(sig.liquidationPrice, sig.quoteSymbol)
                      : '—'}
                  </strong>
                </span>
              </div>
              <p className="mt-1 text-slate-400">{sig.summaryFa}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
