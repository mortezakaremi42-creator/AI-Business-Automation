import React, { useState } from 'react';
import { AlertTriangle, KeyRound, Lock, Server, ShieldCheck, Trash2, X } from 'lucide-react';
import { ApiAndNetworkHealth } from '../../shared/types';

interface Props {
  open: boolean;
  health: ApiAndNetworkHealth;
  onClose: () => void;
  onConnect: (
    apiKey: string,
    secretKey: string,
    passphrase?: string,
    adminToken?: string
  ) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export const Bit24ApiModal: React.FC<Props> = ({
  open,
  health,
  onClose,
  onConnect,
  onDisconnect,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    setSubmitting(true);
    try {
      await onConnect(
        apiKey,
        secretKey,
        passphrase || undefined,
        adminToken || undefined
      );
      setApiKey('');
      setSecretKey('');
      onClose();
    } catch (err: any) {
      setErrMsg(err?.message || 'خطا در ذخیره کلید API');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm">
      <div className="my-auto w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-cyan-400" />
            <h3 className="text-sm sm:text-base font-black text-white">
              اتصال امن به صرافی بیت‌۲۴ (محیط رمزنگاری‌شده سمت سرور)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 space-y-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
          <p className="font-bold text-emerald-300 flex items-center gap-1.5">
            <Server className="h-4 w-4 shrink-0" />
            معماری امنیتی مرحله هشتم (Server-Only Credential Vault):
          </p>
          <p>
            ۱. کلیدهای API هرگز در کد فرانت‌اند، حافظه مرورگر یا مخزن Git ذخیره نمی‌شوند و فقط در گاوصندوق <code>AES-256-GCM</code> بک‌اند سرور یا متغیر محیطی <code>.env</code> نگهداری می‌گردند.
          </p>
          <p>
            ۲. در پنل بیت‌۲۴ (<code>bit24.cash/dashboard/api-management</code>) مجوز <strong>«برداشت وجه (Withdraw)» را هرگز فعال نکنید</strong>.
          </p>
          <p>
            ۳. توصیه می‌شود پیش از ورود کلید واقعی، عملکرد ربات را در حالت آزمایشی (Paper Trading) بررسی نمایید.
          </p>
        </div>

        {!health.serverBackendConnected && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              شما در حال مشاهده نسخه استاتیک بدون سرور هستید. طبق استاندارد امنیتی، ذخیره کلید واقعی در مرورگر غیرفعال است و سیستم در حالت امن آزمایشی (Paper Trading) کار می‌کند. برای اتصال کلید واقعی، سرور بک‌اند Node.js/Docker را اجرا نمایید.
            </span>
          </div>
        )}

        {health.bit24ApiConfigured && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2.5 text-xs">
            <div className="flex items-center gap-2 text-cyan-100">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>
                کلید سرور فعلی: <strong>{health.bit24KeyMasked}</strong> (
                {health.bit24ConnectionState === 'CONNECTED_VERIFIED'
                  ? 'تاییدشده از API بیت‌۲۴'
                  : 'ذخیره‌شده در سرور'})
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                await onDisconnect();
                onClose();
              }}
              className="flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1 font-bold text-rose-300 hover:bg-rose-500/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف کلید از سرور
            </button>
          </div>
        )}

        <form onSubmit={handleSave} className="mt-3 space-y-2.5">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-300">
              ۱. توکن API بیت‌۲۴ (X-BIT24-APIKEY) *
            </label>
            <input
              type="password"
              required
              autoComplete="off"
              placeholder="توکن دریافتی از پنل بیت‌۲۴ (بدون مجوز برداشت)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              dir="ltr"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-300">
              ۲. کلید اختصاصی امضای سفارش (Secret Key — HMAC-SHA256)
            </label>
            <input
              type="password"
              autoComplete="off"
              placeholder="کلید خصوصی برای ثبت و لغو سفارش در بیت‌۲۴"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              dir="ltr"
            />
          </div>

          {health.adminAuthProtected && (
            <div>
              <label className="mb-1 block text-xs font-bold text-amber-300">
                توکن احراز هویت مدیر سرور (ADMIN_ACCESS_TOKEN) *
              </label>
              <input
                type="password"
                required
                autoComplete="off"
                placeholder="توکن امنیتی مدیر سرور"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                className="w-full rounded-xl border border-amber-500/40 bg-slate-950 px-3 py-2 text-xs text-white"
                dir="ltr"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-400">
              عبارت رمزنگاری تکمیلی گاوصندوق سرور AES-256 (اختیاری)
            </label>
            <input
              type="password"
              autoComplete="off"
              placeholder="کلید مشتق‌سازی scrypt سمت سرور"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
            />
          </div>

          {errMsg && (
            <div className="rounded-xl bg-rose-500/20 p-2.5 text-xs font-bold text-rose-300">
              {errMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={submitting || !health.serverBackendConnected}
              className="flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              <Lock className="h-3.5 w-3.5" />
              ذخیره در گاوصندوق سرور و بررسی اتصال
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
