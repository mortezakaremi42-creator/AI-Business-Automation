import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  Coins,
  Home,
  Rocket,
  ShieldCheck,
  Sliders,
  TrendingUp,
  Wifi,
} from 'lucide-react';
import { AntiRugSecurityView } from './components/AntiRugSecurityView';
import { ApiAndNetworkView } from './components/ApiAndNetworkView';
import { Bit24ApiModal } from './components/Bit24ApiModal';
import {
  EmergencyConfirmModal,
  SafetyModalKind,
} from './components/EmergencyConfirmModal';
import { GoldEngineView } from './components/GoldEngineView';
import { HomeOverview, NavTabId } from './components/HomeOverview';
import { InstallAndroidModal } from './components/InstallAndroidModal';
import { MemeHunterView } from './components/MemeHunterView';
import { PnLAndHistoryView } from './components/PnLAndHistoryView';
import { RiskAndTpSlSettings } from './components/RiskAndTpSlSettings';
import { SignalsAndBacktestView } from './components/SignalsAndBacktestView';
import { SpotAndLeverageView } from './components/SpotAndLeverageView';
import { TopCommandBar } from './components/TopCommandBar';
import { usePlatformState } from './hooks/usePlatformState';
import { usePwaInstall } from './hooks/usePwaInstall';

