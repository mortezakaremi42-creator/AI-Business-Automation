import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { PlatformSnapshot } from '../../shared/types';
import { formatTimeFa } from '../utils/format';

interface Props {
  snapshot: PlatformSnapshot;
  onOpenConnectModal: () => void;
  onRefreshNow: () => void;
}

export const ApiAndNetworkView: React.FC<Props> = ({
  snapshot,
  onOpenConnectModal,
  onRefreshNow,
}) => {
  const { health } = snapshot;

  const errorCategoryLabelFa =
    health.lastErrorCategory === 'NONE'
      ? 'بدون خطا (نرمال)'
      : health.lastErrorCategory === 'NETWORK_TIMEOUT_OR_OFFLINE'
        ? 'خطای اتصال شبکه / Timeout (متمایز از خطای معامله)'
        : health.lastErrorCategory === 'AUTH_OR_IP_ERROR'
          ? 'خطای احراز هویت کلید یا IP Whitelist'
          : health.lastErrorCategory === 'RATE_LIMIT_ERROR'
            ? 'محدودیت نرخ درخواست (HTTP 429)'
            : 'رد سفارش توسط قوانین صرافی (خطای معامله)';

  return (
    <div className="space-y-4">
      <section className="glass-panel rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-white">
              {health.internetOnline ? (
                <Wifi className="h-5 w-5 text-emerald-400" />
              ) : (
                <WifiOff className="h-5 w-5 text-rose-400" />
              )}
              وضعیت اتصال امن به بیت‌۲۴، تشخیص خطا و معماری امنیتی
            </h2>
            <p className="mt-1 text-xs text-slate-300">{health.statusMessageFa}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefreshNow}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-slate-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              بررسی مجدد اتصال
            </button>
            <button
              type="button"
              onClick={onOpenConnectModal}
              className="flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-cyan-400"
            >
              <KeyRound className="h-3.5 w-3.5" />
              اتصال کلید در گاوصندوق سرور
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoCard
            label="وضعیت شبکه اینترنت"
            val={health.internetOnline ? 'متصل و برقرار' : 'آفلاین'}
            ok={health.internetOnline}
          />
          <InfoCard
            label="محیط نگهداری کلید (Stage 8)"
            val={
              health.serverBackendConnected
                ? 'گاوصندوق سرور AES-256-GCM فعال'
                : 'بدون سرور (فقط آزمایشی Paper)'
            }
            ok={health.serverBackendConnected}
          />
          <InfoCard
            label="تفکیک نوع آخرین خطا"
            val={errorCategoryLabelFa}
            ok={health.lastErrorCategory === 'NONE'}
          />
          <InfoCard
            label="نرخ درخواست / آخرین همگام‌سازی"
            val={`${health.rateLimitUsedPerMin}/${health.rateLimitMaxPerMin} در دقیقه • ${formatTimeFa(health.lastSyncAt)}`}
            ok={health.rateLimitUsedPerMin < 200}
          />
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            <strong>امنیت کلید و عدم برداشت وجه:</strong> اندپوینت برداشت دارایی (
            <code>/lite/capi/v1/withdraw/submit</code>) در هسته کلاینت و فایروال سرور مسدود است، کلیدها در لاگ‌ها سانسور (Redact) می‌شوند و هیچ سفارشی بدون دریافت <code>order_id</code> رسمی موفق گزارش نمی‌شود.
          </span>
        </div>
      </section>

      {/* Stage 9 Item #4: Explicit Incomplete Features Tagged «تکمیل نشده» */}
      <section className="glass-panel rounded-2xl p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-amber-300">
          <AlertCircle className="h-4 w-4 text-amber-400" />
          فهرست شفاف قابلیت‌های دارای محدودیت خارجی (برچسب رسمی «تکمیل نشده» — مرحله نهم)
        </h3>
        <div className="space-y-2.5">
          {health.incompleteFeatures.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-amber-500/30 bg-slate-950/75 p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-white">{item.titleFa}</span>
                <span className="rounded-md border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-200">
                  {item.badgeFa}
                </span>
              </div>
              <p className="mt-1 leading-relaxed text-slate-300">{item.detailFa}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stage 8 Real Android PWA + APK Build Guide */}
      <section className="glass-panel rounded-2xl p-4">
        <h3 className="mb-1.5 flex items-center gap-2 text-sm font-black text-white">
          <Smartphone className="h-4 w-4 text-cyan-400" />
          نصب مستقیم روی اندروید (PWA) و روش واقعی ساخت فایل APK (مرحله هشتم)
        </h3>
        <div className="space-y-2 text-xs leading-relaxed text-slate-300">
          <p>
            ۱. <strong>نصب فوری PWA بدون نیاز به استور:</strong> آدرس HTTPS برنامه را در کروم اندروید باز کرده و گزینه <code>Install App / Add to Home Screen</code> را بزنید تا اپ تمام‌صفحه فارسی نصب شود.
          </p>
          <p>
            ۲. <strong>روش مهندسی ساخت فایل APK واقعی اندروید (Bubblewrap TWA یا Capacitor):</strong>{' '}
            در سیستم دارای Android SDK دستور{' '}
            <code dir="ltr" className="text-cyan-300">
              npx @bubblewrap/cli init --manifest https://YOUR-DOMAIN/manifest.webmanifest && npx @bubblewrap/cli build
            </code>{' '}
            را اجرا کنید تا فایل امضاشده <code>app-release-signed.apk</code> تولید شود.
          </p>
        </div>
      </section>

      {/* Transparent Official Bit24 CAPI v1/v2 Audit Matrix */}
      <section className="glass-panel rounded-2xl p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-black text-white">
          <Server className="h-4 w-4 text-amber-400" />
          جدول مستندات رسمی API بیت‌۲۴ (docs.bit24.cash — CAPI v1/v2)
        </h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-900/95 text-slate-400">
              <tr>
                <th className="p-2.5">قابلیت</th>
                <th className="p-2.5">اندپوینت رسمی</th>
                <th className="p-2.5">وضعیت پشتیبانی</th>
                <th className="p-2.5">امضای HMAC</th>
                <th className="p-2.5">توضیحات فنی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 bg-slate-950/60">
              {health.capabilities.map((cap) => (
                <tr key={cap.id}>
                  <td className="p-2.5 font-bold text-white">{cap.featureFa}</td>
                  <td className="p-2.5 font-mono text-[11px] text-cyan-300" dir="ltr">
                    {cap.method} {cap.endpoint}
                  </td>
                  <td className="p-2.5">
                    {cap.officialSupport === 'SUPPORTED' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> پشتیبانی رسمی
                      </span>
                    ) : cap.officialSupport === 'CONDITIONAL' ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 font-bold text-amber-300">
                        مشروط (نسخه ۱ خاموش)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2 py-0.5 font-bold text-rose-300">
                        <Lock className="h-3 w-3" /> مسدود امنیتی
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 text-slate-300">
                    {cap.requiresSecretSignature ? 'الزامی (SHA-256)' : 'فقط X-BIT24-APIKEY'}
                  </td>
                  <td className="p-2.5 text-slate-400">{cap.notesFa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const InfoCard: React.FC<{ label: string; val: string; ok: boolean }> = ({ label, val, ok }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3">
    <div className="text-[11px] text-slate-400">{label}</div>
    <div className={`mt-1 text-xs font-extrabold ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
      {val}
    </div>
  </div>
);
