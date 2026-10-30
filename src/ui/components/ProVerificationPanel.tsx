import React from 'react';
import { AppLanguage, ProVerificationReport } from '../../shared/contracts.js';
import { formatIrt } from '../i18n.js';

interface Props {
  lang: AppLanguage;
  report: ProVerificationReport | null;
  busy: boolean;
  onRunTest: () => void;
}

export const ProVerificationPanel: React.FC<Props> = ({
  lang,
  report,
  busy,
  onRunTest,
}) => {
  const isFa = lang === 'fa';

  return (
    <div className="section-card">
      <div className="section-title">
        <span>
          {isFa
            ? '🧪 تست حرفه‌ای قبل از اجرای واقعی (۱۰۰+ معامله کندل‌به‌کندل + ۴ تست بحران)'
            : '🧪 Professional Pre-Live Verification (100+ Bar-by-Bar Trades & 4 Fault Drills)'}
        </span>
        <button
          type="button"
          className="cmd-btn cmd-btn-start"
          disabled={busy}
          onClick={onRunTest}
        >
          {busy
            ? isFa
              ? 'در حال اجرای شبیه‌سازی...'
              : 'Running Verification...'
            : isFa
            ? 'اجرای کامل تست ۱۰۰+ معامله و تست‌های ایمنی'
            : 'Run Full 100+ Trade & Safety Suite'}
        </button>
      </div>

      <p style={{ fontSize: '0.83rem', color: '#cbd5e1', marginTop: 0 }}>
        {isFa
          ? 'این آزمون روی کندل‌های چندرژیمی بازار Bit24 بدون نگاه به آینده (Zero-Lookahead)، با کسر کارمزد واقعی ۰.۲٪ هر سمت، اسلیپیج، حد ضرر ۵٪، Trailing Stop و فروش پله‌ای اجرا می‌شود و هم‌زمان قطع اینترنت، خطای API، توقف اضطراری و سفارش تکراری را آزمایش می‌کند.'
          : 'Executes zero-lookahead walk-forward trades across Bit24 markets deducting 0.2% per-side fee & slippage, while testing Internet Disconnect, API Error, Emergency Stop, and Duplicate Order guards.'}
      </p>

      {!report ? (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            background: 'rgba(56,189,248,0.08)',
            textAlign: 'center',
          }}
        >
          {isFa
            ? 'روی دکمه «اجرای کامل تست ۱۰۰+ معامله و تست‌های ایمنی» کلیک کنید تا گزارش کامل تولید شود.'
            : 'Click "Run Full 100+ Trade & Safety Suite" above to execute the pre-live verification.'}
        </div>
      ) : (
        <>
          <div className="disclaimer-bar" style={{ marginBottom: 12 }}>
            {isFa ? report.dataSufficiencyNoteFa : report.dataSufficiencyNoteEn}
          </div>

          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">
                {isFa ? 'تعداد معاملات شبیه‌سازی‌شده واقعی' : 'Executed Simulated Trades'}
              </div>
              <div className="metric-value text-gold">
                {report.simulatedTradesExecuted}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">
                {isFa ? 'سود و زیان خالص شبیه‌سازی' : 'Net Simulated PnL'}
              </div>
              <div
                className={`metric-value ${
                  report.netSimulatedPnlIrt >= 0 ? 'text-pos' : 'text-neg'
                }`}
              >
                {formatIrt(report.netSimulatedPnlIrt, lang)} ({report.netSimulatedPnlPct}%)
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">
                {isFa ? 'کارمزد کسرشده Bit24' : 'Total Bit24 Fees Paid'}
              </div>
              <div className="metric-value">
                {formatIrt(report.totalFeesPaidIrt, lang)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">
                {isFa ? 'هزینه اسلیپیج کسرشده' : 'Slippage Cost Deducted'}
              </div>
              <div className="metric-value">
                {formatIrt(report.totalSlippageCostIrt, lang)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">
                {isFa ? 'برد / باخت / نرخ برد' : 'W / L / Win Rate'}
              </div>
              <div className="metric-value">
                {report.winningTrades}W / {report.losingTrades}L ({report.winRatePct}%)
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">
                {isFa ? 'حداکثر افت سرمایه (Max DD)' : 'Max Drawdown'}
              </div>
              <div className="metric-value text-neg">-{report.maxDrawdownPct}%</div>
            </div>
          </div>

          {/* 5 Mandatory Fault-Injection Check Results */}
          <div className="metrics-grid" style={{ marginTop: 10 }}>
            <div className="metric-card">
              <div className="metric-label">{isFa ? 'محاسبه کارمزد و اسلیپیج' : 'Fee & Slippage'}</div>
              <strong className={report.faultInjectionChecks.feeAndSlippageApplied ? 'text-pos' : 'text-neg'}>
                {report.faultInjectionChecks.feeAndSlippageApplied ? 'PASSED ✓' : 'FAILED ✗'}
              </strong>
            </div>
            <div className="metric-card">
              <div className="metric-label">{isFa ? 'تست قطع اینترنت' : 'Internet Disconnect'}</div>
              <strong className={report.faultInjectionChecks.internetDisconnectTestPassed ? 'text-pos' : 'text-neg'}>
                {report.faultInjectionChecks.internetDisconnectTestPassed ? 'PASSED ✓' : 'FAILED ✗'}
              </strong>
            </div>
            <div className="metric-card">
              <div className="metric-label">{isFa ? 'تست خطای API صرافی' : 'Bit24 API Error'}</div>
              <strong className={report.faultInjectionChecks.bit24ApiErrorTestPassed ? 'text-pos' : 'text-neg'}>
                {report.faultInjectionChecks.bit24ApiErrorTestPassed ? 'PASSED ✓' : 'FAILED ✗'}
              </strong>
            </div>
            <div className="metric-card">
              <div className="metric-label">{isFa ? 'تست توقف اضطراری' : 'Emergency Stop'}</div>
              <strong className={report.faultInjectionChecks.emergencyStopTestPassed ? 'text-pos' : 'text-neg'}>
                {report.faultInjectionChecks.emergencyStopTestPassed ? 'PASSED ✓' : 'FAILED ✗'}
              </strong>
            </div>
            <div className="metric-card">
              <div className="metric-label">{isFa ? 'تست جلوگیری از سفارش تکراری' : 'Duplicate Order Guard'}</div>
              <strong className={report.faultInjectionChecks.duplicateOrderPreventionPassed ? 'text-pos' : 'text-neg'}>
                {report.faultInjectionChecks.duplicateOrderPreventionPassed ? 'PASSED ✓' : 'FAILED ✗'}
              </strong>
            </div>
          </div>

          {/* Sample Recent Simulated Trades */}
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="pro-table">
              <thead>
                <tr>
                  <th>{isFa ? 'نماد' : 'Symbol'}</th>
                  <th>{isFa ? 'قیمت ورود' : 'Buy Price'}</th>
                  <th>{isFa ? 'قیمت خروج' : 'Sell Price'}</th>
                  <th>{isFa ? 'سرمایه' : 'Capital'}</th>
                  <th>{isFa ? 'کارمزد' : 'Fee'}</th>
                  <th>{isFa ? 'سود/زیان خالص' : 'Net PnL'}</th>
                  <th>{isFa ? 'علت خروج' : 'Exit Reason'}</th>
                </tr>
              </thead>
              <tbody>
                {report.sampleTrades.slice(0, 12).map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.symbol}</strong></td>
                    <td>{formatIrt(t.buyPriceIrt, lang)}</td>
                    <td>{formatIrt(t.sellPriceIrt, lang)}</td>
                    <td>{formatIrt(t.capitalEnteredIrt, lang)}</td>
                    <td>{formatIrt(t.totalFeeIrt, lang)}</td>
                    <td className={t.netPnlIrt >= 0 ? 'text-pos' : 'text-neg'}>
                      {formatIrt(t.netPnlIrt, lang)} ({t.netPnlPct}%)
                    </td>
                    <td>{isFa ? t.sellReasonFa : t.sellReasonEn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
