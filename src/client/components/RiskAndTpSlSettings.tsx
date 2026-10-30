import React, { useState } from 'react';
import { AlertTriangle, Lock, Save, ShieldCheck, Sliders } from 'lucide-react';
import { PlatformSettings } from '../../shared/types';

interface Props {
  settings: PlatformSettings;
  onSave: (patch: Partial<PlatformSettings>) => Promise<void>;
}

export const RiskAndTpSlSettings: React.FC<Props> = ({ settings, onSave }) => {
  const [draft, setDraft] = useState<PlatformSettings>(() => JSON.parse(JSON.stringify(settings)));

  const updateModRisk = (
    mod: 'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER' | 'LEVERAGE_MARGIN',
    field: string,
    value: any
  ) => {
    setDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [mod]: {
          ...prev.modules[mod],
          risk: {
            ...prev.modules[mod].risk,
            [field]: value,
            allowLossAveragingDca: false,
          },
        },
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(draft);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Stage 5 Stop-Loss Non-Guarantee Transparency Warning */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="leading-relaxed">
          <strong className="text-amber-300">محدودیت فنی حد ضرر (Stop-Loss):</strong> حد ضرر تضمین
          نمی‌کند که سفارش دقیقاً در همان قیمت اجرا شود (در جهش‌ها یا افت نقدشوندگی، لغزش قیمت / Slippage
          رخ می‌دهد). در API اسپات بیت‌۲۴ (<code>/pro/capi/v2/spot-orders/submit</code>) سفارش‌های Stop-Limit/Market
          وابسته به عمق لحظه‌ای دفتر سفارشات هستند و موتور ربات نیز پایش زنده قیمت را موازی انجام می‌دهد.
        </p>
      </div>

      {/* Global Stage 5 Capital Protection Rules */}
      <section className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-white">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            قوانین سراسری مدیریت ریسک (مرحله پنجم)
          </h2>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400"
          >
            <Save className="h-4 w-4" />
            ذخیره تنظیمات ریسک
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FieldBox label="توقف معاملات جدید پس از زیان روزانه (٪) — پیش‌فرض ۲٪">
            <input
              type="number"
              step="0.25"
              min="0.5"
              max="10"
              value={draft.dailyMaxLossPct}
              onChange={(e) =>
                setDraft({ ...draft, dailyMaxLossPct: Number(e.target.value) })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            />
          </FieldBox>

          <FieldBox label="حداکثر ریسک مجموع موقعیت‌های باز (٪) — پیش‌فرض ۲٪">
            <input
              type="number"
              step="0.25"
              min="0.5"
              max="8"
              value={draft.maxTotalOpenRiskPct}
              onChange={(e) =>
                setDraft({ ...draft, maxTotalOpenRiskPct: Number(e.target.value) })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-emerald-300"
            />
          </FieldBox>

          <FieldBox label="حداکثر تعداد کل موقعیت‌های باز هم‌زمان — پیش‌فرض ۳">
            <input
              type="number"
              step="1"
              min="1"
              max="10"
              value={draft.maxTotalOpenPositions}
              onChange={(e) =>
                setDraft({ ...draft, maxTotalOpenPositions: Number(e.target.value) })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-cyan-300"
            />
          </FieldBox>

          <FieldBox label="نرخ کارمزد سطح کاربری بیت‌۲۴ در هر سمت (٪)">
            <select
              value={draft.bit24VipFeePct}
              onChange={(e) =>
                setDraft({ ...draft, bit24VipFeePct: Number(e.target.value) })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            >
              <option value={0.2}>۰.۲۰٪ (سطح پایه VIP 0 بیت‌۲۴)</option>
              <option value={0.16}>۰.۱۶٪ (VIP 1)</option>
              <option value={0.12}>۰.۱۲٪ (VIP 2-3)</option>
              <option value={0.07}>۰.۰۷٪ (VIP 5 حداقل کارمزد)</option>
            </select>
          </FieldBox>

          <FieldBox label="حداکثر اسپرد مجاز دفتر سفارشات (٪)">
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="1.5"
              value={draft.maxAllowedSpreadPct}
              onChange={(e) =>
                setDraft({ ...draft, maxAllowedSpreadPct: Number(e.target.value) })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            />
          </FieldBox>

          <FieldBox label="حداقل نسبت سود به ریسک خالص (Net R:R)">
            <input
              type="number"
              step="0.1"
              min="1.3"
              max="4.0"
              value={draft.minNetRiskReward}
              onChange={(e) =>
                setDraft({ ...draft, minNetRiskReward: Number(e.target.value) })
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            />
          </FieldBox>
        </div>
      </section>

      {/* Module 1: Digital Gold Risk & TP/SL */}
      <ModuleRiskEditor
        title="تنظیمات مستقل ماژول طلا (PAXG / XAUT)"
        accent="gold"
        risk={draft.modules.DIGITAL_GOLD.risk}
        onChange={(field, val) => updateModRisk('DIGITAL_GOLD', field, val)}
      />

      {/* Module 2: Spot Crypto Risk & TP/SL */}
      <ModuleRiskEditor
        title="تنظیمات مستقل ماژول رمزارز اسپات بیت‌۲۴"
        accent="cyan"
        risk={draft.modules.SPOT_CRYPTO.risk}
        onChange={(field, val) => updateModRisk('SPOT_CRYPTO', field, val)}
      />

      {/* Module 3: Meme Coin Sub-module Risk & TP/SL */}
      <ModuleRiskEditor
        title="تنظیمات زیرماژول رمزارز: میم‌کوین اسپات"
        accent="fuchsia"
        risk={draft.modules.MEME_HUNTER.risk}
        onChange={(field, val) => updateModRisk('MEME_HUNTER', field, val)}
      />

      {/* Locked Safety Notice */}
      <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/75 p-3.5 text-xs text-slate-300">
        <Lock className="h-4 w-4 shrink-0 text-amber-400" />
        <span>
          <strong>قفل ایمنی نسخه اول:</strong> اهرم و معاملات فیوچرز خاموش است، تکرار سفارش هنگام تاخیر شبکه با قفل Idempotency مسدود است و در صورت داده غیرعادی یا خطای مکرر API توقف خودکار (Circuit Breaker) فعال می‌شود.
        </span>
      </div>
    </form>
  );
};

const ModuleRiskEditor: React.FC<{
  title: string;
  accent: 'gold' | 'cyan' | 'fuchsia';
  risk: PlatformSettings['modules']['DIGITAL_GOLD']['risk'];
  onChange: (field: string, value: any) => void;
}> = ({ title, accent, risk, onChange }) => (
  <section
    className={`rounded-2xl border p-4 ${
      accent === 'gold'
        ? 'gold-card'
        : accent === 'fuchsia'
          ? 'glass-panel border-fuchsia-500/35'
          : 'glass-panel border-cyan-500/30'
    }`}
  >
    <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-white">
      <Sliders
        className={`h-4 w-4 ${
          accent === 'gold'
            ? 'text-amber-400'
            : accent === 'fuchsia'
              ? 'text-fuchsia-400'
              : 'text-cyan-400'
        }`}
      />
      {title}
    </h3>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <FieldBox label="سرمایه تخصیص‌یافته این بخش (تومان)">
        <input
          type="number"
          step="5000000"
          min="1000000"
          value={risk.allocatedCapitalIrt}
          onChange={(e) => onChange('allocatedCapitalIrt', Number(e.target.value))}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
        />
      </FieldBox>

      <FieldBox label="ریسک هر معامله (پیش‌فرض مرحله پنجم: ۰.۵٪)">
        <input
          type="number"
          step="0.05"
          min="0.15"
          max="1.5"
          value={risk.riskPerTradePct}
          onChange={(e) => onChange('riskPerTradePct', Number(e.target.value))}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-emerald-300"
        />
      </FieldBox>

      <FieldBox label="ارز مظنه معاملات این بخش">
        <select
          value={risk.quotePreference}
          onChange={(e) => onChange('quotePreference', e.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
        >
          <option value="IRT">تومان (IRT)</option>
          <option value="USDT">تتر (USDT)</option>
        </select>
      </FieldBox>

      <FieldBox label="حد ضرر پایه (Stop-Loss ٪)">
        <input
          type="number"
          step="0.1"
          min="0.5"
          max="6"
          value={risk.stopLossPct}
          onChange={(e) => onChange('stopLossPct', Number(e.target.value))}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-rose-300"
        />
      </FieldBox>

      <FieldBox label="حد سود مرحله اول TP1 (۵۰٪ حجم) — درصد">
        <input
          type="number"
          step="0.1"
          min="0.8"
          max="15"
          value={risk.takeProfit1Pct}
          onChange={(e) => onChange('takeProfit1Pct', Number(e.target.value))}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-emerald-300"
        />
      </FieldBox>

      <FieldBox label="حد سود نهایی TP2 — درصد">
        <input
          type="number"
          step="0.1"
          min="1.2"
          max="25"
          value={risk.takeProfit2Pct}
          onChange={(e) => onChange('takeProfit2Pct', Number(e.target.value))}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-emerald-200"
        />
      </FieldBox>

      <FieldBox label="فاصله حد ضرر متحرک (Trailing Stop ٪)">
        <input
          type="number"
          step="0.05"
          min="0.35"
          max="5"
          value={risk.trailingStopPct}
          onChange={(e) => onChange('trailingStopPct', Number(e.target.value))}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-amber-300"
        />
      </FieldBox>

      <FieldBox label="حداکثر معاملات هم‌زمان مجاز این بخش">
        <input
          type="number"
          min="1"
          max="5"
          value={risk.maxOpenPositions}
          onChange={(e) => onChange('maxOpenPositions', Number(e.target.value))}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
        />
      </FieldBox>

      <div className="flex flex-col justify-center gap-2 rounded-xl bg-slate-950/60 p-3 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={risk.useSteppedTakeProfit}
            onChange={(e) => onChange('useSteppedTakeProfit', e.target.checked)}
            className="accent-emerald-500"
          />
          <span>تسویه پله‌ای سود (TP1 + انتقال حد ضرر به سربه‌سر)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={risk.useTrailingStop}
            onChange={(e) => onChange('useTrailingStop', e.target.checked)}
            className="accent-amber-500"
          />
          <span>فعال‌سازی حد ضرر متحرک (Trailing Stop)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={risk.earlyExitOnTrendWeakness}
            onChange={(e) => onChange('earlyExitOnTrendWeakness', e.target.checked)}
            className="accent-cyan-500"
          />
          <span>خروج زودهنگام هنگام شکست حمایت یا ضعف روند</span>
        </label>
      </div>
    </div>
  </section>
);

const FieldBox: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="mb-1 block text-xs font-medium text-slate-300">{label}</label>
    {children}
  </div>
);
