import React from 'react';
import {
  Activity,
  AlertOctagon,
  BarChart3,
  CheckCircle2,
  Coins,
  Cpu,
  Download,
  KeyRound,
  PauseCircle,
  PlayCircle,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react';
import { EquityChartPoint, ModuleId, PlatformSnapshot } from '../../shared/types';
import {
  formatCompactIrt,
  formatPct,
  formatPrice,
  formatTimeFa,
  getBotStatusBadge,
} from '../utils/format';

export type NavTabId =
  | 'HOME'
  | 'ANTI_RUG'
  | 'GOLD'
  | 'MEME'
  | 'SPOT_LEVERAGE'
  | 'SIGNALS'
  | 'SETTINGS'
  | 'REPORTS_HISTORY'
  | 'API_STATUS';

interface Props {
  snapshot: PlatformSnapshot;
  busyAction: string | null;
  onNavigate: (tab: NavTabId) => void;
  onScanNow: () => void;
  onOpenConnectBit24: () => void;
  onStartPaperTrading: () => void;
  onRequestLiveTrading: () => void;
  onTogglePauseNewTrades: (paused: boolean) => void;
  onResetCircuitBreaker: () => void;
  onOpenEmergencyStop: () => void;
  onDownloadCsv: () => void;
  onClosePosition: (id: string) => void;
  onExecutePaperSignal: (signalId: string) => void;
  onToggleModule: (mod: ModuleId, enabled: boolean, ackLev?: boolean) => void;
}

export const HomeOverview: React.FC<Props> = ({
  snapshot,
  busyAction,
  onNavigate,
  onScanNow,
  onOpenConnectBit24,
  onStartPaperTrading,
  onRequestLiveTrading,
  onTogglePauseNewTrades,
  onResetCircuitBreaker,
  onOpenEmergencyStop,
  onDownloadCsv,
  onClosePosition,
  onExecutePaperSignal,
}) => {
  const {
    verifiedWallet,
    circuitBreaker,
    goldAllocatedIrt,
    cryptoAllocatedIrt,
    totalEngagedIrt,
    currentOpenRiskPct,
    realizedPnlTotalIrt,
    unrealizedPnlTotalIrt,
    totalFeesPaidAllIrt,
    isPnlSimulationEstimated,
    totalWinningTrades,
    totalLosingTrades,
    dailyLossLimitReached,
    emergencyStopped,
    periodSummaries,
    performanceCurve,
    reports,
    signals,
    openPositions,
    settings,
    health,
    updatedAt,
  } = snapshot;

  const overallBotStateLabel = emergencyStopped
    ? 'متوقف اضطراری'
    : settings.environmentMode === 'LIVE' &&
        settings.liveTradingConfirmedThisSession &&
        health.bit24ConnectionState === 'CONNECTED_VERIFIED'
      ? 'واقعی (LIVE)'
      : settings.environmentMode === 'PAPER'
        ? settings.pauseNewTrades
          ? 'آزمایشی (ورود جدید متوقف)'
          : 'آزمایشی (Paper Trading)'
        : 'متوقف / فقط تحلیل';

  const netTotalPnlIrt = realizedPnlTotalIrt + unrealizedPnlTotalIrt;

  return (
    <div className="space-y-4">
      {/* Honesty & Risk Principle Banner */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-100">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="leading-relaxed">
          <strong className="font-bold text-amber-300">شفافیت ریسک و تفکیک داده:</strong> هیچ سودی در
          بازار تضمین‌شده نیست و کف قطعی یا پامپ آینده پیش‌بینی‌پذیر مطلق نیست. موجودی واقعی فقط پس از
          تأیید رسمی API بیت‌۲۴ نمایش داده می‌شود و نتایج آزمایشی (Paper) با برچسب روشن از سود واقعی جدا شده‌اند.
        </p>
      </div>

      {/* Phantom Dip Hunter Pro — ANTI-RUG & SMART SECURITY Quick Access Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/35 bg-gradient-to-l from-emerald-950/35 via-slate-900/95 to-slate-900/95 px-4 py-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-black text-emerald-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>Phantom Dip Hunter Pro • ماژول ANTI-RUG &amp; SMART SECURITY فعال</span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
              DEMO / Paper Trading (معامله واقعی قفل)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
            <span>
              بررسی‌شده: <strong className="text-white">{snapshot.antiRug.checkedTokensCount}</strong>
            </span>
            <span>
              مشکوک: <strong className="text-amber-300">{snapshot.antiRug.suspiciousTokensCount}</strong>
            </span>
            <span>
              خرید مسدودشده: <strong className="text-rose-300">{snapshot.antiRug.blockedBuysCount}</strong>
            </span>
            <span>استراتژی شکار پامپ/کف + فروش پله‌ای (TP1/TP2): فعال و حفظ‌شده</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('ANTI_RUG')}
          className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-400"
        >
          صفحه ANTI-RUG SECURITY ←
        </button>
      </div>

      {/* Circuit Breaker Alert if Tripped */}
      {circuitBreaker.tripped && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-500/50 bg-rose-600/20 p-3.5 text-xs text-rose-100">
          <div>
            <strong className="text-rose-300">توقف خودکار محافظتی (Circuit Breaker) فعال شد: </strong>
            <span>{circuitBreaker.reasonFa}</span>
          </div>
          <button
            type="button"
            onClick={onResetCircuitBreaker}
            className="rounded-xl bg-rose-500 px-3 py-1.5 font-black text-slate-950 hover:bg-rose-400"
          >
            بررسی شد • بازنشانی قفل
          </button>
        </div>
      )}

      {/* Stage 6 Home Telemetry Grid (8 Explicit Financial & Status Metrics) */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {/* 1. Confirmed Real Account Balance ONLY when verified by API */}
        <div className="glass-panel rounded-2xl p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>موجودی واقعی حساب بیت‌۲۴</span>
            <Wallet className="h-4 w-4 text-emerald-400" />
          </div>
          {verifiedWallet.confirmedByOfficialApi && verifiedWallet.totalIrt !== null ? (
            <>
              <div className="font-mono-num mt-1 text-base font-black text-emerald-300 sm:text-lg">
                {formatCompactIrt(verifiedWallet.totalIrt)}
              </div>
              <div className="mt-1 text-[10px] text-emerald-200/80">
                تأییدشده از API رسمی • معادل {verifiedWallet.totalUsdt?.toFixed(2)} USDT
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 text-sm font-extrabold text-amber-300">
                تأیید نشده (کلید متصل نیست)
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                نمایش موجودی واقعی فقط پس از تأیید رسمی API انجام می‌شود
              </div>
            </>
          )}
        </div>

        {/* 2. Separate Allocated Capital: Crypto vs Gold */}
        <div className="glass-panel rounded-2xl p-3.5">
          <div className="text-xs text-slate-400">سرمایه تخصیص‌یافته (رمزارز / طلا)</div>
          <div className="font-mono-num mt-1 text-xs font-black text-cyan-300 sm:text-sm">
            رمزارز: {formatCompactIrt(cryptoAllocatedIrt)}
          </div>
          <div className="font-mono-num mt-0.5 text-xs font-black text-amber-300 sm:text-sm">
            طلا: {formatCompactIrt(goldAllocatedIrt)}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            درگیر: {formatCompactIrt(totalEngagedIrt)} • ریسک باز: {currentOpenRiskPct}٪ از سقف{' '}
            {settings.maxTotalOpenRiskPct}٪
          </div>
        </div>

        {/* 3. Realized vs Unrealized PnL Separately */}
        <div className="glass-panel rounded-2xl p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>سود/زیان تحقق‌یافته و تحقق‌نیافته</span>
          </div>
          <div
            className={`font-mono-num mt-1 text-xs font-black sm:text-sm ${
              realizedPnlTotalIrt >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            تحقق‌یافته: {realizedPnlTotalIrt >= 0 ? '+' : ''}
            {formatCompactIrt(realizedPnlTotalIrt)}
          </div>
          <div
            className={`font-mono-num mt-0.5 text-xs font-black sm:text-sm ${
              unrealizedPnlTotalIrt >= 0 ? 'text-cyan-300' : 'text-rose-300'
            }`}
          >
            تحقق‌نیافته (باز): {unrealizedPnlTotalIrt >= 0 ? '+' : ''}
            {formatCompactIrt(unrealizedPnlTotalIrt)}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            سقف توقف زیان روزانه: {settings.dailyMaxLossPct}٪
            {dailyLossLimitReached && (
              <span className="mr-1 font-bold text-rose-400">• متوقف!</span>
            )}
          </div>
        </div>

        {/* 4. Fees & Labeled Net Profit + Win/Loss + Bot/API Status */}
        <div className="glass-panel rounded-2xl p-3.5">
          <div className="flex items-center justify-between gap-1 text-xs">
            <span className="text-slate-400">سود خالص و کارمزدها</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                isPnlSimulationEstimated
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'bg-emerald-500/20 text-emerald-200'
              }`}
            >
              {isPnlSimulationEstimated ? 'تخمینی (آزمایشی)' : 'قطعی (API)'}
            </span>
          </div>
          <div
            className={`font-mono-num mt-1 text-sm font-black ${
              netTotalPnlIrt >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            خالص: {netTotalPnlIrt >= 0 ? '+' : ''}
            {formatCompactIrt(netTotalPnlIrt)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-300">
            کارمزد کل: {formatCompactIrt(totalFeesPaidAllIrt)} • موفق:{' '}
            <strong className="text-emerald-400">{totalWinningTrades}</strong> / ناموفق:{' '}
            <strong className="text-rose-400">{totalLosingTrades}</strong>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            وضعیت ربات: <strong className="text-white">{overallBotStateLabel}</strong> • بروزرسانی:{' '}
            {formatTimeFa(updatedAt)}
          </div>
        </div>
      </div>

      {/* ALL 10 Primary Buttons Required by Stage 6 */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-white">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            ۱۰ فرمان اصلی مدیریت هوشمند (مرحله ششم)
          </h2>
          <div className="text-[11px] text-slate-400">
            {busyAction ? (
              <span className="animate-pulse font-bold text-amber-300">در حال اجرای دستور...</span>
            ) : (
              <span>
                وضعیت API:{' '}
                <strong
                  className={
                    health.bit24ConnectionState === 'CONNECTED_VERIFIED'
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                  }
                >
                  {health.bit24ConnectionState === 'CONNECTED_VERIFIED'
                    ? 'متصل و تأییدشده'
                    : 'حالت امن آزمایشی'}
                </strong>
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <CommandButton
            icon={<RefreshCw className="h-4 w-4 text-cyan-300" />}
            label="۱. شروع اسکن بازار"
            sub="تحلیل رمزارزها و طلا"
            onClick={onScanNow}
            tone="cyan"
          />
          <CommandButton
            icon={<Activity className="h-4 w-4 text-emerald-300" />}
            label="۲. مشاهده سیگنال‌ها"
            sub={`${signals.filter((s) => s.action === 'BUY_CONFIRMED').length} فرصت تاییدشده`}
            onClick={() => onNavigate('SIGNALS')}
            tone="default"
          />
          <CommandButton
            icon={<PlayCircle className="h-4 w-4 text-cyan-300" />}
            label="۳. شروع معاملات آزمایشی"
            sub="Paper Trading بدون پول واقعی"
            onClick={onStartPaperTrading}
            tone="cyan"
          />
          <CommandButton
            icon={<Radio className="h-4 w-4 text-emerald-300" />}
            label="۴. شروع معاملات واقعی"
            sub="فقط پس از تأیید صریح کاربر"
            onClick={onRequestLiveTrading}
            tone="emerald"
          />
          <CommandButton
            icon={<PauseCircle className="h-4 w-4 text-amber-300" />}
            label={settings.pauseNewTrades ? '۵. ادامه معاملات جدید' : '۵. توقف معاملات جدید'}
            sub={
              settings.pauseNewTrades
                ? 'در حال حاضر ورود جدید متوقف است'
                : 'توقف خرید جدید بدون بستن بازها'
            }
            onClick={() => onTogglePauseNewTrades(!settings.pauseNewTrades)}
            tone="warn"
          />
          <CommandButton
            icon={<AlertOctagon className="h-4 w-4 text-white" />}
            label="۶. توقف اضطراری"
            sub="توقف فوری سفارش جدید"
            onClick={onOpenEmergencyStop}
            tone="danger"
          />
          <CommandButton
            icon={<Sliders className="h-4 w-4 text-purple-300" />}
            label="۷. تنظیم ریسک"
            sub="۰.۵٪ معامله • ۲٪ کل • ۳ باز"
            onClick={() => onNavigate('SETTINGS')}
            tone="default"
          />
          <CommandButton
            icon={<BarChart3 className="h-4 w-4 text-amber-300" />}
            label="۸. گزارش معاملات"
            sub="روزانه، هفتگی، ماهانه و تفکیکی"
            onClick={() => onNavigate('REPORTS_HISTORY')}
            tone="gold"
          />
          <CommandButton
            icon={<KeyRound className="h-4 w-4 text-cyan-300" />}
            label="۹. اتصال و بررسی API"
            sub="گاوصندوق سرور و پینگ بیت‌۲۴"
            onClick={onOpenConnectBit24}
            tone="default"
          />
          <CommandButton
            icon={<Download className="h-4 w-4 text-emerald-300" />}
            label="۱۰. خروجی CSV از تاریخچه"
            sub="دانلود اکسل معاملات و سیگنال‌ها"
            onClick={onDownloadCsv}
            tone="emerald"
          />
        </div>
      </section>

      {/* Independent Crypto & Gold Modules Status */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-white">
            <Cpu className="h-4 w-4 text-amber-400" />
            وضعیت دو ماژول مستقل اصلی (۱. رمزارز بیت‌۲۴ • ۲. طلای دیجیتال بیت‌۲۴)
          </h2>
          <span className="text-[11px] text-slate-400">
            حداکثر {settings.maxTotalOpenPositions} موقعیت باز هم‌زمان
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BotModuleSummaryCard
            report={reports.SPOT_CRYPTO}
            subtitle="ماژول ۱: رمزارزهای اصلی در بیت‌۲۴"
            accent="cyan"
            onOpenDetail={() => onNavigate('SPOT_LEVERAGE')}
          />
          <BotModuleSummaryCard
            report={reports.DIGITAL_GOLD}
            subtitle="ماژول ۲: طلای دیجیتال PAXG / XAUT"
            accent="gold"
            onOpenDetail={() => onNavigate('GOLD')}
          />
          <BotModuleSummaryCard
            report={reports.MEME_HUNTER}
            subtitle="رادار اسپات میم‌کوین‌های بیت‌۲۴"
            accent="fuchsia"
            onOpenDetail={() => onNavigate('MEME')}
          />
          <BotModuleSummaryCard
            report={reports.LEVERAGE_MARGIN}
            subtitle="اهرم و فیوچرز (نسخه اول خاموش)"
            accent="slate"
            onOpenDetail={() => onNavigate('SPOT_LEVERAGE')}
          />
        </div>
      </section>

      {/* Performance Chart + Daily / Weekly / Monthly Summary */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-white">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            نمودار عملکرد پرتفوی و خلاصه گزارش روزانه، هفتگی و ماهانه
          </h2>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
            {isPnlSimulationEstimated ? 'داده‌های شبیه‌سازی آزمایشی (Paper)' : 'داده‌های واقعی تاییدشده'}
          </span>
        </div>

        <EquityMiniSvgChart points={performanceCurve} />

        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {[periodSummaries.daily, periodSummaries.weekly, periodSummaries.monthly].map((p) => (
            <div
              key={p.periodId}
              className="rounded-xl border border-slate-800 bg-slate-950/75 p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">{p.labelFa}</span>
                <span className="text-[10px] text-slate-400">
                  {p.winningTrades} برد / {p.losingTrades} باخت
                </span>
              </div>
              <div
                className={`font-mono-num mt-1.5 text-sm font-black ${
                  p.netPnlIrt >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                خالص: {p.netPnlIrt >= 0 ? '+' : ''}
                {formatCompactIrt(p.netPnlIrt)}
              </div>
              <div className="mt-1 flex flex-wrap justify-between text-[10px] text-slate-400">
                <span>تحقق‌یافته: {formatCompactIrt(p.realizedPnlIrt)}</span>
                <span>کارمزد: {formatCompactIrt(p.feesPaidIrt)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Signals Quick List & Open Positions */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top Ranked Signals List */}
        <section className="glass-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-white">
              فهرست برترین سیگنال‌های رتبه‌بندی‌شده ({signals.length})
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('SIGNALS')}
              className="text-xs font-semibold text-cyan-300 hover:underline"
            >
              همه سیگنال‌ها و دلایل رد ←
            </button>
          </div>

          <div className="space-y-2">
            {signals.slice(0, 5).map((sig) => {
              const isBuy = sig.action === 'BUY_CONFIRMED';
              return (
                <div
                  key={sig.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-white">{sig.marketName}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-amber-300">
                        امتیاز {sig.confidenceScore}/100
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          isBuy
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : sig.action === 'AVOID_UNFAVORABLE'
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isBuy
                          ? 'فرصت ورود'
                          : sig.action === 'AVOID_UNFAVORABLE'
                            ? 'رد معامله'
                            : 'رصد'}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                      {sig.summaryFa}
                    </div>
                  </div>

                  {isBuy && (
                    <button
                      type="button"
                      onClick={() => onExecutePaperSignal(sig.id)}
                      className="flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/25"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      تست آزمایشی
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Open Positions Section */}
        <section className="glass-panel rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-white">
              موقعیت‌های باز فعلی ({openPositions.length} از {settings.maxTotalOpenPositions})
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('REPORTS_HISTORY')}
              className="text-xs font-semibold text-cyan-300 hover:underline"
            >
              گزارش کامل ←
            </button>
          </div>

          {openPositions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700/80 bg-slate-900/50 p-5 text-center text-xs text-slate-400">
              در حال حاضر موقعیت بازی وجود ندارد. برای تست بدون پول واقعی روی دکمه{' '}
              <strong className="text-cyan-300">«۳. شروع معاملات آزمایشی»</strong> بزنید.
            </div>
          ) : (
            <div className="space-y-2.5">
              {openPositions.map((pos) => (
                <div
                  key={pos.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/80 bg-slate-900/90 p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-white">{pos.marketName}</span>
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                        {pos.module === 'DIGITAL_GOLD'
                          ? 'طلا'
                          : pos.module === 'MEME_HUNTER'
                            ? 'میم‌کوین'
                            : 'رمزارز اسپات'}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          pos.mode === 'LIVE'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-cyan-500/20 text-cyan-300'
                        }`}
                      >
                        {pos.mode === 'LIVE' ? 'واقعی تاییدشده' : 'آزمایشی (Paper)'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      ورود: {formatPrice(pos.entryPrice, pos.quoteSymbol)} • فعلی:{' '}
                      {formatPrice(pos.currentPrice, pos.quoteSymbol)} • حد ضرر:{' '}
                      <span className="text-rose-300">
                        {formatPrice(pos.stopLoss, pos.quoteSymbol)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <div
                      className={`font-mono-num text-sm font-extrabold ${
                        pos.unrealizedPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatPct(pos.unrealizedPnlPct)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onClosePosition(pos.id)}
                      className="flex items-center gap-1 rounded-xl border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-500/30"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      بستن دستی
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export const EquityMiniSvgChart: React.FC<{ points: EquityChartPoint[] }> = ({ points }) => {
  if (!points || points.length === 0) return null;
  const values = points.map((p) => p.equityIrt);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = Math.max(100_000, maxVal - minVal);
  const w = 600;
  const h = 110;

  const coords = points.map((pt, idx) => {
    const x = points.length === 1 ? w / 2 : (idx / (points.length - 1)) * (w - 24) + 12;
    const y = h - 16 - ((pt.equityIrt - minVal) / span) * (h - 32);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const isUp = points[points.length - 1].equityIrt >= points[0].equityIrt;
  const strokeColor = isUp ? '#34d399' : '#fb7185';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>روند ارزش کل سبد تخصیص‌یافته (رمزارز + طلا)</span>
        <span className="font-mono-num text-slate-200">
          فعلی: {formatCompactIrt(points[points.length - 1].equityIrt)}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full overflow-visible">
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coords.join(' ')}
        />
      </svg>
    </div>
  );
};

const BotModuleSummaryCard: React.FC<{
  report: PlatformSnapshot['reports']['DIGITAL_GOLD'];
  subtitle: string;
  accent: 'gold' | 'cyan' | 'fuchsia' | 'slate';
  onOpenDetail: () => void;
}> = ({ report, subtitle, accent, onOpenDetail }) => {
  const badge = getBotStatusBadge(report.status);
  const borderCls =
    accent === 'gold'
      ? 'border-amber-500/35 bg-gradient-to-br from-amber-500/10 to-slate-900/90'
      : accent === 'fuchsia'
        ? 'border-fuchsia-500/35 bg-gradient-to-br from-fuchsia-500/12 to-slate-900/90'
        : accent === 'cyan'
          ? 'border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-slate-900/90'
          : 'border-slate-700/80 bg-slate-900/80';

  return (
    <div className={`rounded-2xl border p-3.5 ${borderCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-extrabold text-white sm:text-sm">{report.titleFa}</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.colorClass}`}
        >
          {badge.labelFa}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-slate-950/60 p-2">
          <div className="text-[10px] text-slate-400">سرمایه بخش</div>
          <div className="font-mono-num mt-0.5 font-bold text-slate-100">
            {formatCompactIrt(report.allocatedCapitalIrt)}
          </div>
        </div>
        <div className="rounded-xl bg-slate-950/60 p-2">
          <div className="text-[10px] text-slate-400">سود/زیان روزانه</div>
          <div
            className={`font-mono-num mt-0.5 font-bold ${
              report.dailyTotalPnlIrt >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatPct(report.dailyPnlPct)}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          باز: <strong className="text-white">{report.openPositionsCount}</strong> | کل:{' '}
          <strong className="text-white">{report.totalTrades}</strong>
        </span>
        <button
          type="button"
          onClick={onOpenDetail}
          className="font-bold text-amber-300 hover:underline"
        >
          جزئیات ←
        </button>
      </div>
    </div>
  );
};

const CommandButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
  tone: 'default' | 'gold' | 'cyan' | 'fuchsia' | 'emerald' | 'warn' | 'danger';
}> = ({ icon, label, sub, onClick, tone }) => {
  const toneCls =
    tone === 'danger'
      ? 'border-red-500/80 bg-red-600/85 text-white hover:bg-red-500'
      : tone === 'gold'
        ? 'border-amber-500/40 bg-amber-500/12 text-amber-100 hover:bg-amber-500/20'
        : tone === 'fuchsia'
          ? 'border-fuchsia-500/45 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25'
          : tone === 'cyan'
            ? 'border-cyan-500/40 bg-cyan-500/12 text-cyan-100 hover:bg-cyan-500/20'
            : tone === 'emerald'
              ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-100 hover:bg-emerald-500/20'
              : tone === 'warn'
                ? 'border-orange-500/35 bg-orange-500/10 text-orange-100 hover:bg-orange-500/20'
                : 'border-slate-700/80 bg-slate-900/90 text-slate-100 hover:border-slate-500';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[58px] items-center gap-2.5 rounded-xl border p-2.5 text-right transition active:scale-[0.98] ${toneCls}`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/25">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-extrabold">{label}</div>
        <div className="truncate text-[10px] opacity-80">{sub}</div>
      </div>
    </button>
  );
};
