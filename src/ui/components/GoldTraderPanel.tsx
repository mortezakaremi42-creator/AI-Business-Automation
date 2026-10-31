import React from 'react';
import { AppLanguage, GoldPortfolioReport } from '../../shared/contracts.js';
import { formatIrt } from '../i18n.js';

interface Props {
  lang: AppLanguage;
  goldReport: GoldPortfolioReport;
  goldAutoEnabled: boolean;
  onToggleAutoGold: (enabled: boolean) => void;
  onManualGoldBuy: (symbol: 'PAXG/IRT' | 'XAUT/IRT') => void;
}

export const GoldTraderPanel: React.FC<Props> = ({
  lang,
  goldReport,
  goldAutoEnabled,
  onToggleAutoGold,
  onManualGoldBuy,
}) => {
  const isFa = lang === 'fa';

  return (
    <div className="section-card">
      <div className="section-title">
        <span>
          {isFa
            ? '🪙 ماژول مستقل طلای دیجیتال (GOLD AI TRADER — فقط PAXG و XAUT در Bit24)'
            : '🪙 Independent Digital Gold Module (GOLD AI TRADER — PAXG & XAUT on Bit24)'}
        </span>
        <button
          type="button"
          className={`cmd-btn ${goldAutoEnabled ? 'cmd-btn-start' : 'cmd-btn-gold'}`}
          onClick={() => onToggleAutoGold(!goldAutoEnabled)}
        >
          {goldAutoEnabled
            ? isFa
              ? 'معامله دمو خودکار طلا: فعال'
              : 'Auto Gold Demo: ON'
            : isFa
            ? 'فعال‌سازی دمو خودکار طلا'
            : 'Enable Auto Gold Demo'}
        </button>
      </div>

      <p style={{ fontSize: '0.84rem', color: '#cbd5e1', marginTop: 0 }}>
        {isFa
          ? 'تفکیک کامل پرتفوی: سرمایه، مدیریت ریسک و گزارش سود و زیان طلای دیجیتال کاملاً مستقل از رمزارزها و میم‌کوین‌ها محاسبه می‌شود. ابتدا قابلیت معامله واقعی هر نماد در صرافی Bit24 بررسی می‌گردد.'
          : 'Strict Portfolio Isolation: Digital Gold capital, risk rules, and PnL reports are strictly separated from crypto/meme coins. Tradability on Bit24 is verified first.'}
      </p>

      {/* Independent Gold PnL Summary */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">
            {isFa ? 'وضعیت PAXG در Bit24' : 'PAXG on Bit24'}
          </div>
          <div className="metric-value text-gold">
            {goldReport.paxgTradableOnBit24
              ? isFa
                ? 'تأیید شده (قابل معامله)'
                : 'Verified Tradable'
              : isFa
              ? 'غیرقابل معامله'
              : 'Not Tradable'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">
            {isFa ? 'وضعیت XAUT در Bit24' : 'XAUT on Bit24'}
          </div>
          <div className="metric-value text-gold">
            {goldReport.xautTradableOnBit24
              ? isFa
                ? 'تأیید شده (قابل معامله)'
                : 'Verified Tradable'
              : isFa
              ? 'غیرقابل معامله'
              : 'Not Tradable'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">
            {isFa ? 'سود و زیان خالص طلا (مجزا)' : 'Isolated Gold Net PnL'}
          </div>
          <div
            className={`metric-value ${
              goldReport.goldNetPnlIrt >= 0 ? 'text-pos' : 'text-neg'
            }`}
          >
            {formatIrt(goldReport.goldNetPnlIrt, lang)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">
            {isFa ? 'معاملات بسته طلا / نرخ برد' : 'Gold Trades / Win Rate'}
          </div>
          <div className="metric-value">
            {goldReport.goldTotalTrades} ({goldReport.goldWinRatePct}%)
          </div>
        </div>
      </div>

      {/* PAXG & XAUT Live Signal Cards */}
      <div className="opp-grid">
        {goldReport.goldSignals.map((g) => (
          <div key={g.symbol} className="opp-card">
            <div className="opp-header">
              <div>
                <strong style={{ fontSize: '1.02rem', color: '#f5b942' }}>
                  {g.symbol}
                </strong>
                <div style={{ fontSize: '0.78rem', color: '#9db4c8' }}>
                  {isFa ? g.faName : g.enName}
                </div>
              </div>
              <span className="badge badge-gold">
                {isFa ? `امتیاز طلا: ${g.goldScore}/100` : `Gold Score: ${g.goldScore}/100`}
              </span>
            </div>

            <div style={{ fontSize: '0.8rem', color: '#a7f3d0', marginBottom: 6 }}>
              {isFa ? g.tradabilityNoteFa : g.tradabilityNoteEn}
            </div>

            <div className="mini-stats">
              <div>
                <div className="metric-label">{isFa ? 'قیمت طلا' : 'Gold Price'}</div>
                <strong>{formatIrt(g.priceIrt, lang)}</strong>
              </div>
              <div>
                <div className="metric-label">{isFa ? 'روند کوتاه‌مدت' : 'Short Trend'}</div>
                <strong>{g.shortTermTrend}</strong>
              </div>
              <div>
                <div className="metric-label">RSI / MACD</div>
                <strong>
                  {g.rsi14} / {g.macdHistogram >= 0 ? '+' : ''}
                  {g.macdHistogram.toFixed(1)}
                </strong>
              </div>
              <div>
                <div className="metric-label">{isFa ? 'حمایت کلیدی' : 'Support'}</div>
                <strong>{formatIrt(g.supportIrt, lang)}</strong>
              </div>
              <div>
                <div className="metric-label">{isFa ? 'مقاومت کلیدی' : 'Resistance'}</div>
                <strong>{formatIrt(g.resistanceIrt, lang)}</strong>
              </div>
              <div>
                <div className="metric-label">{isFa ? 'کارمزد رفت‌وبرگشت' : 'Round-trip Fee'}</div>
                <strong>{g.roundTripFeePct}%</strong>
              </div>
              <div>
                <div className="metric-label">{isFa ? 'حد ضرر پیشنهادی' : 'Suggested SL'}</div>
                <strong className="text-neg">{formatIrt(g.suggestedStopLossIrt, lang)}</strong>
              </div>
              <div>
                <div className="metric-label">{isFa ? 'حد سود پیشنهادی' : 'Suggested TP'}</div>
                <strong className="text-pos">{formatIrt(g.suggestedTakeProfitIrt, lang)}</strong>
              </div>
              <div>
                <div className="metric-label">{isFa ? 'حجم ۲۴ ساعته' : '24h Volume'}</div>
                <strong>{Math.round(g.volume24hIrt / 1_000_000_000)}B IRT</strong>
              </div>
            </div>

            <p style={{ fontSize: '0.8rem', margin: '8px 0' }}>
              {isFa ? g.rationaleFa : g.rationaleEn}
            </p>

            <button
              type="button"
              className="cmd-btn cmd-btn-gold"
              style={{ width: '100%' }}
              disabled={!g.verifiedTradableOnBit24}
              onClick={() => onManualGoldBuy(g.symbol)}
            >
              {g.verifiedTradableOnBit24
                ? isFa
                  ? `خرید آزمایشی (Demo) ${g.symbol} در پرتفوی مجزای طلا`
                  : `Execute Demo Gold Buy (${g.symbol})`
                : isFa
                ? 'غیرقابل معامله در Bit24'
                : 'Not Tradable on Bit24'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
