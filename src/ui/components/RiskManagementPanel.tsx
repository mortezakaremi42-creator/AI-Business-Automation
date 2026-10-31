import React, { useState } from 'react';
import {
  AppLanguage,
  CapitalRiskConfig,
  ExitStrategyConfig,
} from '../../shared/contracts.js';

interface Props {
  lang: AppLanguage;
  capitalConfig: CapitalRiskConfig;
  exitConfig: ExitStrategyConfig;
  onSave: (params: {
    capital: Partial<CapitalRiskConfig>;
    exit: Partial<ExitStrategyConfig>;
  }) => void;
}

export const RiskManagementPanel: React.FC<Props> = ({
  lang,
  capitalConfig,
  exitConfig,
  onSave,
}) => {
  const isFa = lang === 'fa';
  const [cap, setCap] = useState<CapitalRiskConfig>({ ...capitalConfig });
  const [ext, setExt] = useState<ExitStrategyConfig>({ ...exitConfig });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ capital: cap, exit: ext });
  };

  return (
    <form className="section-card" onSubmit={handleSubmit}>
      <div className="section-title">
        <span>
          {isFa
            ? '🛡️ مدیریت سرمایه حرفه‌ای + حد ضرر و فروش پله‌ای (قابل شخصی‌سازی)'
            : '🛡️ Professional Capital Management, Trailing Stop & Stepped Take-Profit'}
        </span>
        <span className="badge badge-safe-lock">
          {isFa
            ? 'قانون قطعی: ورود ۱۰۰٪ سرمایه در یک معامله برای همیشه ممنوع است'
            : 'Hard Rule: 100% single-trade allocation permanently blocked'}
        </span>
      </div>

      <h4 style={{ margin: '10px 0 8px', color: '#38bdf8' }}>
        {isFa
          ? '۱. قوانین مدیریت سرمایه (پیش‌فرض‌های استاندارد)'
          : '1. Capital Allocation Rules'}
      </h4>
      <div className="form-grid">
        <label className="form-field">
          <span>
            {isFa
              ? 'موجودی پایه آزمایشی (تومان)'
              : 'Initial Demo Capital (IRT)'}
          </span>
          <input
            type="number"
            min={5000000}
            step={1000000}
            value={cap.initialDemoBalanceIrt}
            onChange={(e) =>
              setCap({ ...cap, initialDemoBalanceIrt: Number(e.target.value) })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? 'حداکثر ریسک هر معامله (% کل سرمایه — پیش‌فرض ۱٪)'
              : 'Max Risk Per Trade (% of capital — default 1%)'}
          </span>
          <input
            type="number"
            min={0.2}
            max={5}
            step={0.1}
            value={cap.riskPerTradePct}
            onChange={(e) =>
              setCap({ ...cap, riskPerTradePct: Number(e.target.value) })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? 'حداکثر سرمایه در هر معامله (% — پیش‌فرض ۱۰٪، سقف ایمنی ۳۵٪)'
              : 'Max Capital Per Trade (% — default 10%, hard cap 35%)'}
          </span>
          <input
            type="number"
            min={1}
            max={35}
            step={1}
            value={cap.maxCapitalPerTradePct}
            onChange={(e) =>
              setCap({ ...cap, maxCapitalPerTradePct: Number(e.target.value) })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? 'حداکثر معاملات هم‌زمان (پیش‌فرض ۳ معامله)'
              : 'Max Concurrent Trades (default 3)'}
          </span>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={cap.maxConcurrentTrades}
            onChange={(e) =>
              setCap({ ...cap, maxConcurrentTrades: Number(e.target.value) })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? 'حداکثر ضرر روزانه مجاز (% — پیش‌فرض ۳٪ + توقف خودکار)'
              : 'Max Daily Loss Limit (% — default 3% + auto-stop)'}
          </span>
          <input
            type="number"
            min={0.5}
            max={15}
            step={0.5}
            value={cap.maxDailyLossPct}
            onChange={(e) =>
              setCap({ ...cap, maxDailyLossPct: Number(e.target.value) })
            }
          />
        </label>
      </div>

      <h4 style={{ margin: '18px 0 8px', color: '#f5b942' }}>
        {isFa
          ? '۲. حد ضرر، Trailing Stop و فروش پله‌ای (Stepped Take-Profit)'
          : '2. Stop-Loss, Trailing Stop & 3-Stage Stepped Take-Profit'}
      </h4>
      <div className="form-grid">
        <label className="form-field">
          <span>
            {isFa
              ? 'حد ضرر اولیه (% — پیش‌فرض ۵٪)'
              : 'Initial Stop-Loss (% — default 5%)'}
          </span>
          <input
            type="number"
            min={1}
            max={15}
            step={0.5}
            value={ext.initialStopLossPct}
            onChange={(e) =>
              setExt({ ...ext, initialStopLossPct: Number(e.target.value) })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? 'فعال‌سازی Trailing Stop پس از سود (% — پیش‌فرض ۸٪)'
              : 'Trailing Stop Activation Profit (% — default 8%)'}
          </span>
          <input
            type="number"
            min={2}
            max={30}
            step={0.5}
            value={ext.trailingActivationProfitPct}
            onChange={(e) =>
              setExt({
                ...ext,
                trailingActivationProfitPct: Number(e.target.value),
              })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? 'فاصله Trailing Stop از بالاترین قیمت (% — پیش‌فرض ۳٪)'
              : 'Trailing Distance Below Peak (% — default 3%)'}
          </span>
          <input
            type="number"
            min={0.8}
            max={12}
            step={0.2}
            value={ext.trailingDistanceFromPeakPct}
            onChange={(e) =>
              setExt({
                ...ext,
                trailingDistanceFromPeakPct: Number(e.target.value),
              })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? `پله اول فروش (${ext.tpStage1SellRatioPct}% حجم) در سود (%)`
              : `TP Stage 1 (${ext.tpStage1SellRatioPct}% size) at Profit (%)`}
          </span>
          <input
            type="number"
            min={2}
            max={50}
            step={1}
            value={ext.tpStage1ProfitPct}
            onChange={(e) =>
              setExt({ ...ext, tpStage1ProfitPct: Number(e.target.value) })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? `پله دوم فروش (${ext.tpStage2SellRatioPct}% حجم) در سود (%)`
              : `TP Stage 2 (${ext.tpStage2SellRatioPct}% size) at Profit (%)`}
          </span>
          <input
            type="number"
            min={4}
            max={80}
            step={1}
            value={ext.tpStage2ProfitPct}
            onChange={(e) =>
              setExt({ ...ext, tpStage2ProfitPct: Number(e.target.value) })
            }
          />
        </label>

        <label className="form-field">
          <span>
            {isFa
              ? `پله سوم تسویه (${ext.tpStage3SellRatioPct}% باقی‌مانده) در سود (%)`
              : `TP Stage 3 (${ext.tpStage3SellRatioPct}% remaining) at Profit (%)`}
          </span>
          <input
            type="number"
            min={8}
            max={150}
            step={1}
            value={ext.tpStage3ProfitPct}
            onChange={(e) =>
              setExt({ ...ext, tpStage3ProfitPct: Number(e.target.value) })
            }
          />
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="submit" className="cmd-btn cmd-btn-start">
          {isFa
            ? 'ذخیره تنظیمات مدیریت سرمایه و حد سود/ضرر'
            : 'Save Capital & Exit Settings'}
        </button>
      </div>
    </form>
  );
};
