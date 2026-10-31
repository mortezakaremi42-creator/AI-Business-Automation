import React from 'react';
import {
  AppLanguage,
  PeriodReportSummary,
  TradeHistoryRecord,
} from '../../shared/contracts.js';
import { formatIrt } from '../i18n.js';

interface Props {
  lang: AppLanguage;
  daily: PeriodReportSummary;
  weekly: PeriodReportSummary;
  monthly: PeriodReportSummary;
  trades: TradeHistoryRecord[];
  onExportCsv: () => void;
}

export const TradeHistoryPanel: React.FC<Props> = ({
  lang,
  daily,
  weekly,
  monthly,
  trades,
  onExportCsv,
}) => {
  const isFa = lang === 'fa';
  const formatTime = (ms: number) =>
    new Date(ms).toLocaleString(isFa ? 'fa-IR' : 'en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  const renderSummaryCard = (title: string, rep: PeriodReportSummary) => (
    <div className="metric-card" key={title}>
      <div className="metric-label" style={{ fontWeight: 800, color: '#f5b942' }}>
        {title}
      </div>
      <div
        className={`metric-value ${
          rep.netPnlIrt >= 0 ? 'text-pos' : 'text-neg'
        }`}
      >
        {formatIrt(rep.netPnlIrt, lang)} ({rep.netReturnPct}%)
      </div>
      <div style={{ fontSize: '0.77rem', color: '#9db4c8', marginTop: 4 }}>
        {isFa
          ? `تعداد: ${rep.tradesCount} | برد: ${rep.winningTrades} | باخت: ${rep.losingTrades} | نرخ برد: ${rep.winRatePct}% | کارمزد: ${rep.totalFeesIrt.toLocaleString('fa-IR')}`
          : `Trades: ${rep.tradesCount} | W: ${rep.winningTrades} | L: ${rep.losingTrades} | WinRate: ${rep.winRatePct}% | Fees: ${rep.totalFeesIrt.toLocaleString()}`}
      </div>
    </div>
  );

  return (
    <div className="section-card">
      <div className="section-title">
        <span>
          {isFa
            ? '📊 گزارش‌های کامل معاملات (روزانه، هفتگی، ماهانه و جدول ۱۱ ستونی)'
            : '📊 Complete Trade Reports (Daily, Weekly, Monthly & 11-Field Ledger)'}
        </span>
        <button
          type="button"
          className="cmd-btn cmd-btn-start"
          onClick={onExportCsv}
        >
          {isFa ? 'دانلود فایل CSV تاریخچه معاملات' : 'Download CSV Ledger'}
        </button>
      </div>

      <div className="metrics-grid">
        {renderSummaryCard(
          isFa ? 'گزارش روزانه (۲۴ ساعت اخیر)' : 'Daily Report (24h)',
          daily
        )}
        {renderSummaryCard(
          isFa ? 'گزارش هفتگی (۷ روز اخیر)' : 'Weekly Report (7d)',
          weekly
        )}
        {renderSummaryCard(
          isFa ? 'گزارش ماهانه (۳۰ روز اخیر)' : 'Monthly Report (30d)',
          monthly
        )}
      </div>

      <div className="table-scroll">
        <table className="pro-table">
          <thead>
            <tr>
              <th>{isFa ? 'نماد ارز' : 'Symbol'}</th>
              <th>{isFa ? 'زمان خرید' : 'Buy Time'}</th>
              <th>{isFa ? 'قیمت خرید' : 'Buy Price'}</th>
              <th>{isFa ? 'زمان فروش' : 'Sell Time'}</th>
              <th>{isFa ? 'قیمت فروش' : 'Sell Price'}</th>
              <th>{isFa ? 'مقدار سرمایه' : 'Capital'}</th>
              <th>{isFa ? 'کارمزد کل' : 'Total Fee'}</th>
              <th>{isFa ? 'سود/زیان خالص' : 'Net PnL'}</th>
              <th>{isFa ? 'درصد بازدهی' : 'Return %'}</th>
              <th>{isFa ? 'دلیل خرید' : 'Buy Reason'}</th>
              <th>{isFa ? 'دلیل فروش' : 'Sell Reason'}</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: 20 }}>
                  {isFa
                    ? 'هنوز معامله بسته‌شده‌ای در این نشست ثبت نشده است. با دکمه START DEMO TRADING معامله آزمایشی را آغاز کنید.'
                    : 'No closed trades recorded yet in this session. Press START DEMO TRADING to begin.'}
                </td>
              </tr>
            ) : (
              trades.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.symbol}</strong> ({t.segment})
                  </td>
                  <td>{formatTime(t.buyTime)}</td>
                  <td>{formatIrt(t.buyPriceIrt, lang)}</td>
                  <td>{formatTime(t.sellTime)}</td>
                  <td>{formatIrt(t.sellPriceIrt, lang)}</td>
                  <td>{formatIrt(t.capitalEnteredIrt, lang)}</td>
                  <td>{formatIrt(t.totalFeeIrt, lang)}</td>
                  <td className={t.netPnlIrt >= 0 ? 'text-pos' : 'text-neg'}>
                    <strong>{formatIrt(t.netPnlIrt, lang)}</strong>
                  </td>
                  <td className={t.netPnlPct >= 0 ? 'text-pos' : 'text-neg'}>
                    {t.netPnlPct >= 0 ? '+' : ''}
                    {t.netPnlPct}%
                  </td>
                  <td>{isFa ? t.buyReasonFa : t.buyReasonEn}</td>
                  <td>{isFa ? t.sellReasonFa : t.sellReasonEn}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
