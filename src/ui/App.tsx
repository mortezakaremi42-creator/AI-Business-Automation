import React, { useEffect, useState } from 'react';
import { AppLanguage } from '../shared/contracts.js';
import { ApiAndTelegramPanel } from './components/ApiAndTelegramPanel.js';
import { GoldTraderPanel } from './components/GoldTraderPanel.js';
import { ProVerificationPanel } from './components/ProVerificationPanel.js';
import { RiskManagementPanel } from './components/RiskManagementPanel.js';
import { TradeHistoryPanel } from './components/TradeHistoryPanel.js';
import { formatIrt, formatTierBadge, UI_TEXT } from './i18n.js';
import { useBit24Controller } from './useBit24Controller.js';

type ActiveSection =
  | 'MAIN'
  | 'GOLD'
  | 'RISK'
  | 'HISTORY'
  | 'API_SETTINGS'
  | 'PRO_TEST';

export const App: React.FC = () => {
  const [lang, setLang] = useState<AppLanguage>('fa');
  const [activeSection, setActiveSection] = useState<ActiveSection>('MAIN');
  const [deferredPwaPrompt, setDeferredPwaPrompt] = useState<any>(null);

  const ctrl = useBit24Controller();
  const snap = ctrl.snapshot;
  const t = UI_TEXT[lang];
  const isFa = lang === 'fa';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isFa ? 'rtl' : 'ltr';
  }, [lang, isFa]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPwaPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallAndroid = async () => {
    if (deferredPwaPrompt) {
      deferredPwaPrompt.prompt();
      await deferredPwaPrompt.userChoice;
      setDeferredPwaPrompt(null);
    } else {
      alert(
        isFa
          ? 'برای نصب مستقیم روی اندروید: در مرورگر کروم (Chrome) منوی سه نقطه بالا را بزنید و گزینه «Add to Home screen / Install app» را انتخاب نمایید.'
          : 'To install on Android: tap the Chrome 3-dot menu and choose "Install app / Add to Home screen".'
      );
    }
  };

  return (
    <div className="app-shell">
      {/* Top Header */}
      <header className="top-header">
        <div>
          <h1 className="brand-title">{t.appTitle}</h1>
          <p className="brand-subtitle">{t.appSubtitle}</p>
        </div>

        <div className="header-badges">
          <span
            className={`badge ${
              snap.liveTradingUserConfirmed ? 'badge-danger' : 'badge-safe-lock'
            }`}
          >
            {snap.liveTradingUserConfirmed ? t.liveActiveBadge : t.liveLockedBadge}
          </span>

          <button
            type="button"
            className="cmd-btn cmd-btn-gold"
            style={{ minHeight: 36, padding: '6px 12px' }}
            onClick={handleInstallAndroid}
          >
            📲 {t.installAndroidBtn}
          </button>

          <button
            type="button"
            className="cmd-btn"
            style={{ minHeight: 36, padding: '6px 12px' }}
            onClick={() => setLang(isFa ? 'en' : 'fa')}
          >
            🌐 {t.langSwitchBtn}
          </button>
        </div>
      </header>

      {/* Strict Profit & Bit24-Only Disclaimer */}
      <div className="disclaimer-bar">{t.disclaimerBanner}</div>

      {ctrl.toastMessage && (
        <div className="toast-banner">{ctrl.toastMessage}</div>
      )}

      {/* 10 Mandatory Android Main Panel Metrics */}
      <section className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">{t.demoBalance}</div>
          <div className="metric-value text-gold">
            {formatIrt(snap.demoBalanceIrt, lang)}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.dailyPnl}</div>
          <div
            className={`metric-value ${
              snap.dailyPnlIrt >= 0 ? 'text-pos' : 'text-neg'
            }`}
          >
            {formatIrt(snap.dailyPnlIrt, lang)} ({snap.dailyPnlPct}%)
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.totalPnl}</div>
          <div
            className={`metric-value ${
              snap.totalPnlIrt >= 0 ? 'text-pos' : 'text-neg'
            }`}
          >
            {formatIrt(snap.totalPnlIrt, lang)} ({snap.totalPnlPct}%)
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.winningTrades}</div>
          <div className="metric-value text-pos">{snap.winningTrades}</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.losingTrades}</div>
          <div className="metric-value text-neg">{snap.losingTrades}</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.winRate}</div>
          <div className="metric-value">{snap.winRatePct}%</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.openTrades}</div>
          <div className="metric-value">
            {snap.openPositions.length} / {snap.capitalConfig.maxConcurrentTrades}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.bit24Status}</div>
          <div
            className={`metric-value ${
              snap.bit24Connection.activeMarketFeed === 'LIVE_BIT24_API'
                ? 'text-pos'
                : 'text-gold'
            }`}
            style={{ fontSize: '0.88rem' }}
          >
            {snap.bit24Connection.activeMarketFeed === 'LIVE_BIT24_API'
              ? isFa
                ? 'API رسمی زنده Bit24'
                : 'Live Official Bit24 API'
              : isFa
              ? 'فید شبیه‌ساز دمو Bit24'
              : 'Bit24 Safe Demo Feed'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.capitalSecurity}</div>
          <div
            className={`metric-value ${
              snap.capitalSecurity.level === 'PROTECTED' ? 'text-pos' : 'text-neg'
            }`}
            style={{ fontSize: '0.88rem' }}
          >
            {snap.capitalSecurity.level}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">{t.activeMode}</div>
          <div className="metric-value" style={{ fontSize: '0.9rem' }}>
            {snap.emergencyStopped
              ? 'EMERGENCY HALTED'
              : `${snap.tradingMode} | ${
                  snap.scannerRunning ? 'SCAN ON' : 'SCAN OFF'
                }`}
          </div>
        </div>
      </section>

      {/* All 9 Required Control Buttons + Main/Pro100 Navigation */}
      <nav className="command-panel">
        <button
          type="button"
          className="cmd-btn cmd-btn-start"
          disabled={snap.scannerRunning}
          onClick={ctrl.startScanner}
        >
          {t.btnStartScanner}
        </button>

        <button
          type="button"
          className="cmd-btn cmd-btn-stop"
          disabled={!snap.scannerRunning}
          onClick={ctrl.stopScanner}
        >
          {t.btnStopScanner}
        </button>

        <button
          type="button"
          className="cmd-btn cmd-btn-start"
          disabled={snap.tradingMode === 'DEMO'}
          onClick={ctrl.startDemoTrading}
        >
          {t.btnStartDemo}
        </button>

        <button
          type="button"
          className="cmd-btn cmd-btn-stop"
          disabled={snap.tradingMode === 'STOPPED'}
          onClick={ctrl.stopTrading}
        >
          {t.btnStopTrading}
        </button>

        <button
          type="button"
          className="cmd-btn cmd-btn-emergency"
          onClick={
            snap.emergencyStopped ? ctrl.clearEmergencyStop : ctrl.emergencyStop
          }
        >
          {snap.emergencyStopped
            ? isFa
              ? 'رفع توقف اضطراری | CLEAR HALT'
              : 'CLEAR EMERGENCY STOP'
            : t.btnEmergencyStop}
        </button>

        <button
          type="button"
          className={`cmd-btn cmd-btn-gold ${
            activeSection === 'GOLD' ? 'cmd-btn-active-tab' : ''
          }`}
          onClick={() => setActiveSection('GOLD')}
        >
          {t.btnGoldTrading}
        </button>

        <button
          type="button"
          className={`cmd-btn ${
            activeSection === 'RISK' ? 'cmd-btn-active-tab' : ''
          }`}
          onClick={() => setActiveSection('RISK')}
        >
          {t.btnRiskManagement}
        </button>

        <button
          type="button"
          className={`cmd-btn ${
            activeSection === 'HISTORY' ? 'cmd-btn-active-tab' : ''
          }`}
          onClick={() => setActiveSection('HISTORY')}
        >
          {t.btnTradeHistory}
        </button>

        <button
          type="button"
          className={`cmd-btn ${
            activeSection === 'API_SETTINGS' ? 'cmd-btn-active-tab' : ''
          }`}
          onClick={() => setActiveSection('API_SETTINGS')}
        >
          {t.btnApiSettings}
        </button>

        <button
          type="button"
          className={`cmd-btn ${
            activeSection === 'PRO_TEST' ? 'cmd-btn-active-tab' : ''
          }`}
          onClick={() => setActiveSection('PRO_TEST')}
        >
          {t.btnProTest}
        </button>

        <button
          type="button"
          className={`cmd-btn ${
            activeSection === 'MAIN' ? 'cmd-btn-active-tab' : ''
          }`}
          onClick={() => setActiveSection('MAIN')}
        >
          {t.btnDashboard}
        </button>
      </nav>

      {/* Active View Body */}
      {activeSection === 'GOLD' && (
        <GoldTraderPanel
          lang={lang}
          goldReport={snap.goldReport}
          goldAutoEnabled={snap.goldTradingEnabled}
          onToggleAutoGold={ctrl.toggleGoldAutoDemo}
          onManualGoldBuy={ctrl.manualGoldDemoBuy}
        />
      )}

      {activeSection === 'RISK' && (
        <RiskManagementPanel
          lang={lang}
          capitalConfig={snap.capitalConfig}
          exitConfig={snap.exitConfig}
          onSave={ctrl.updateRiskSettings}
        />
      )}

      {activeSection === 'HISTORY' && (
        <TradeHistoryPanel
          lang={lang}
          daily={snap.periodReports.daily}
          weekly={snap.periodReports.weekly}
          monthly={snap.periodReports.monthly}
          trades={snap.tradeHistory}
          onExportCsv={ctrl.downloadTradesCsv}
        />
      )}

      {activeSection === 'API_SETTINGS' && (
        <ApiAndTelegramPanel
          lang={lang}
          bit24Health={snap.bit24Connection}
          telegramState={snap.telegram}
          onSaveBit24={ctrl.saveBit24Credentials}
          onVerifyBit24={ctrl.verifyBit24Connection}
          onClearBit24={ctrl.clearBit24Credentials}
          onSaveTelegram={ctrl.saveTelegramSettings}
          onSendDailyTelegram={ctrl.sendDailyTelegramReport}
        />
      )}

      {activeSection === 'PRO_TEST' && (
        <ProVerificationPanel
          lang={lang}
          report={snap.latestVerificationReport}
          busy={ctrl.busyAction === 'pro100'}
          onRunTest={ctrl.runPro100Test}
        />
      )}

      {activeSection === 'MAIN' && (
        <>
          {/* Open Positions Table */}
          <section className="section-card">
            <h2 className="section-title">
              <span>{t.openPositionsTitle}</span>
              <span style={{ fontSize: '0.8rem', color: '#9db4c8' }}>
                {isFa ? snap.capitalSecurity.summaryFa : snap.capitalSecurity.summaryEn}
              </span>
            </h2>

            {snap.openPositions.length === 0 ? (
              <div style={{ color: '#9db4c8', fontSize: '0.86rem' }}>
                {t.noOpenPositions}
              </div>
            ) : (
              <div className="table-scroll">
                <table className="pro-table">
                  <thead>
                    <tr>
                      <th>{isFa ? 'نماد' : 'Symbol'}</th>
                      <th>{isFa ? 'قیمت ورود' : 'Entry'}</th>
                      <th>{isFa ? 'قیمت فعلی' : 'Current'}</th>
                      <th>{isFa ? 'سرمایه درگیر' : 'Capital'}</th>
                      <th>{isFa ? 'حد ضرر فعال' : 'Active SL'}</th>
                      <th>Trailing Stop</th>
                      <th>{isFa ? 'فروش پله‌ای (TP 1/2/3)' : 'Stepped TP'}</th>
                      <th>{isFa ? 'سود/زیان باز' : 'Unrealized PnL'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.openPositions.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.symbol}</strong>
                        </td>
                        <td>{formatIrt(p.entryPriceIrt, lang)}</td>
                        <td>{formatIrt(p.currentPriceIrt, lang)}</td>
                        <td>{formatIrt(p.remainingCapitalIrt, lang)}</td>
                        <td className="text-neg">
                          {formatIrt(p.activeStopLossIrt, lang)}
                        </td>
                        <td>
                          {p.trailingStopActive
                            ? `ON (${formatIrt(p.trailingStopPriceIrt || 0, lang)})`
                            : 'Waiting (+8%)'}
                        </td>
                        <td>
                          {p.tpStage1Filled ? '✓30%' : '○30%'} |{' '}
                          {p.tpStage2Filled ? '✓30%' : '○30%'} |{' '}
                          {p.tpStage3Filled ? '✓40%' : '○40%'}
                        </td>
                        <td
                          className={
                            p.unrealizedPnlIrt >= 0 ? 'text-pos' : 'text-neg'
                          }
                        >
                          <strong>
                            {formatIrt(p.unrealizedPnlIrt, lang)} ({p.unrealizedPnlPct}%)
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* AI Pump Hunter Top Opportunities */}
          <section className="section-card">
            <h2 className="section-title">
              <span>🚀 {t.topOpportunitiesTitle}</span>
              <span className="badge badge-gold">
                {isFa
                  ? '۰–۵۹ رد | ۶۰–۷۴ هشدار | ۷۵–۸۴ بررسی | ۸۵–۱۰۰ سیگنال قوی آزمایش'
                  : '<60 Reject | 60–74 Alert | 75–84 Review | 85–100 Strong Test Signal'}
              </span>
            </h2>

            <div className="opp-grid">
              {snap.topOpportunities.map((sig) => {
                const badge = formatTierBadge(sig.tier, lang);
                return (
                  <div key={sig.symbol} className="opp-card">
                    <div className="opp-header">
                      <div>
                        <strong style={{ fontSize: '1.03rem' }}>
                          {sig.symbol}
                        </strong>
                        <div style={{ fontSize: '0.78rem', color: '#9db4c8' }}>
                          {isFa ? sig.faName : sig.enName} •{' '}
                          {formatIrt(sig.priceIrt, lang)}
                        </div>
                      </div>
                      <span className={`badge ${badge.colorClass}`}>
                        {sig.opportunityScore}/100
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: '0.77rem',
                        marginBottom: 6,
                        fontWeight: 700,
                      }}
                    >
                      {badge.label}
                    </div>

                    <div className="mini-stats">
                      <div>
                        <div className="metric-label">1m / 5m</div>
                        <strong>
                          {sig.change1mPct}% / {sig.change5mPct}%
                        </strong>
                      </div>
                      <div>
                        <div className="metric-label">15m / 60m</div>
                        <strong>
                          {sig.change15mPct}% / {sig.change60mPct}%
                        </strong>
                      </div>
                      <div>
                        <div className="metric-label">24h</div>
                        <strong
                          className={
                            sig.change24hPct >= 0 ? 'text-pos' : 'text-neg'
                          }
                        >
                          {sig.change24hPct}%
                        </strong>
                      </div>
                      <div>
                        <div className="metric-label">
                          {isFa ? 'قدرت خریدار' : 'Buyer Power'}
                        </div>
                        <strong>{sig.indicators.buyerPowerPct}%</strong>
                      </div>
                      <div>
                        <div className="metric-label">
                          {isFa ? 'رشد حجم' : 'Vol Surge'}
                        </div>
                        <strong>{sig.indicators.volumeSurgeRatio}x</strong>
                      </div>
                      <div>
                        <div className="metric-label">RSI / ATR</div>
                        <strong>
                          {sig.indicators.rsi14} / {sig.indicators.atrPct}%
                        </strong>
                      </div>
                    </div>

                    {sig.reasonsFa.length > 0 && (
                      <ul className="reason-list">
                        {(isFa ? sig.reasonsFa : sig.reasonsEn)
                          .slice(0, 3)
                          .map((r, idx) => (
                            <li key={idx}>{r}</li>
                          ))}
                      </ul>
                    )}

                    {sig.warningsFa.length > 0 && (
                      <ul className="warn-list">
                        {(isFa ? sig.warningsFa : sig.warningsEn)
                          .slice(0, 2)
                          .map((w, idx) => (
                            <li key={idx}>⚠️ {w}</li>
                          ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      className="cmd-btn cmd-btn-start"
                      style={{ width: '100%', marginTop: 6 }}
                      disabled={
                        sig.opportunityScore < 60 || snap.emergencyStopped
                      }
                      onClick={() => ctrl.manualDemoBuy(sig.symbol)}
                    >
                      {sig.opportunityScore < 60
                        ? isFa
                          ? 'رد شده توسط شکارچی پامپ / SMART SECURITY'
                          : 'Blocked by Pump Hunter / SMART SECURITY'
                        : `${t.demoBuyNow} (${sig.symbol})`}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* SMART SECURITY Rejection Audit Log */}
          <section className="section-card">
            <h2 className="section-title">{t.securityRejectionsTitle}</h2>
            {snap.recentRejections.length === 0 ? (
              <div style={{ fontSize: '0.84rem', color: '#9db4c8' }}>
                {t.noRejectionsYet}
              </div>
            ) : (
              <ul className="warn-list">
                {snap.recentRejections.slice(0, 10).map((rej) => (
                  <li key={rej.id}>
                    <strong>[{rej.symbol} • {rej.code}]</strong>{' '}
                    {isFa ? rej.reasonFa : rej.reasonEn}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};