export const App: React.FC = () => {
  const {
    snapshot,
    busyAction,
    toast,
    connectBit24Api,
    disconnectBit24Api,
    toggleModule,
    togglePauseNewTrades,
    resetCircuitBreaker,
    setEnvironmentMode,
    saveSettings,
    triggerScanNow,
    emergencyStopAll,
    emergencyLiquidateAll,
    closeSinglePosition,
    executePaperSignal,
    runBacktest,
    downloadHistoryCsv,
    inspectContractAddress,
    testAntiRugDemoBuy,
    simulateAntiRugState,
    updateAntiRugSettings,
  } = usePlatformState();

  const { canPromptInstall, isStandalone, triggerInstall } = usePwaInstall();

  const [activeTab, setActiveTab] = useState<NavTabId>('HOME');
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [safetyModal, setSafetyModal] = useState<SafetyModalKind>(null);

  const navItems: { id: NavTabId; label: string; icon: React.ReactNode }[] = [
    { id: 'HOME', label: 'خانه', icon: <Home className="h-4 w-4" /> },
    {
      id: 'ANTI_RUG',
      label: 'ANTI-RUG SECURITY',
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    { id: 'MEME', label: 'شکار پامپ 🚀', icon: <Rocket className="h-4 w-4" /> },
    { id: 'SPOT_LEVERAGE', label: 'رمزارز اسپات', icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'GOLD', label: 'طلا (PAXG)', icon: <Coins className="h-4 w-4" /> },
    { id: 'SIGNALS', label: 'سیگنال/بک‌تست', icon: <Activity className="h-4 w-4" /> },
    { id: 'SETTINGS', label: 'تنظیم ریسک', icon: <Sliders className="h-4 w-4" /> },
    { id: 'REPORTS_HISTORY', label: 'گزارش/CSV', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'API_STATUS', label: 'وضعیت API', icon: <Wifi className="h-4 w-4" /> },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-[#090D16] text-slate-100 pb-safe">
      <TopCommandBar
        snapshot={snapshot}
        canInstallPwa={canPromptInstall}
        isStandalonePwa={isStandalone}
        onOpenConnectModal={() => setConnectModalOpen(true)}
        onOpenEmergencyModal={() => setSafetyModal('EMERGENCY_STOP')}
        onOpenApiHealthTab={() => setActiveTab('API_STATUS')}
        onOpenAntiRugTab={() => setActiveTab('ANTI_RUG')}
        onOpenInstallModal={() => setInstallModalOpen(true)}
      />

      {toast && (
        <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md">
          <div
            className={`rounded-xl border px-4 py-3 text-xs font-extrabold shadow-2xl ${
              toast.type === 'ok'
                ? 'border-emerald-500/50 bg-slate-900/95 text-emerald-300'
                : 'border-rose-500/50 bg-slate-900/95 text-rose-300'
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-5">
        {activeTab === 'HOME' && (
          <HomeOverview
            snapshot={snapshot}
            busyAction={busyAction}
            onNavigate={setActiveTab}
            onScanNow={() =>
              triggerScanNow('اسکن جامع بازارهای رمزارز و طلای دیجیتال بیت‌۲۴ انجام شد.')
            }
            onOpenConnectBit24={() => setConnectModalOpen(true)}
            onStartPaperTrading={async () => {
              await setEnvironmentMode('PAPER');
              await togglePauseNewTrades(false);
              await toggleModule('DIGITAL_GOLD', true);
              await toggleModule('SPOT_CRYPTO', true);
              await toggleModule('MEME_HUNTER', true);
              await triggerScanNow(
                'حالت معاملات آزمایشی (Paper Trading) برای ماژول‌های رمزارز و طلا فعال شد.'
              );
            }}
            onRequestLiveTrading={() => setSafetyModal('CONFIRM_LIVE_TRADING')}
            onTogglePauseNewTrades={togglePauseNewTrades}
            onResetCircuitBreaker={resetCircuitBreaker}
            onOpenEmergencyStop={() => setSafetyModal('EMERGENCY_STOP')}
            onDownloadCsv={downloadHistoryCsv}
            onClosePosition={closeSinglePosition}
            onExecutePaperSignal={executePaperSignal}
            onToggleModule={toggleModule}
          />
        )}

        {activeTab === 'ANTI_RUG' && (
          <AntiRugSecurityView
            snapshot={snapshot}
            busyAction={busyAction}
            onInspectContract={inspectContractAddress}
            onTestDemoBuy={testAntiRugDemoBuy}
            onSimulateState={simulateAntiRugState}
            onSaveAntiRugConfig={updateAntiRugSettings}
          />
        )}

        {activeTab === 'GOLD' && (
          <GoldEngineView
            snapshot={snapshot}
            onStartGoldAnalysis={() =>
              triggerScanNow('تحلیل لحظه‌ای PAXG و XAUT بروزرسانی شد.')
            }
            onToggleGoldBot={(enabled) => toggleModule('DIGITAL_GOLD', enabled)}
            onExecutePaperSignal={executePaperSignal}
          />
        )}

        {activeTab === 'MEME' && (
          <MemeHunterView
            snapshot={snapshot}
            onScanMemeMarkets={() =>
              triggerScanNow('رادار میم‌کوین‌های بیت‌۲۴ بروزرسانی شد.')
            }
            onToggleMemeBot={(enabled) => toggleModule('MEME_HUNTER', enabled)}
            onExecutePaperSignal={executePaperSignal}
          />
        )}

        {activeTab === 'SPOT_LEVERAGE' && (
          <SpotAndLeverageView
            snapshot={snapshot}
            onStartCryptoAnalysis={() =>
              triggerScanNow('اسکن رمزارزهای اسپات بیت‌۲۴ بروزرسانی شد.')
            }
            onToggleModule={toggleModule}
            onExecutePaperSignal={executePaperSignal}
          />
        )}

        {activeTab === 'SIGNALS' && (
          <SignalsAndBacktestView
            snapshot={snapshot}
            onExecutePaperSignal={executePaperSignal}
            onRunBacktest={runBacktest}
          />
        )}

        {activeTab === 'SETTINGS' && (
          <RiskAndTpSlSettings settings={snapshot.settings} onSave={saveSettings} />
        )}

        {activeTab === 'REPORTS_HISTORY' && (
          <PnLAndHistoryView
            snapshot={snapshot}
            onDownloadCsv={downloadHistoryCsv}
            onRequestSeparateLiquidation={() => setSafetyModal('SEPARATE_LIQUIDATE')}
          />
        )}

        {activeTab === 'API_STATUS' && (
          <ApiAndNetworkView
            snapshot={snapshot}
            onOpenConnectModal={() => setConnectModalOpen(true)}
            onRefreshNow={() => triggerScanNow('بررسی وضعیت API و شبکه انجام شد.')}
          />
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800/95 bg-[#090D16]/95 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between overflow-x-auto px-1 py-1.5">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-w-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-bold transition ${
                  active
                    ? item.id === 'ANTI_RUG'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : item.id === 'MEME'
                        ? 'bg-fuchsia-500/20 text-fuchsia-300'
                        : 'bg-amber-500/15 text-amber-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <Bit24ApiModal
        open={connectModalOpen}
        health={snapshot.health}
        onClose={() => setConnectModalOpen(false)}
        onConnect={connectBit24Api}
        onDisconnect={disconnectBit24Api}
      />

      <EmergencyConfirmModal
        kind={safetyModal}
        openPositionsCount={snapshot.openPositions.length}
        bit24Connected={snapshot.health.bit24ApiConfigured}
        onClose={() => setSafetyModal(null)}
        onConfirmEmergencyStop={emergencyStopAll}
        onConfirmSeparateLiquidation={() => emergencyLiquidateAll(true)}
        onConfirmLiveTrading={() => setEnvironmentMode('LIVE', true)}
        onRequestOpenLiquidateModal={() => setSafetyModal('SEPARATE_LIQUIDATE')}
      />

      <InstallAndroidModal
        open={installModalOpen}
        canPromptInstall={canPromptInstall}
        onTriggerInstall={triggerInstall}
        onClose={() => setInstallModalOpen(false)}
      />
    </div>
  );
};

export default App;
