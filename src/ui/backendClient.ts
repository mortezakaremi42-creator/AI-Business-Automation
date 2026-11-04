import type { AppStatusSnapshot } from "../shared/contracts.js";
export interface BackendConfig {
  baseUrl: string;
  token: string;
}
declare global {
  interface Window {
    BIT24_API_BASE?: string;
  }
}
export function normalizeBackendBase(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("آدرس باید فقط http(s)://host:port باشد، بدون مسیر یا رمز.");
  return url.origin;
}
export class BackendError extends Error {
  constructor(
    message: string,
    readonly unknownWrite = false,
    readonly payload?: any,
  ) {
    super(message);
  }
}
export class BackendClient {
  readonly baseUrl: string;
  constructor(
    private readonly config: BackendConfig,
    private readonly fetcher: typeof fetch = (...args) =>
      globalThis.fetch(...args),
  ) {
    this.baseUrl = normalizeBackendBase(config.baseUrl);
  }
  url(path: string) {
    if (!path.startsWith("/api/")) throw Error("INVALID_API_PATH");
    return this.baseUrl + path;
  }
  async request(
    path: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    const write = body !== undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 10_000);
    try {
      const response = await this.fetcher(this.url(path), {
        method: write ? "POST" : "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(write ? { "Content-Type": "application/json" } : {}),
          ...(this.config.token ? { "X-API-Token": this.config.token } : {}),
        },
        body: write ? JSON.stringify(body) : undefined,
      });
      if (
        !(response.headers.get("content-type") || "").includes(
          "application/json",
        )
      )
        throw new BackendError(
          "پاسخ JSON نیست؛ آدرس بک‌اند یا مسیر API نادرست است.",
          write,
        );
      const data = await response.json();
      if (write && response.ok && data?.ok !== true && data?.ok !== false)
        throw new BackendError(
          "تأیید معتبر برای عملیات دریافت نشد؛ نتیجه نامعلوم است.",
          true,
        );
      if (!response.ok || data?.ok === false) {
        const definiteRejection =
          [400, 401, 403, 404, 409, 422].includes(response.status) &&
          data?.ok === false;
        throw new BackendError(
          data?.messageFa ||
            data?.message ||
            data?.error ||
            `HTTP_${response.status}`,
          write && !definiteRejection,
          data,
        );
      }
      return data;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError(
        controller.signal.aborted
          ? "زمان پاسخ سرور تمام شد."
          : "ارتباط با بک‌اند برقرار نشد؛ IP، شبکه، VPN و پورت را بررسی کنید.",
        write,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  async sync(signal?: AbortSignal): Promise<AppStatusSnapshot> {
    const [coins, snapshot] = await Promise.all([
      this.request("/api/coins", undefined, signal),
      this.request("/api/status", undefined, signal),
    ]);
    if (
      !Array.isArray(coins) ||
      snapshot?.appName !== "BIT24 AI TRADER PRO" ||
      !Array.isArray(snapshot.openPositions) ||
      !Array.isArray(snapshot.topOpportunities) ||
      !Number.isFinite(snapshot.serverTimestamp) ||
      !Number.isFinite(snapshot.demoAvailableCashIrt) ||
      !Array.isArray(snapshot.goldReport?.goldOpenPositions)
    )
      throw new BackendError("ساختار پاسخ با پنل Bit24 سازگار نیست.");
    if (snapshot.storage?.healthy === false)
      throw new BackendError(
        "ذخیره‌سازی سرور متوقف است؛ ادامهٔ معامله تا بررسی سرور مسدود است.",
      );
    // The server snapshot owns prices AND balances. Do not merge two financial states from different ticks.
    return snapshot;
  }
}
