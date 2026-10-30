import React, { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Droplets,
  Lock,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
  Zap,
} from 'lucide-react';
import {
  CapitalShieldSettings,
  PlatformSnapshot,
  TokenSecurityReport,
} from '../../shared/types';
import { formatFaNum, formatRelativeTimeFa } from '../utils/format';

interface AntiRugSecurityViewProps {
  snapshot: PlatformSnapshot;
  busyAction: string | null;
  onInspectContract: (
    address: string,
    network: 'SOLANA_SPL' | 'ETHEREUM_EVM' | 'BSC_EVM'
  ) => Promise<TokenSecurityReport | null>;
  onTestDemoBuy: (symbol: string) => Promise<void>;
  onSimulateState: (patch: {
    securityServiceOnline?: boolean;
    simulatedFeedStale?: boolean;
    triggerSystemFault?: boolean;
  }) => Promise<void>;
  onSaveAntiRugConfig: (patch: Partial<CapitalShieldSettings>) => Promise<void>;
}

export const AntiRugSecurityView: React.FC<AntiRugSecurityViewProps> = ({
  snapshot,
  busyAction,
  onInspectContract,
  onTestDemoBuy,
  onSimulateState,
  onSaveAntiRugConfig,
}) => {
  const { antiRug } = snapshot;
  const [filterMode, setFilterMode] = useState<'ALL' | 'SUSPICIOUS' | 'SAFE'>('ALL');
  const [contractInput, setContractInput] = useState('');
  const [selectedChain, setSelectedChain] = useState<
    'SOLANA_SPL' | 'ETHEREUM_EVM' | 'BSC_EVM'
  >('SOLANA_SPL');
  const [minLiqInput, setMinLiqInput] = useState<number>(
    antiRug.config.minPoolLiquidityUsd
  );
  const [minAgeInput, setMinAgeInput] = useState<number>(antiRug.config.minTokenAgeHours);

  const filteredReports = antiRug.tokenReports.filter((r) => {
    if (filterMode === 'SUSPICIOUS') return r.verdict !== 'SAFE_FOR_DEMO';
    if (filterMode === 'SAFE') return r.verdict === 'SAFE_FOR_DEMO';
    return true;
  });

  const verdictBadgeStyle = (verdict: TokenSecurityReport['verdict']) => {
    switch (verdict) {
      case 'SAFE_FOR_DEMO':
        return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
      case 'WARNING_REVIEW':
        return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
      case 'BLOCKED_INSUFFICIENT_DATA':
        return 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300';
      default:
        return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
    }
  };

  const scoreBarColor = (score: number, verdict: TokenSecurityReport['verdict']) => {
    if (verdict === 'BLOCKED_INSUFFICIENT_DATA') return 'bg-fuchsia-500';
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  const liquidityBadgeStyle = (status: TokenSecurityReport['liquidity']['status']) => {
    switch (status) {
      case 'HEALTHY':
        return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
      case 'LOW_LIQUIDITY':
        return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
      case 'SUDDEN_DRAIN_RUG':
        return 'text-rose-300 bg-rose-500/15 border-rose-500/40';
      default:
        return 'text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-500/40';
    }
  };

  return (
    <div className="space-y-4 pb-16">
      {/* Header Banner */}
      <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 p-4 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                ANTI-RUG SECURITY
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                <Lock className="h-3 w-3" />
                حالت DEMO / Paper Trading فعال (معامله واقعی قفل است)
              </span>
            </div>
            <h1 className="mt-2 text-base font-black text-white sm:text-lg">
              {antiRug.botEditionTitle}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              بررسی چندلایه نقدینگی استخر، تشخیص هانی‌پات و مالیات خرید/فروش، اختیارات{' '}
              <span className="font-mono text-amber-300">Mint / Freeze</span>، تشخیص پامپ جعلی
              بدون حجم و محافظ سرمایه با قانون سخت‌گیرانه{' '}
              <strong className="text-emerald-300">Fail-Closed</strong> (در صورت قطع API یا کمبود
              اطلاعات، خرید فوراً مسدود می‌شود). استراتژی‌های شکار پامپ/کف و فروش پله‌ای قبلی بدون
              هیچ تغییری حفظ شده‌اند.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-300">
            <div className="font-bold text-emerald-300">امنیت کیف‌پول شما:</div>
            <div>هرگز کلید خصوصی یا عبارت ۱۲/۲۴ کلمه‌ای درخواست نمی‌شود.</div>
          </div>
        </div>

        {/* Score Rule Legend */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/25 px-3 py-2 text-xs">
            <div className="font-extrabold text-rose-300">امتیاز ۰ تا ۵۹ (زیر ۶۰)</div>
            <div className="text-[11px] text-slate-300">ممنوعیت قطعی خرید توکن پرخطر</div>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs">
            <div className="font-extrabold text-amber-300">امتیاز ۶۰ تا ۷۹</div>
            <div className="text-[11px] text-slate-300">هشدار امنیتی و نیاز به بررسی دستی</div>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/25 px-3 py-2 text-xs">
            <div className="font-extrabold text-emerald-300">امتیاز ۸۰ تا ۱۰۰</div>
            <div className="text-[11px] text-slate-300">مجاز برای آزمایش دمو (Paper Trading)</div>
          </div>
          <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-950/25 px-3 py-2 text-xs">
            <div className="font-extrabold text-fuchsia-300">داده ناقص / قطع API</div>
            <div className="text-[11px] text-slate-300">ممنوعیت فوری خرید (بدون تایید فرضی)</div>
          </div>
        </div>
      </section>

      {/* Required Dashboard KPI Metrics */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>تعداد توکن‌های بررسی‌شده</span>
            <Shield className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-1.5 text-2xl font-black text-white">
            {formatFaNum(antiRug.checkedTokensCount)}
          </div>
          <div className="mt-1 text-[11px] text-emerald-400">
            {formatFaNum(antiRug.safeDemoTokensCount)} توکن امن (۸۰ تا ۱۰۰)
          </div>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between text-xs text-amber-300">
            <span>تعداد توکن‌های مشکوک</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-1.5 text-2xl font-black text-amber-300">
            {formatFaNum(antiRug.suspiciousTokensCount)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            دارای هشدار راگ‌پول، هانی‌پات یا کمبود داده
          </div>
        </div>

        <div className="rounded-2xl border border-rose-500/30 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between text-xs text-rose-300">
            <span>تعداد خریدهای مسدودشده</span>
            <ShieldAlert className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-1.5 text-2xl font-black text-rose-300">
            {formatFaNum(antiRug.blockedBuysCount)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            تکراری مسدودشده: {formatFaNum(antiRug.duplicateBlocksCount)} | قطع/قدیمی:{' '}
            {formatFaNum(antiRug.staleOrOfflineBlocksCount)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>وضعیت سرویس امنیتی</span>
            {antiRug.securityServiceOnline && !antiRug.simulatedFeedStale ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-rose-400" />
            )}
          </div>
          <div
            className={`mt-1.5 text-sm font-black ${
              antiRug.securityServiceOnline && !antiRug.simulatedFeedStale
                ? 'text-emerald-300'
                : 'text-rose-300'
            }`}
          >
            {!antiRug.securityServiceOnline
              ? 'قطع (مسدودسازی خودکار فعال)'
              : antiRug.simulatedFeedStale
                ? 'اطلاعات قدیمی (خرید متوقف)'
                : 'فعال در حالت Paper Trading'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            توقف اضطراری خطای سیستم: {formatFaNum(antiRug.systemErrorHaltsCount)} مورد
          </div>
        </div>
      </section>

      {/* Interactive Paper Trading Security Lab + On-Chain Contract Inspector */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Live / Demo Contract Address Inspector */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-white">
            <Search className="h-4 w-4 text-emerald-400" />
            بازرس هوشمند آدرس قرارداد توکن (Solana SPL / Ethereum / BSC)
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            آدرس عمومی قرارداد توکن را وارد کنید (هرگز کلید خصوصی وارد نکنید). در صورت عدم دسترسی
            به سرویس‌های امنیتی خارجی، سیستم به‌جای تایید فرضی، معامله را مسدود می‌کند.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select
              value={selectedChain}
              onChange={(e) => setSelectedChain(e.target.value as any)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-200"
            >
              <option value="SOLANA_SPL">Solana (Phantom SPL)</option>
              <option value="ETHEREUM_EVM">Ethereum (ERC-20)</option>
              <option value="BSC_EVM">BNB Chain (BEP-20)</option>
            </select>
            <input
              type="text"
              dir="ltr"
              value={contractInput}
              onChange={(e) => setContractInput(e.target.value)}
              placeholder="Mint / 0x Contract Address..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="button"
              disabled={!contractInput.trim() || busyAction === 'inspect-contract'}
              onClick={async () => {
                await onInspectContract(contractInput, selectedChain);
                setContractInput('');
              }}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {busyAction === 'inspect-contract' ? 'در حال بررسی...' : 'بررسی امنیت توکن'}
            </button>
          </div>

          {/* Threshold Settings */}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
            <div>
              <label className="block text-[11px] text-slate-400">
                حداقل نقدینگی استخر (USD)
              </label>
              <input
                type="number"
                dir="ltr"
                value={minLiqInput}
                onChange={(e) => setMinLiqInput(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400">
                حداقل سن مجاز توکن (ساعت)
              </label>
              <input
                type="number"
                dir="ltr"
                value={minAgeInput}
                onChange={(e) => setMinAgeInput(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onSaveAntiRugConfig({
                minPoolLiquidityUsd: minLiqInput,
                minTokenAgeHours: minAgeInput,
              })
            }
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800/80 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            ذخیره آستانه‌های محافظ سرمایه در حالت دمو
          </button>
        </div>

        {/* Paper-Trading Chaos & Capital Shield Test Bench */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-white">
            <Zap className="h-4 w-4 text-amber-400" />
            آزمایشگاه محافظ سرمایه در حالت Paper Trading (بدون پول واقعی)
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            واکنش واقعی محافظ سرمایه را در برابر قطع API امنیتی، قدیمی شدن قیمت‌ها، تله هانی‌پات،
            راگ‌پول نقدینگی و خطای سیستم آزمایش کنید:
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() =>
                onSimulateState({ securityServiceOnline: !antiRug.securityServiceOnline })
              }
              className={`rounded-xl border px-3 py-2 text-right text-xs font-bold transition ${
                antiRug.securityServiceOnline
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              }`}
            >
              {antiRug.securityServiceOnline
                ? '۱. تست قطع سرویس امنیتی (Fail-Closed)'
                : 'بازگرداندن سرویس امنیتی به حالت آنلاین'}
            </button>

            <button
              type="button"
              onClick={() =>
                onSimulateState({ simulatedFeedStale: !antiRug.simulatedFeedStale })
              }
              className={`rounded-xl border px-3 py-2 text-right text-xs font-bold transition ${
                !antiRug.simulatedFeedStale
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              }`}
            >
              {!antiRug.simulatedFeedStale
                ? '۲. تست اطلاعات قدیمی (Stale Data)'
                : 'بازگرداندن فید قیمت به حالت لحظه‌ای'}
            </button>

            <button
              type="button"
              onClick={() => onTestDemoBuy('HONEYCAT')}
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-right text-xs font-bold text-rose-300 hover:bg-rose-500/20"
            >
              ۳. تست تلاش خرید توکن هانی‌پات (HONEYCAT)
            </button>

            <button
              type="button"
              onClick={() => onSimulateState({ triggerSystemFault: true })}
              className="rounded-xl border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-right text-xs font-bold text-rose-200 hover:bg-rose-900/50"
            >
              ۴. تست خطای سیستم ← توقف اضطراری خودکار
            </button>
          </div>
        </div>
      </section>

      {/* Filter Tabs for Token Security Matrix */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-white">
            جدول امتیاز امنیت، وضعیت نقدینگی و دلایل هشدار هر توکن
          </h2>
          <div className="flex items-center gap-1.5">
            {(
              [
                ['ALL', `همه (${formatFaNum(antiRug.tokenReports.length)})`],
                ['SUSPICIOUS', `مشکوک و مسدود (${formatFaNum(antiRug.suspiciousTokensCount)})`],
                ['SAFE', `مجاز دمو ۸۰–۱۰۰ (${formatFaNum(antiRug.safeDemoTokensCount)})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterMode(key)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                  filterMode === key
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {filteredReports.map((rep) => (
            <div
              key={`${rep.symbol}-${rep.contractAddress}`}
              className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-white">{rep.marketName}</span>
                    <span className="text-xs text-slate-400">{rep.displayNameFa}</span>
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                      {rep.network}
                    </span>
                    <span className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                      {rep.dataOrigin === 'LIVE_PUBLIC_SECURITY_APIS'
                        ? 'API واقعی زنجیره‌ای'
                        : rep.dataOrigin === 'FAIL_CLOSED_OFFLINE'
                          ? 'مسدود Fail-Closed (آفلاین)'
                          : 'پروفایل تست دمو'}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-500" dir="ltr">
                    {rep.contractAddress}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={`rounded-xl border px-3 py-1 text-xs font-black ${verdictBadgeStyle(
                      rep.verdict
                    )}`}
                  >
                    امتیاز امنیت: {formatFaNum(rep.securityScore)} / ۱۰۰ — {rep.verdictLabelFa}
                  </div>
                  <button
                    type="button"
                    disabled={busyAction === `test-buy-${rep.symbol}`}
                    onClick={() => onTestDemoBuy(rep.symbol)}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-700"
                  >
                    تست خرید دمو
                  </button>
                </div>
              </div>

              {/* Progress Bar & Sub-scores */}
              <div className="mt-2.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all ${scoreBarColor(
                      rep.securityScore,
                      rep.verdict
                    )}`}
                    style={{ width: `${Math.max(3, rep.securityScore)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>
                    امتیاز نقدینگی: <strong className="text-slate-200">{formatFaNum(rep.liquidityScorePart)}/۳۰</strong>
                  </span>
                  <span>
                    امنیت قرارداد: <strong className="text-slate-200">{formatFaNum(rep.contractScorePart)}/۴۰</strong>
                  </span>
                  <span>
                    ضد پامپ جعلی: <strong className="text-slate-200">{formatFaNum(rep.antiPumpScorePart)}/۳۰</strong>
                  </span>
                  <span>
                    امکان فروش (Honeypot):{' '}
                    <strong
                      className={
                        rep.contract.isHoneypot || rep.contract.canSell === false
                          ? 'text-rose-400'
                          : rep.contract.canSell === null
                            ? 'text-fuchsia-400'
                            : 'text-emerald-400'
                      }
                    >
                      {rep.contract.canSell === null
                        ? 'نامشخص (مسدود)'
                        : rep.contract.isHoneypot || !rep.contract.canSell
                          ? 'هانی‌پات! فروش مسدود'
                          : 'قابل فروش'}
                    </strong>
                  </span>
                  <span>
                    مالیات خرید/فروش:{' '}
                    <strong className="text-slate-200">
                      {rep.contract.buyTaxPct !== null ? `${rep.contract.buyTaxPct}%` : '—'} /{' '}
                      {rep.contract.sellTaxPct !== null ? `${rep.contract.sellTaxPct}%` : '—'}
                    </strong>
                  </span>
                  <span>
                    اختیارات مالک:{' '}
                    <strong
                      className={
                        rep.contract.mintAuthorityActive || rep.contract.freezeAuthorityActive
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }
                    >
                      {rep.contract.freezeAuthorityActive
                        ? 'Freeze فعال!'
                        : rep.contract.mintAuthorityActive
                          ? 'Mint فعال!'
                          : 'ایمن (بدون Mint/Freeze)'}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Liquidity Status Row */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/90 bg-slate-900/60 px-3 py-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <Droplets className="h-3.5 w-3.5 text-sky-400" />
                  <span className="text-slate-400">وضعیت نقدینگی استخر:</span>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${liquidityBadgeStyle(
                      rep.liquidity.status
                    )}`}
                  >
                    {rep.liquidity.statusLabelFa}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                  <span>
                    حجم استخر:{' '}
                    <strong dir="ltr" className="font-mono text-white">
                      {rep.liquidity.poolLiquidityUsd !== null
                        ? `$${Math.round(rep.liquidity.poolLiquidityUsd).toLocaleString()}`
                        : 'نامعتبر'}
                    </strong>
                  </span>
                  <span>
                    تغییر ۱ ساعته نقدینگی:{' '}
                    <strong
                      dir="ltr"
                      className={`font-mono ${
                        (rep.liquidity.liquidityChange1hPct || 0) <= -15
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {rep.liquidity.liquidityChange1hPct !== null
                        ? `${rep.liquidity.liquidityChange1hPct > 0 ? '+' : ''}${rep.liquidity.liquidityChange1hPct}%`
                        : '—'}
                    </strong>
                  </span>
                  <span>
                    سن توکن:{' '}
                    <strong className="text-white">
                      {rep.contract.tokenAgeHours !== null
                        ? rep.contract.tokenAgeHours >= 48
                          ? `${formatFaNum(Math.round(rep.contract.tokenAgeHours / 24))} روز`
                          : `${rep.contract.tokenAgeHours} ساعت (تازه‌ساخت!)`
                        : 'نامشخص'}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Warning / Block Reasons */}
              {rep.warningReasonsFa.length > 0 ? (
                <div className="mt-2.5 rounded-lg border border-rose-500/25 bg-rose-950/20 p-2.5">
                  <div className="text-[11px] font-extrabold text-rose-300">
                    دلایل هشدار و مسدودسازی محافظ سرمایه:
                  </div>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-slate-200">
                    {rep.warningReasonsFa.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-2 text-[11px] font-bold text-emerald-400">
                  ✓ هیچ علامتی از هانی‌پات، اختیارات Mint/Freeze، ریزش نقدینگی یا پامپ جعلی مشاهده نشد.
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Blocked Buys Audit Log & Supported Real Security APIs */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-rose-500/30 bg-slate-900/90 p-4">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-rose-300">
            <AlertOctagon className="h-4 w-4" />
            گزارش خریدهای مسدودشده توسط محافظ سرمایه ({formatFaNum(antiRug.blockedBuysCount)})
          </h3>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {antiRug.blockedBuysLog.map((inc) => (
              <div
                key={inc.id}
                className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-white">
                    {inc.marketName} (امتیاز {formatFaNum(inc.securityScore)}/۱۰۰)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {formatRelativeTimeFa(inc.timestamp)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-rose-300">{inc.primaryReasonFa}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h3 className="text-sm font-extrabold text-white">
            شفافیت سرویس‌ها و APIهای بررسی واقعی امنیت توکن
          </h3>
          <p className="mt-1 text-[11px] text-slate-400">
            تمامی APIهای زیر عمومی و بدون نیاز به کلید خصوصی کیف‌پول هستند. روی سرور یا مرورگر دارای
            اینترنت آزاد به صورت زنده فراخوانی می‌شوند و در صورت عدم دسترسی، خرید مسدود می‌گردد:
          </p>
          <div className="mt-3 space-y-2">
            {antiRug.realApisSupported.map((api) => (
              <div
                key={api.name}
                className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold text-emerald-300">{api.name}</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                    بدون کلید خصوصی
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-300">{api.purposeFa}</div>
                <div className="mt-1 font-mono text-[10px] text-slate-500" dir="ltr">
                  {api.endpointPattern}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
