import { useCallback, useEffect, useRef, useState } from 'react';
import { Bit24AiTraderOrchestrator } from '../engine/traderOrchestrator.js';
import {
  AppStatusSnapshot,
  CapitalRiskConfig,
  ExitStrategyConfig,
  ProVerificationReport,
} from '../shared/contracts.js';
import {
  clearEncryptedBrowserVault,
  loadEncryptedBrowserVault,
  maskKey,
  saveEncryptedBrowserVault,
} from './browserVault.js';

export function useBit24Controller() {
  const localOrchestratorRef = useRef<Bit24AiTraderOrchestrator | null>(null);
  if (!localOrchestratorRef.current) {
    localOrchestratorRef.current = new Bit24AiTraderOrchestrator();
  }

  const [snapshot, setSnapshot] = useState<AppStatusSnapshot>(() =>
    localOrchestratorRef.current!.getSnapshot()
  );
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4500);
  }, []);

  // Probe relative `/api/status` & attach WebSocket `/ws`; otherwise run standalone PWA loop
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const startStandalonePwaLoop = async () => {
      const stored = await loadEncryptedBrowserVault();
      const orch = localOrchestratorRef.current!;
      if (stored.bit24ApiKey) {
        orch.setBit24Health({
          state: 'OFFLINE_OR_UNREACHABLE',
          hasApiKey: true,
          hasSecretKey: Boolean(stored.bit24SecretKey),
          maskedApiKey: maskKey(stored.bit24ApiKey),
          messageFa:
            'حالت مستقل PWA اندروید فعال است (برای اتصال مستقیم بدون محدودیت CORS مرورگر، سرور پروکسی Bit24 را اجرا نمایید).',
          messageEn:
            'Standalone Android PWA mode active (run the Bit24 proxy server for CORS-free live API calls).',
        });
      }
      orch.setTelegramMeta({
        configured: Boolean(stored.telegramBotToken && stored.telegramChatId),
        enabled: stored.telegramEnabled,
        maskedChatId: maskKey(stored.telegramChatId),
      });
      if (!cancelled) {
        setSnapshot(orch.getSnapshot());
      }
      fallbackTimer = setInterval(async () => {
        if (cancelled) return;
        await orch.stepCycle();
        setSnapshot(orch.getSnapshot());
      }, 3_500);
    };

    const connectServerOrFallback = async () => {
      try {
        const resp = await fetch('./api/status', {
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) throw new Error('NO_API_SERVER');
        const initialSnap = (await resp.json()) as AppStatusSnapshot;
        if (!initialSnap?.appName) throw new Error('INVALID_SNAPSHOT');
        if (cancelled) return;

        setBackendConnected(true);
        setSnapshot(initialSnap);

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${window.location.host}/ws`);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg?.type === 'SNAPSHOT' && msg.data && !cancelled) {
              setSnapshot(msg.data);
            }
          } catch {
            // Ignore malformed frame
          }
        };
        ws.onclose = () => {
          if (!cancelled) {
            // Poll `/api/status` gently if WS closes
            fallbackTimer = setInterval(async () => {
              try {
                const r = await fetch('./api/status');
                if (r.ok && !cancelled) setSnapshot(await r.json());
              } catch {
                // Keep existing state
              }
            }, 4_000);
          }
        };
      } catch {
        setBackendConnected(false);
        await startStandalonePwaLoop();
      }
    };

    connectServerOrFallback();

    return () => {
      cancelled = true;
      if (ws) ws.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, []);

  const callAction = useCallback(
    async (
      actionName: string,
      apiPath: string,
      body: Record<string, unknown> | undefined,
      localFallback: (orch: Bit24AiTraderOrchestrator) => Promise<void> | void
    ) => {
      setBusyAction(actionName);
      try {
        if (backendConnected) {
          const resp = await fetch(apiPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
          });
          const data = await resp.json().catch(() => null);
          if (data?.snapshot) setSnapshot(data.snapshot);
          if (data?.messageFa) showToast(data.messageFa);
          return data;
        } else {
          const orch = localOrchestratorRef.current!;
          await localFallback(orch);
          setSnapshot(orch.getSnapshot());
          return { ok: true };
        }
      } finally {
        setBusyAction(null);
      }
    },
    [backendConnected, showToast]
  );

  return {
    snapshot,
    backendConnected,
    busyAction,
    toastMessage,
    startScanner: () =>
      callAction('startScanner', './api/scanner/start', undefined, (o) => {
        o.startScanner();
        showToast('اسکنر هوشمند بازار Bit24 فعال شد.');
      }),
    stopScanner: () =>
      callAction('stopScanner', './api/scanner/stop', undefined, (o) => {
        o.stopScanner();
        showToast('اسکنر متوقف شد.');
      }),
    startDemoTrading: () =>
      callAction('startDemo', './api/trading/start-demo', undefined, (o) => {
        o.startDemoTrading();
        showToast('معامله خودکار آزمایشی (Demo) با کارمزد واقعی Bit24 فعال شد.');
      }),
    stopTrading: () =>
      callAction('stopTrading', './api/trading/stop', undefined, (o) => {
        o.stopTrading();
        showToast('معاملات خودکار متوقف شد.');
      }),
    emergencyStop: () =>
      callAction(
        'emergencyStop',
        './api/trading/emergency-stop',
        undefined,
        async (o) => {
          await o.triggerEmergencyStop(true);
          showToast('توقف اضطراری (EMERGENCY STOP) اجرا و پوزیشن‌های دمو بسته شدند.');
        }
      ),
    clearEmergencyStop: () =>
      callAction(
        'clearEmergency',
        './api/trading/clear-emergency',
        undefined,
        (o) => {
          o.clearEmergencyStop();
          showToast('قفل توقف اضطراری باز شد.');
        }
      ),
    manualDemoBuy: (symbol: string) =>
      callAction(
        `buy-${symbol}`,
        './api/trading/manual-demo-buy',
        { symbol },
        async (o) => {
          const sig = o
            .getSnapshot()
            .topOpportunities.find((s) => s.symbol === symbol);
          if (sig) {
            const res = await o.tryOpenCryptoPosition(sig);
            showToast(res.messageFa);
          }
        }
      ),
    toggleGoldAutoDemo: (enabled: boolean) =>
      callAction('goldAuto', './api/gold/toggle-auto', { enabled }, (o) => {
        o.setGoldAutoDemo(enabled);
        showToast(
          enabled
            ? 'معامله آزمایشی خودکار طلای دیجیتال (PAXG/XAUT) فعال شد.'
            : 'معامله خودکار طلای دیجیتال متوقف شد.'
        );
      }),
    manualGoldDemoBuy: (symbol: 'PAXG/IRT' | 'XAUT/IRT') =>
      callAction(`goldBuy-${symbol}`, './api/gold/demo-buy', { symbol }, async (o) => {
        const res = await o.tryOpenGoldDemoPosition(symbol);
        showToast(res.messageFa);
      }),
    updateRiskSettings: (params: {
      capital?: Partial<CapitalRiskConfig>;
      exit?: Partial<ExitStrategyConfig>;
    }) =>
      callAction('riskUpdate', './api/risk/update', params, (o) => {
        o.updateRiskAndExitSettings(params);
        showToast('تنظیمات مدیریت سرمایه و حد سود/ضرر ذخیره شد.');
      }),
    saveBit24Credentials: async (apiKey: string, secretKey: string) => {
      if (backendConnected) {
        return callAction(
          'saveBit24',
          './api/settings/bit24',
          { apiKey, secretKey },
          () => {}
        );
      }
      const existing = await loadEncryptedBrowserVault();
      await saveEncryptedBrowserVault({
        ...existing,
        bit24ApiKey: apiKey.trim(),
        bit24SecretKey: secretKey.trim(),
      });
      const orch = localOrchestratorRef.current!;
      orch.setBit24Health({
        state: 'OFFLINE_OR_UNREACHABLE',
        hasApiKey: Boolean(apiKey.trim()),
        hasSecretKey: Boolean(secretKey.trim()),
        maskedApiKey: maskKey(apiKey),
        messageFa:
          'کلیدها با رمزنگاری AES-256-GCM ذخیره شدند (برای اتصال زنده به Bit24، سرور بک‌اند را اجرا کنید).',
        messageEn:
          'Keys encrypted via AES-256-GCM (run backend server for live Bit24 connection).',
      });
      setSnapshot(orch.getSnapshot());
      showToast('کلیدهای Bit24 به صورت رمزنگاری‌شده ذخیره شدند.');
    },
    verifyBit24Connection: () =>
      callAction(
        'verifyBit24',
        './api/settings/bit24/verify',
        undefined,
        () => {
          showToast('در حالت مستقل PWA، فید شبیه‌ساز دمو فعال است.');
        }
      ),
    clearBit24Credentials: async () => {
      if (backendConnected) {
        return callAction(
          'clearBit24',
          './api/settings/bit24/clear',
          undefined,
          () => {}
        );
      }
      clearEncryptedBrowserVault();
      const orch = localOrchestratorRef.current!;
      orch.setBit24Health({
        state: 'NOT_CONFIGURED',
        hasApiKey: false,
        hasSecretKey: false,
        maskedApiKey: '',
      });
      setSnapshot(orch.getSnapshot());
      showToast('کلیدهای ذخیره شده پاک شدند.');
    },
    saveTelegramSettings: async (params: {
      botToken?: string;
      chatId?: string;
      enabled: boolean;
    }) => {
      if (backendConnected) {
        return callAction(
          'saveTelegram',
          './api/settings/telegram',
          params,
          () => {}
        );
      }
      const existing = await loadEncryptedBrowserVault();
      await saveEncryptedBrowserVault({
        ...existing,
        telegramBotToken: params.botToken || existing.telegramBotToken,
        telegramChatId: params.chatId || existing.telegramChatId,
        telegramEnabled: params.enabled,
      });
      const orch = localOrchestratorRef.current!;
      orch.setTelegramMeta({
        configured: Boolean(
          (params.botToken || existing.telegramBotToken) &&
            (params.chatId || existing.telegramChatId)
        ),
        enabled: params.enabled,
        maskedChatId: maskKey(params.chatId || existing.telegramChatId),
      });
      setSnapshot(orch.getSnapshot());
      showToast('تنظیمات اعلان امن تلگرام ذخیره شد.');
    },
    sendDailyTelegramReport: () =>
      callAction(
        'tgDaily',
        './api/settings/telegram/daily-report',
        undefined,
        (o) => {
          const d = o.getSnapshot().periodReports.daily;
          o.pushTelegramLog({
            id: `tg-${Date.now()}`,
            timestamp: Date.now(),
            eventType: 'DAILY_PNL_REPORT',
            deliveredToTelegram: false,
            title: 'گزارش روزانه سود و زیان',
            safeMessagePreview: `معاملات: ${d.tradesCount} | سود خالص: ${d.netPnlIrt.toLocaleString()} تومان`,
          });
          showToast('پیش‌نمایش امن گزارش روزانه تلگرام ثبت شد.');
        }
      ),
    runPro100Test: async (): Promise<ProVerificationReport | undefined> => {
      setBusyAction('pro100');
      try {
        if (backendConnected) {
          const resp = await fetch('./api/verification/run-100', {
            method: 'POST',
          });
          const data = await resp.json();
          if (data?.snapshot) setSnapshot(data.snapshot);
          showToast(
            `تست حرفه‌ای تکمیل شد: ${data?.report?.simulatedTradesExecuted || 0} معامله شبیه‌سازی‌شده با کارمزد واقعی.`
          );
          return data?.report;
        } else {
          const orch = localOrchestratorRef.current!;
          const report = orch.runPro100Verification();
          setSnapshot(orch.getSnapshot());
          showToast(
            `تست حرفه‌ای تکمیل شد: ${report.simulatedTradesExecuted} معامله شبیه‌سازی‌شده.`
          );
          return report;
        }
      } finally {
        setBusyAction(null);
      }
    },
    downloadTradesCsv: () => {
      if (backendConnected) {
        window.open('./api/reports/trades.csv', '_blank');
        return;
      }
      const csv = '\uFEFF' + localOrchestratorRef.current!.exportTradeHistoryCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bit24-ai-trader-pro-history.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}
