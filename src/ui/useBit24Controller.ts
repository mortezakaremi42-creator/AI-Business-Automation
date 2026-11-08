import { newRequestId } from "../shared/identifiers.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppStatusSnapshot,
  CapitalRiskConfig,
  ExitStrategyConfig,
  ProVerificationReport,
} from "../shared/contracts.js";
import {
  BackendClient,
  BackendError,
  normalizeBackendBase,
} from "./backendClient.js";
function savedBase() {
  try {
    return normalizeBackendBase(
      localStorage.getItem("bit24.backend") ?? window.BIT24_API_BASE ?? "",
    );
  } catch {
    return "";
  }
}
function savedToken() {
  try {
    return sessionStorage.getItem("bit24.dashboardToken") ?? "";
  } catch {
    return "";
  }
}
interface Pending {
  requestId: string;
  action: string;
  at: number;
}
function readPending(key: string): Pending | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function useBit24Controller() {
  const [config, setConfig] = useState(() => ({
    baseUrl: savedBase(),
    token: savedToken(),
  }));
  const client = useMemo(() => new BackendClient(config), [config]);
  const key = "bit24.demo.pending.v2." + client.baseUrl;
  const [snapshot, setSnapshot] = useState<AppStatusSnapshot | null>(null);
  const [backendConnected, setConnected] = useState(false),
    [connectionError, setConnectionError] = useState(
      "در حال اتصال به سرور آزمایشی…",
    );
  const [busyAction, setBusy] = useState<string | null>(null),
    [toastMessage, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(() =>
    readPending(key),
  );
  const busy = useRef(false),
    generation = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 8000);
  }, []);
  const accept = useCallback(
    (data: AppStatusSnapshot) =>
      setSnapshot((prev) =>
        !prev || data.serverTimestamp >= prev.serverTimestamp ? data : prev,
      ),
    [],
  );
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  useEffect(() => {
    let cancelled = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    generation.current++;
    setSnapshot(null);
    setConnected(false);
    setPending(readPending(key));
    async function poll() {
      try {
        const data = await client.sync(abort.signal);
        if (cancelled) return;
        accept(data);
        setConnected(true);
        setConnectionError("");
        failures = 0;
      } catch (error) {
        if (cancelled) return;
        setConnected(false);
        setConnectionError(
          error instanceof Error ? error.message : "خطای اتصال",
        );
        failures++;
      }
      if (!cancelled)
        timer = setTimeout(
          poll,
          failures
            ? Math.min(30_000, 2000 * 2 ** Math.min(failures - 1, 4))
            : 2000,
        );
    }
    void poll();
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, key, accept]);
  const saveBackendConnection = (baseUrl: string, token: string) => {
    if (busy.current) {
      showToast("تا پایان درخواست، آدرس را تغییر ندهید.");
      return;
    }
    try {
      const base = normalizeBackendBase(baseUrl);
      localStorage.setItem("bit24.backend", base);
      sessionStorage.setItem("bit24.dashboardToken", token.trim());
      setConfig({ baseUrl: base, token: token.trim() });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "خطای تنظیم اتصال");
    }
  };
  const call = useCallback(
    async (
      action: string,
      path: string,
      body: Record<string, unknown> = {},
      financial = false,
    ): Promise<any> => {
      if (busy.current) return { ok: false };
      if (!backendConnected) {
        showToast("سرور در دسترس نیست؛ معاملهٔ محلی جایگزین نمی‌شود.");
        return { ok: false };
      }
      if (financial && (pending || readPending(key))) {
        showToast("ابتدا نتیجهٔ درخواست قبلی را با رسید سرور بررسی کنید.");
        return { ok: false };
      }
      if (
        financial &&
        !window.confirm(
          "هشدار معاملهٔ آزمایشی — اطلاعات فرضی\n" +
            action +
            "\nکارمزد هر طرف ۰٫۲٪ و لغزش فرضی اعمال می‌شود. سقف ریسک و ظرفیت دوباره روی سرور بررسی می‌شوند. حد ضرر/حد سود این پوزیشن ممکن است بدون تأیید مجدد فروش حفاظتی انجام دهند. هیچ پول واقعی جابه‌جا نمی‌شود. ادامه؟",
        )
      )
        return { ok: false };
      busy.current = true;
      setBusy(action);
      const version = generation.current;
      const requestId = financial ? newRequestId() : undefined;
      if (financial) {
        const value = { requestId: requestId!, action, at: Date.now() };
        try {
          localStorage.setItem(key, JSON.stringify(value));
          setPending(value);
        } catch {
          busy.current = false;
          setBusy(null);
          showToast(
            "ذخیرهٔ شناسه درخواست روی دستگاه ممکن نشد؛ معامله ارسال نشد.",
          );
          return { ok: false };
        }
      }
      try {
        const data = await client.request(path, {
          ...body,
          ...(requestId ? { requestId } : {}),
        });
        if (version !== generation.current) return data;
        if (financial) {
          localStorage.removeItem(key);
          setPending(null);
        }
        if (data?.snapshot) accept(data.snapshot);
        if (data?.messageFa) showToast(data.messageFa);
        try {
          accept(await client.sync());
        } catch {
          setConnected(false);
          setConnectionError(
            "نتیجهٔ عملیات دریافت شد، اما همگام‌سازی تازه ناموفق بود.",
          );
        }
        return data;
      } catch (error) {
        if (version !== generation.current) return { ok: false };
        if (financial && error instanceof BackendError && !error.unknownWrite) {
          localStorage.removeItem(key);
          setPending(null);
        }
        showToast(
          (error instanceof Error ? error.message : "خطای درخواست") +
            (financial &&
            (!(error instanceof BackendError) || error.unknownWrite)
              ? " نتیجه نامعلوم است؛ درخواست تکرار نشد."
              : ""),
        );
        return { ok: false };
      } finally {
        busy.current = false;
        setBusy(null);
      }
    },
    [client, key, pending, backendConnected, accept, showToast],
  );
  const reconcilePending = async () => {
    if (!pending || busy.current) return;
    busy.current = true;
    setBusy("reconcile");
    try {
      const r = await client.request(
        "/api/demo/receipts/" + encodeURIComponent(pending.requestId),
      );
      if (r.found) {
        localStorage.removeItem(key);
        setPending(null);
        showToast(
          r.result?.ok
            ? "رسید ذخیره‌شده تأیید شد؛ عملیات قبلاً انجام شده است."
            : "رسید سرور نشان می‌دهد عملیات رد شده بود.",
        );
        accept(await client.sync());
      } else
        showToast(
          "رسید قطعی روی سرور پیدا نشد؛ قفل باقی ماند. هیچ درخواست خرید یا فروش دوباره ارسال نشد.",
        );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "خطای بررسی رسید");
    } finally {
      busy.current = false;
      setBusy(null);
    }
  };
  const disabled = () => {
    showToast("کلید صرافی، اتصال زنده و تلگرام در این نسخه غیرفعال‌اند.");
    return Promise.resolve({ ok: false });
  };
  return {
    snapshot,
    backendConnected,
    busyAction,
    toastMessage,
    connectionError,
    backendBase: config.baseUrl,
    saveBackendConnection,
    uncertainWrite: pending?.action ?? null,
    reconcilePending,
    startScanner: () => call("startScanner", "/api/scanner/start"),
    stopScanner: () => call("stopScanner", "/api/scanner/stop"),
    startDemoTrading: () => call("startDemo", "/api/trading/start-demo"),
    stopTrading: () => call("stopTrading", "/api/trading/stop"),
    // Panic is allowed even while a previous financial response is uncertain. It only reduces exposure.
    emergencyStop: async () => {
      try {
        const result = await client.request("/api/trading/emergency-stop", {});
        if (result?.snapshot) accept(result.snapshot);
        showToast("توقف اضطراری تأیید شد؛ حساب دمو تسویه شد.");
        return result;
      } catch {
        showToast(
          "نتیجهٔ توقف اضطراری تأیید نشد؛ وضعیت سرور را بررسی کنید. نقدشدن را فرض نکنید.",
        );
        return { ok: false };
      }
    },
    clearEmergencyStop: () =>
      call("clearEmergency", "/api/trading/clear-emergency"),
    manualDemoBuy: (symbol: string) =>
      call(
        "خرید کاغذی " + symbol,
        "/api/buy",
        {
          symbol,
          referencePriceIrt: snapshot?.topOpportunities.find(
            (s) => s.symbol === symbol,
          )?.priceIrt,
        },
        true,
      ),
    manualDemoSell: (symbol: string) =>
      call("فروش کاغذی " + symbol, "/api/sell", { symbol }, true),
    adjustDemoCash: (amountIrt: number) =>
      call("اصلاح موجودی کاغذی", "/api/demo/balance", { amountIrt }, true),
    toggleGoldAutoDemo: (enabled: boolean) =>
      call("goldAuto", "/api/gold/toggle-auto", { enabled }),
    manualGoldDemoBuy: (symbol: "PAXG/IRT" | "XAUT/IRT") =>
      call(
        "خرید کاغذی طلا " + symbol,
        "/api/gold/demo-buy",
        {
          symbol,
          referencePriceIrt: snapshot?.goldReport.goldSignals.find(
            (s) => s.symbol === symbol,
          )?.priceIrt,
        },
        true,
      ),
    updateRiskSettings: (params: {
      capital?: Partial<CapitalRiskConfig>;
      exit?: Partial<ExitStrategyConfig>;
    }) => call("riskUpdate", "/api/risk/update", params),
    requestTradingMode: (mode: "DEMO" | "LIVE") =>
      call("executionMode", "/api/execution/mode", { mode }),
    saveBit24Credentials: (_apiKey: string, _secretKey: string) => disabled(),
    verifyBit24Connection: disabled,
    clearBit24Credentials: disabled,
    saveTelegramSettings: (_params: {
      botToken?: string;
      chatId?: string;
      enabled: boolean;
    }) => disabled(),
    sendDailyTelegramReport: disabled,
    runPro100Test: async (): Promise<ProVerificationReport | undefined> => {
      const data = await call("pro100", "/api/verification/run-100");
      return data?.report;
    },
    downloadTradesCsv: async () => {
      try {
        const response = await fetch(client.url("/api/reports/trades.csv"), {
          headers: config.token ? { "X-API-Token": config.token } : {},
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        if (!response.ok) throw Error();
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = "demo-trades.csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        showToast("گزارش دریافت نشد.");
      }
    },
  };
}
