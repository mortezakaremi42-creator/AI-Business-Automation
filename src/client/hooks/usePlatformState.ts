import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BacktestSummary,
  CapitalShieldSettings,
  ModuleId,
  PlatformSettings,
  PlatformSnapshot,
  TokenSecurityReport,
  TradingEnvironmentMode,
} from '../../shared/types';
import {
  evaluateTokenSecurity,
  looksLikePrivateKeyOrSeedPhrase,
} from '../../core/antiRugEngine';
import { StandaloneAndroidRuntime } from '../engine/standalonePlatform';

export function usePlatformState() {
  const standaloneRef = useRef<StandaloneAndroidRuntime | null>(null);
  const adminTokenRef = useRef<string>('');
  const getStandalone = () => {
    if (!standaloneRef.current) {
      standaloneRef.current = new StandaloneAndroidRuntime();
    }
    return standaloneRef.current;
  };

  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<PlatformSnapshot>(() =>
    getStandalone().orchestrator.getSnapshot(
      typeof navigator !== 'undefined' ? navigator.onLine : true
    )
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4800);
  }, []);

  const buildHeaders = (jsonBody = true): Record<string, string> => {
    const h: Record<string, string> = {};
    if (jsonBody) h['Content-Type'] = 'application/json';
    if (adminTokenRef.current) {
      h['X-Admin-Token'] = adminTokenRef.current;
    }
    return h;
  };

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    async function init() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2200);
        const res = await fetch('./api/snapshot', { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await res.json();
            if (!cancelled && data?.ok && data?.snapshot) {
              setBackendAvailable(true);
              setSnapshot(data.snapshot);

              const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
              ws = new WebSocket(`${proto}//${window.location.host}/ws`);
              ws.onmessage = (ev) => {
                try {
                  const msg = JSON.parse(ev.data);
                  if (msg?.type === 'SNAPSHOT' && msg.snapshot) {
                    setSnapshot(msg.snapshot);
                  }
                } catch {
                  // ignore
                }
              };
              return;
            }
          }
        }
      } catch {
        // Standalone static PWA mode without server backend
      }

      if (!cancelled) {
        setBackendAvailable(false);
        const rt = getStandalone();
        await rt.refreshPublicReferenceFeeds();
        const next = await rt.orchestrator.tickCycle();
        setSnapshot({
          ...next,
          health: {
            ...next.health,
            internetOnline: navigator.onLine,
            serverBackendConnected: false,
          },
        });
      }
    }

    init();

    return () => {
      cancelled = true;
      if (ws) ws.close();
    };
  }, []);

  useEffect(() => {
    if (backendAvailable !== false) return;

    const rt = getStandalone();
    const tickInterval = setInterval(async () => {
      await rt.refreshPublicReferenceFeeds();
      const next = await rt.orchestrator.tickCycle();
      setSnapshot({
        ...next,
        health: {
          ...next.health,
          internetOnline: navigator.onLine,
          serverBackendConnected: false,
        },
      });
    }, 6500);

    const onNetChange = () => {
      const cur = rt.orchestrator.getSnapshot(navigator.onLine);
      setSnapshot({
        ...cur,
        health: { ...cur.health, internetOnline: navigator.onLine, serverBackendConnected: false },
      });
    };
    window.addEventListener('online', onNetChange);
    window.addEventListener('offline', onNetChange);

    return () => {
      clearInterval(tickInterval);
      window.removeEventListener('online', onNetChange);
      window.removeEventListener('offline', onNetChange);
    };
  }, [backendAvailable]);

  // ==================== Unified Actions ====================

  const connectBit24Api = useCallback(
    async (apiKey: string, secretKey: string, passphrase?: string, adminToken?: string) => {
      setBusyAction('connect');
      try {
        if (adminToken !== undefined) {
          adminTokenRef.current = adminToken.trim();
        }
        if (!backendAvailable) {
          throw new Error(
            'طبق سیاست امنیتی مرحله هشتم، کلیدهای واقعی API هرگز در مرورگر ذخیره نمی‌شوند و فقط در بک‌اند امن سمت سرور (گاوصندوق AES-256-GCM یا .env سرور) نگهداری می‌شوند. در نسخه استاتیک فعلی، حالت آزمایشی (Paper Trading) فعال است.'
          );
        }

        const res = await fetch('./api/bit24/connect', {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify({ apiKey, secretKey, passphrase }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        setSnapshot(json.snapshot);
        showToast('ok', 'کلید API بیت‌۲۴ در گاوصندوق امن سمت سرور ذخیره و بررسی شد.');
      } catch (err: any) {
        showToast('err', err?.message || 'خطا در اتصال کلید API');
        throw err;
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const disconnectBit24Api = useCallback(async () => {
    setBusyAction('disconnect');
    try {
      if (backendAvailable) {
        const res = await fetch('./api/bit24/disconnect', {
          method: 'POST',
          headers: buildHeaders(false),
        });
        const json = await res.json();
        if (json.snapshot) setSnapshot(json.snapshot);
      } else {
        const rt = getStandalone();
        rt.orchestrator.setEnvironmentMode('PAPER');
        setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
      }
      showToast('ok', 'کلید API بیت‌۲۴ از حافظه امن سرور حذف شد.');
    } finally {
      setBusyAction(null);
    }
  }, [backendAvailable, showToast]);

  const toggleModule = useCallback(
    async (module: ModuleId, enabled: boolean, acknowledgeLeverageRisk = false) => {
      setBusyAction(`mod-${module}`);
      try {
        if (backendAvailable) {
          const res = await fetch('./api/module/toggle', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ module, enabled, acknowledgeLeverageRisk }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          setSnapshot(json.snapshot);
        } else {
          const rt = getStandalone();
          rt.orchestrator.setModuleEnabled(module, enabled, acknowledgeLeverageRisk);
          rt.persistSettings();
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
        }
        showToast('ok', enabled ? 'ماژول با موفقیت فعال شد.' : 'ماژول متوقف شد.');
      } catch (err: any) {
        showToast('err', err?.message || 'خطا در تغییر وضعیت ربات');
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const togglePauseNewTrades = useCallback(
    async (paused: boolean) => {
      setBusyAction('pause-new');
      try {
        if (backendAvailable) {
          const res = await fetch('./api/pause-new-trades', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ paused }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          setSnapshot(json.snapshot);
        } else {
          const rt = getStandalone();
          rt.orchestrator.setPauseNewTrades(paused);
          rt.persistSettings();
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
        }
        showToast(
          'ok',
          paused
            ? 'ثبت معاملات جدید متوقف شد (مدیریت موقعیت‌های باز ادامه دارد).'
            : 'ثبت خودکار معاملات جدید از سر گرفته شد.'
        );
      } catch (err: any) {
        showToast('err', err?.message || 'خطا در تغییر وضعیت توقف معاملات جدید');
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const resetCircuitBreaker = useCallback(async () => {
    setBusyAction('cb-reset');
    try {
      if (backendAvailable) {
        const res = await fetch('./api/circuit-breaker/reset', {
          method: 'POST',
          headers: buildHeaders(false),
        });
        const json = await res.json();
        if (json.snapshot) setSnapshot(json.snapshot);
      } else {
        const rt = getStandalone();
        rt.orchestrator.resetCircuitBreaker();
        setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
      }
      showToast('ok', 'قفل محافظتی خودکار بازنشانی شد.');
    } finally {
      setBusyAction(null);
    }
  }, [backendAvailable, showToast]);

  const setEnvironmentMode = useCallback(
    async (mode: TradingEnvironmentMode, explicitLiveConfirmation = false) => {
      setBusyAction(`mode-${mode}`);
      try {
        if (backendAvailable) {
          const res = await fetch('./api/mode', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ mode, explicitLiveConfirmation }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          setSnapshot(json.snapshot);
        } else {
          const rt = getStandalone();
          rt.orchestrator.setEnvironmentMode(mode, explicitLiveConfirmation);
          rt.persistSettings();
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
        }
        showToast(
          'ok',
          mode === 'LIVE'
            ? 'حالت معاملات واقعی با تایید صریح شما فعال شد.'
            : mode === 'PAPER'
              ? 'حالت معاملات آزمایشی (Paper Trading) فعال شد.'
              : 'حالت تحلیل و سیگنال‌دهی فعال شد.'
        );
      } catch (err: any) {
        showToast('err', err?.message || 'امکان تغییر حالت وجود ندارد');
        throw err;
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const saveSettings = useCallback(
    async (patch: Partial<PlatformSettings>) => {
      setBusyAction('settings');
      try {
        if (backendAvailable) {
          const res = await fetch('./api/settings', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify(patch),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          setSnapshot(json.snapshot);
        } else {
          const rt = getStandalone();
          rt.orchestrator.updateSettings(patch);
          rt.persistSettings();
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
        }
        showToast('ok', 'تنظیمات مدیریت ریسک، حد سود و حد ضرر ذخیره شد.');
      } catch (err: any) {
        showToast('err', err?.message || 'خطا در ذخیره تنظیمات');
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const triggerScanNow = useCallback(
    async (focusMessageFa?: string) => {
      setBusyAction('scan');
      try {
        if (backendAvailable) {
          const res = await fetch('./api/scan-now', { method: 'POST' });
          const json = await res.json();
          if (json.snapshot) setSnapshot(json.snapshot);
        } else {
          const rt = getStandalone();
          await rt.refreshPublicReferenceFeeds();
          const next = await rt.orchestrator.tickCycle();
          setSnapshot(next);
        }
        showToast('ok', focusMessageFa || 'اسکن جامع بازارهای طلا و رمزارز انجام شد.');
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const emergencyStopAll = useCallback(
    async (cancelBit24OpenOrders = true) => {
      setBusyAction('emergency-stop');
      try {
        if (backendAvailable) {
          const res = await fetch('./api/emergency/stop', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ cancelBit24OpenOrders }),
          });
          const json = await res.json();
          if (json.snapshot) setSnapshot(json.snapshot);
          showToast('ok', json.result?.messageFa || 'توقف اضطراری انجام شد.');
        } else {
          const rt = getStandalone();
          const result = await rt.orchestrator.emergencyStopAll(cancelBit24OpenOrders);
          rt.persistSettings();
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
          showToast('ok', result.messageFa);
        }
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const emergencyLiquidateAll = useCallback(
    async (explicitSeparateConfirmation: boolean) => {
      setBusyAction('liquidate');
      try {
        if (backendAvailable) {
          const res = await fetch('./api/emergency/liquidate', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ explicitSeparateConfirmation }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          setSnapshot(json.snapshot);
          showToast('ok', `بستن ${json.result?.closedCount || 0} موقعیت باز با تایید جداگانه انجام شد.`);
        } else {
          const rt = getStandalone();
          const result = await rt.orchestrator.emergencyLiquidateAllPositions(
            explicitSeparateConfirmation
          );
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
          showToast('ok', `بستن ${result.closedCount} موقعیت باز با تایید جداگانه انجام شد.`);
        }
      } catch (err: any) {
        showToast('err', err?.message || 'خطا در بستن موقعیت‌ها');
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const closeSinglePosition = useCallback(
    async (positionId: string) => {
      if (backendAvailable) {
        const res = await fetch('./api/positions/close', {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify({ positionId }),
        });
        const json = await res.json();
        if (json.snapshot) setSnapshot(json.snapshot);
      } else {
        const rt = getStandalone();
        rt.orchestrator.closeSinglePositionManually(positionId);
        setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
      }
      showToast('ok', 'موقعیت باز پس از بررسی بسته شد.');
    },
    [backendAvailable, showToast]
  );

  const executePaperSignal = useCallback(
    async (signalId: string) => {
      try {
        if (backendAvailable) {
          const res = await fetch('./api/signals/paper-execute', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ signalId }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          setSnapshot(json.snapshot);
        } else {
          const rt = getStandalone();
          rt.orchestrator.executeSignalNowInPaper(signalId);
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
        }
        showToast('ok', 'معامله آزمایشی (Paper) با رعایت قوانین ریسک ثبت شد.');
      } catch (err: any) {
        showToast('err', err?.message || 'شرایط ریسک اجازه ثبت معامله را نداد');
      }
    },
    [backendAvailable, showToast]
  );

  const runBacktest = useCallback(
    async (
      module: 'DIGITAL_GOLD' | 'SPOT_CRYPTO' | 'MEME_HUNTER',
      marketName?: string
    ): Promise<BacktestSummary> => {
      if (backendAvailable) {
        const res = await fetch('./api/backtest', {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify({ module, marketName }),
        });
        const json = await res.json();
        return json.summary as BacktestSummary;
      }
      return getStandalone().orchestrator.runBacktest(module, marketName);
    },
    [backendAvailable]
  );

  const downloadHistoryCsv = useCallback(async () => {
    try {
      let csvText = '';
      if (backendAvailable) {
        const res = await fetch('./api/export/history.csv');
        csvText = await res.text();
      } else {
        csvText = getStandalone().orchestrator.exportHistoryCsv();
      }
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bit24-smart-trader-history-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('ok', 'فایل CSV تاریخچه معاملات و سیگنال‌ها دانلود شد.');
    } catch {
      showToast('err', 'خطا در تولید خروجی CSV تاریخچه');
    }
  }, [backendAvailable, showToast]);

  const inspectContractAddress = useCallback(
    async (
      contractAddress: string,
      network: 'SOLANA_SPL' | 'ETHEREUM_EVM' | 'BSC_EVM'
    ): Promise<TokenSecurityReport | null> => {
      const addr = contractAddress.trim();
      if (looksLikePrivateKeyOrSeedPhrase(addr)) {
        showToast(
          'err',
          'مسدودسازی امنیتی: هرگز کلید خصوصی یا عبارت بازیابی کیف‌پول وارد نکنید! فقط آدرس عمومی قرارداد مجاز است.'
        );
        return null;
      }
      setBusyAction('inspect-contract');
      try {
        if (backendAvailable) {
          const res = await fetch('./api/security/inspect-token', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ contractAddress: addr, network }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error);
          if (json.snapshot) setSnapshot(json.snapshot);
          showToast(
            json.report.buyAllowedInDemo ? 'ok' : 'err',
            `امتیاز امنیت ${json.report.symbol}: ${json.report.securityScore}/100 (${json.report.verdictLabelFa})`
          );
          return json.report as TokenSecurityReport;
        }

        // Standalone browser mode: query CORS-enabled DexScreener + GoPlus read-only APIs with Fail-Closed fallback
        const rt = getStandalone();
        const cfg = rt.orchestrator.getSnapshot(navigator.onLine).antiRug.config;
        let dexJson: any = null;
        let gpJson: any = null;
        const apisConsulted: string[] = [];
        try {
          const dexRes = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(addr)}`
          );
          if (dexRes.ok) {
            dexJson = await dexRes.json();
            apisConsulted.push('DexScreener API v1');
          }
        } catch {
          // handled fail-closed below
        }
        try {
          const isEvm = network === 'ETHEREUM_EVM' || network === 'BSC_EVM';
          const gpUrl = isEvm
            ? `https://api.gopluslabs.io/api/v1/token_security/${network === 'BSC_EVM' ? '56' : '1'}?contract_addresses=${encodeURIComponent(addr.toLowerCase())}`
            : `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(addr)}`;
          const gpRes = await fetch(gpUrl);
          if (gpRes.ok) {
            gpJson = await gpRes.json();
            apisConsulted.push('GoPlus Security API v1');
          }
        } catch {
          // handled fail-closed below
        }

        const pairs: any[] = Array.isArray(dexJson?.pairs) ? dexJson.pairs : [];
        pairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
        const bestPair = pairs[0] || null;
        const liqUsd =
          bestPair?.liquidity?.usd !== undefined ? Number(bestPair.liquidity.usd) : null;
        const ageHours =
          bestPair?.pairCreatedAt && Number(bestPair.pairCreatedAt) > 0
            ? Number(((Date.now() - Number(bestPair.pairCreatedAt)) / 3_600_000).toFixed(1))
            : null;
        const sym = String(bestPair?.baseToken?.symbol || addr.slice(0, 6)).toUpperCase();

        const isEvm = network === 'ETHEREUM_EVM' || network === 'BSC_EVM';
        const gpEntry = gpJson?.result?.[isEvm ? addr.toLowerCase() : addr] || null;
        const canSell = gpEntry
          ? isEvm
            ? gpEntry.is_honeypot !== '1' && gpEntry.cannot_sell_all !== '1'
            : gpEntry.non_transferable !== '1'
          : null;
        const buyTaxPct = gpEntry
          ? isEvm && gpEntry.buy_tax !== undefined
            ? Number(gpEntry.buy_tax) * 100
            : 0
          : null;
        const sellTaxPct = gpEntry
          ? isEvm && gpEntry.sell_tax !== undefined
            ? Number(gpEntry.sell_tax) * 100
            : 0
          : null;

        const rep = evaluateTokenSecurity(
          {
            symbol: sym,
            marketName: `${sym}/${isEvm ? 'USDT' : 'SOL'}`,
            displayNameFa: `${bestPair?.baseToken?.name || sym}`,
            network,
            contractAddress: addr,
            dataOrigin:
              apisConsulted.length > 0 ? 'LIVE_PUBLIC_SECURITY_APIS' : 'FAIL_CLOSED_OFFLINE',
            apisConsulted,
            securityApiAvailable: apisConsulted.length > 0,
            dataComplete:
              liqUsd !== null && canSell !== null && buyTaxPct !== null && ageHours !== null,
            dataTimestampMs: Date.now(),
            poolLiquidityUsd: liqUsd,
            orderBookDepthIrt: null,
            liquidityChange1hPct: bestPair ? Number(bestPair?.priceChange?.h1 || 0) < -25 ? -30 : 0 : null,
            canSell,
            isHoneypot: gpEntry ? gpEntry.is_honeypot === '1' : false,
            buyTaxPct,
            sellTaxPct,
            hasSuspiciousSellRestriction: Boolean(
              gpEntry && (gpEntry.cannot_sell_all === '1' || gpEntry.transfer_pausable === '1')
            ),
            mintAuthorityActive: Boolean(
              gpEntry && (gpEntry.is_mintable === '1' || gpEntry.mintable?.status === '1')
            ),
            freezeAuthorityActive: Boolean(
              gpEntry && (gpEntry.is_blacklisted === '1' || gpEntry.closable?.status === '1')
            ),
            ownerDangerousPrivileges: Boolean(gpEntry && gpEntry.owner_change_balance === '1'),
            isUnverifiedOrSuspiciousContract: Boolean(gpEntry && gpEntry.is_open_source === '0'),
            tokenAgeHours: ageHours,
            topHoldersConcentrationPct: null,
            priceChange1hPct: Number(bestPair?.priceChange?.h1 || 0),
            priceChange24hPct: Number(bestPair?.priceChange?.h24 || 0),
            volumeRatio: 1.0,
            buyToSellRatio: null,
            washTradingSuspected: false,
            priceManipulationRisk: false,
          },
          cfg
        );
        rt.orchestrator.recordCustomInspectedToken(rep);
        setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
        showToast(
          rep.buyAllowedInDemo ? 'ok' : 'err',
          `امتیاز امنیت ${rep.symbol}: ${rep.securityScore}/100 (${rep.verdictLabelFa})`
        );
        return rep;
      } catch (err: any) {
        showToast('err', err?.message || 'خطا در بررسی قرارداد توکن');
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const testAntiRugDemoBuy = useCallback(
    async (symbol: string) => {
      setBusyAction(`test-buy-${symbol}`);
      try {
        if (backendAvailable) {
          const res = await fetch('./api/security/test-buy', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ symbol }),
          });
          const json = await res.json();
          if (json.snapshot) setSnapshot(json.snapshot);
          showToast(
            json.result?.allowed ? 'ok' : 'err',
            json.result?.allowed
              ? `مجاز برای دمو (${symbol}): ${json.result.reasonFa}`
              : `مسدود توسط محافظ سرمایه (${symbol}): ${json.result?.reasonFa}`
          );
        } else {
          const rt = getStandalone();
          const res = rt.orchestrator.testDemoBuyThroughAntiRug(symbol);
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
          showToast(
            res.allowed ? 'ok' : 'err',
            res.allowed
              ? `مجاز برای دمو (${symbol}): ${res.reasonFa}`
              : `مسدود توسط محافظ سرمایه (${symbol}): ${res.reasonFa}`
          );
        }
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const simulateAntiRugState = useCallback(
    async (patch: {
      securityServiceOnline?: boolean;
      simulatedFeedStale?: boolean;
      triggerSystemFault?: boolean;
    }) => {
      setBusyAction('sim-antirug');
      try {
        if (backendAvailable) {
          const res = await fetch('./api/security/simulate-state', {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify(patch),
          });
          const json = await res.json();
          if (json.snapshot) setSnapshot(json.snapshot);
        } else {
          const rt = getStandalone();
          if (typeof patch.securityServiceOnline === 'boolean') {
            rt.orchestrator.setSecurityServiceOnline(patch.securityServiceOnline);
          }
          if (typeof patch.simulatedFeedStale === 'boolean') {
            rt.orchestrator.setSimulatedFeedStale(patch.simulatedFeedStale);
          }
          if (patch.triggerSystemFault) {
            await rt.orchestrator.triggerSystemFaultEmergencyTest();
          }
          setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
        }
        showToast('ok', 'وضعیت تست آزمایشی محافظ سرمایه بروزرسانی شد.');
      } finally {
        setBusyAction(null);
      }
    },
    [backendAvailable, showToast]
  );

  const updateAntiRugSettings = useCallback(
    async (patch: Partial<CapitalShieldSettings>) => {
      if (backendAvailable) {
        const res = await fetch('./api/security/config', {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify(patch),
        });
        const json = await res.json();
        if (json.snapshot) setSnapshot(json.snapshot);
      } else {
        const rt = getStandalone();
        rt.orchestrator.updateAntiRugConfig(patch);
        setSnapshot(rt.orchestrator.getSnapshot(navigator.onLine));
      }
      showToast('ok', 'تنظیمات ANTI-RUG & SMART SECURITY ذخیره شد.');
    },
    [backendAvailable, showToast]
  );

  return {
    snapshot,
    backendAvailable,
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
  };
}
