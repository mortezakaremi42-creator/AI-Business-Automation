import React from 'react';
import { CheckCircle2, Download, Smartphone, X } from 'lucide-react';

interface Props {
  open: boolean;
  canPromptInstall: boolean;
  onTriggerInstall: () => Promise<boolean>;
  onClose: () => void;
}

export const InstallAndroidModal: React.FC<Props> = ({
  open,
  canPromptInstall,
  onTriggerInstall,
  onClose,
}) => {
  if (!open) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/35 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-black text-white">
              نصب مستقیم اپ اندروید Bit24 AI + Gold
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

        <div className="mt-4 space-y-3 text-xs text-slate-200">
          {canPromptInstall && (
            <button
              type="button"
              onClick={async () => {
                const ok = await onTriggerInstall();
                if (ok) onClose();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950 hover:bg-amber-400"
            >
              <Download className="h-4 w-4" />
              نصب یک‌کلیکی اپلیکیشن روی گوشی اندروید
            </button>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 leading-relaxed">
            <div className="mb-2 font-bold text-amber-300">
              راهنمای نصب ۳ ثانیه‌ای در مرورگر کروم اندروید (بدون نیاز به گوگل‌پلی یا پیامک):
            </div>
            <ol className="list-decimal space-y-1.5 pr-4 text-slate-300">
              <li>این لینک را در مرورگر <strong>Google Chrome</strong> گوشی اندروید خود باز کنید.</li>
              <li>روی منوی سه نقطه بالا سمت چپ/راست کروم (<code>⋮</code>) بزنید.</li>
              <li>
                گزینه <strong>Install app</strong> یا <strong>Add to Home screen</strong> را لمس کنید.
              </li>
              <li>
                آیکون طلایی-مشکی <strong>Bit24 AI + Gold</strong> به شکل تمام‌صفحه کنار سایر اپ‌های گوشی نصب می‌شود!
              </li>
            </ol>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[11px] text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              توجه معماری ۲۴ ساعته: اندروید در زمان قفل بودن طولانی صفحه، پردازش پس‌زمینه مرورگر را برای حفظ باتری محدود می‌کند. برای معامله خودکار شبانه‌روزی (۲۴/۷ حتی زمان خاموشی گوشی)، سرور Node.js همراه همین پروژه را روی سرور مجازی اجرا کنید و با همین اپ اندروید از هر جا آن را کنترل نمایید.
            </span>
          </div>

          <div className="truncate rounded-lg bg-slate-950 px-3 py-2 font-mono text-[10px] text-slate-400" dir="ltr">
            {currentUrl}
          </div>
        </div>
      </div>
    </div>
  );
};
