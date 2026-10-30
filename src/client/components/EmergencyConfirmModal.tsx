import React, { useState } from 'react';
import { AlertOctagon, Radio, ShieldAlert, X } from 'lucide-react';

export type SafetyModalKind =
  | 'EMERGENCY_STOP'
  | 'SEPARATE_LIQUIDATE'
  | 'CONFIRM_LIVE_TRADING'
  | null;

interface Props {
  kind: SafetyModalKind;
  openPositionsCount: number;
  bit24Connected: boolean;
  onClose: () => void;
  onConfirmEmergencyStop: (cancelOpenOrders: boolean) => Promise<void>;
  onConfirmSeparateLiquidation: () => Promise<void>;
  onConfirmLiveTrading: () => Promise<void>;
  onRequestOpenLiquidateModal: () => void;
}

export const EmergencyConfirmModal: React.FC<Props> = ({
  kind,
  openPositionsCount,
  bit24Connected,
  onClose,
  onConfirmEmergencyStop,
  onConfirmSeparateLiquidation,
  onConfirmLiveTrading,
  onRequestOpenLiquidateModal,
}) => {
  const [cancelOpenOrders, setCancelOpenOrders] = useState(true);
  const [ackChecked, setAckChecked] = useState(false);

  if (!kind) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            {kind === 'CONFIRM_LIVE_TRADING' ? (
              <Radio className="h-5 w-5 text-emerald-400" />
            ) : (
              <AlertOctagon className="h-5 w-5 text-red-400" />
            )}
            <h3 className="text-base font-black text-white">
              {kind === 'EMERGENCY_STOP'
                ? 'توقف اضطراری همه ربات‌ها'
                : kind === 'SEPARATE_LIQUIDATE'
                  ? 'تأیید جداگانه فروش فوری همه دارایی‌ها'
                  : 'تأیید فعال‌سازی معاملات واقعی در بیت‌۲۴'}
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

        {kind === 'EMERGENCY_STOP' && (
          <div className="mt-4 space-y-3 text-xs text-slate-200">
            <p className="leading-relaxed">
              با زدن دکمه زیر، ثبت سفارش جدید در <strong>هر ۳ ربات (طلا، اسپات و اهرم‌دار)</strong>{' '}
              فوراً متوقف شده و قفل معاملات واقعی فعال می‌گردد.
            </p>

            <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
              <input
                type="checkbox"
                checked={cancelOpenOrders}
                onChange={(e) => setCancelOpenOrders(e.target.checked)}
                className="accent-red-500"
              />
              <span>لغو هم‌زمان تمام سفارش‌های باز در صرافی بیت‌۲۴ (Spot & Margin Cancel)</span>
            </label>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  await onConfirmEmergencyStop(cancelOpenOrders);
                  onClose();
                }}
                className="w-full rounded-xl bg-red-600 py-3 text-sm font-black text-white hover:bg-red-500"
              >
                اجرای فوری توقف اضطراری همه ربات‌ها
              </button>

              {openPositionsCount > 0 && (
                <button
                  type="button"
                  onClick={onRequestOpenLiquidateModal}
                  className="w-full rounded-xl border border-rose-500/50 bg-rose-500/15 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-500/25"
                >
                  نیاز به فروش فوری {openPositionsCount} موقعیت باز دارید؟ (مرحله تأیید جداگانه)
                </button>
              )}
            </div>
          </div>
        )}

        {kind === 'SEPARATE_LIQUIDATE' && (
          <div className="mt-4 space-y-3 text-xs text-slate-200">
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 p-3 text-rose-100">
              <ShieldAlert className="ml-1 inline h-4 w-4 text-rose-400" />
              <strong>هشدار مرحله تأیید مجزا:</strong> این عملیات تمام{' '}
              <strong>{openPositionsCount} موقعیت باز</strong> را با قیمت لحظه‌ای بازار (Market) به فروش می‌رساند و ممکن است شامل کارمزد تیکر و لغزش قیمت باشد.
            </div>

            <label className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
              <input
                type="checkbox"
                checked={ackChecked}
                onChange={(e) => setAckChecked(e.target.checked)}
                className="mt-0.5 accent-rose-500"
              />
              <span>فروش فوری همه موقعیت‌های باز با قیمت لحظه‌ای بازار را صراحتاً تایید می‌کنم.</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-700 px-4 py-2 font-bold text-slate-300"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={!ackChecked}
                onClick={async () => {
                  await onConfirmSeparateLiquidation();
                  setAckChecked(false);
                  onClose();
                }}
                className="rounded-xl bg-rose-600 px-4 py-2 font-black text-white disabled:opacity-40"
              >
                تأیید نهایی فروش فوری دارایی‌ها
              </button>
            </div>
          </div>
        )}

        {kind === 'CONFIRM_LIVE_TRADING' && (
          <div className="mt-4 space-y-3 text-xs text-slate-200">
            {!bit24Connected ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 text-amber-100">
                هنوز کلید API بیت‌۲۴ متصل نشده است. لطفاً ابتدا از دکمه «اتصال به بیت‌۲۴» کلید API و Secret خود را وارد نمایید یا در حالت امن «معاملات آزمایشی» تست کنید.
              </div>
            ) : (
              <>
                <p className="leading-relaxed text-slate-300">
                  شما در حال فعال‌سازی <strong>ثبت سفارش واقعی در حساب بیت‌۲۴</strong> هستید. به خاطر داشته باشید:
                </p>
                <ul className="list-disc space-y-1 pr-5 text-slate-300">
                  <li>هیچ سود یا نرخ بردی در بازار کریپتو و طلا قطعی نیست.</li>
                  <li>پس از بسته شدن یا ری‌استارت برنامه، معاملات واقعی به‌طور خودکار غیرفعال می‌شود.</li>
                  <li>سقف زیان روزانه فعلی فعال است و در صورت برخورد، سفارش جدید متوقف می‌شود.</li>
                </ul>

                <label className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
                  <input
                    type="checkbox"
                    checked={ackChecked}
                    onChange={(e) => setAckChecked(e.target.checked)}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <span>مسئولیت معاملات واقعی را می‌پذیرم و اجرای سفارش در بیت‌۲۴ را تایید می‌کنم.</span>
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl border border-slate-700 px-4 py-2 font-bold text-slate-300"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    disabled={!ackChecked}
                    onClick={async () => {
                      await onConfirmLiveTrading();
                      setAckChecked(false);
                      onClose();
                    }}
                    className="rounded-xl bg-emerald-500 px-4 py-2 font-black text-slate-950 disabled:opacity-40"
                  >
                    فعال‌سازی معاملات واقعی
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
