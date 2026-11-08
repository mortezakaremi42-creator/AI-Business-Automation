import { assertNoWithdrawalEndpoint } from "../bit24OfficialClient.js";
import { RateLimited } from "./safeSpotExecution.js";
export interface Bit24Credentials {
  API_KEY: string;
  SECRET_KEY: string;
}
interface ReviewedHttpContract {
  origin: string;
  /** Exact method/path pairs from reviewed official docs. No wildcard, transfer or withdrawal paths. */
  allowlist: readonly string[];
  /** Provider-specific canonical authentication, only after reviewing real official documentation. */
  authenticate: (
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: string | undefined,
    credentials: Bit24Credentials,
  ) => Record<string, string>;
}
/** Secure primitives, not a guessed Bit24 endpoint/signing implementation. No logs or write retry. */
export class ReviewedHttpTransport {
  constructor(
    private contract: ReviewedHttpContract,
    private credentials: () => Bit24Credentials,
    private fetcher: typeof fetch = fetch,
  ) {
    const origin = new URL(contract.origin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== contract.origin ||
      origin.username ||
      origin.password
    )
      throw Error("HTTPS_ORIGIN_REQUIRED");
    if (
      !contract.allowlist.length ||
      contract.allowlist.some((p) => /[?%*]/.test(p))
    )
      throw Error("EXACT_ENDPOINT_ALLOWLIST_REQUIRED");
    for (const entry of contract.allowlist) assertNoWithdrawalEndpoint(entry);
  }
  async request(
    method: "GET" | "POST" | "DELETE",
    pathname: string,
    body: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    assertNoWithdrawalEndpoint(pathname);
    if (
      !pathname.startsWith("/") ||
      pathname.includes("//") ||
      /[?%#]/.test(pathname) ||
      !this.contract.allowlist.includes(method + " " + pathname)
    )
      throw Error("ENDPOINT_NOT_ALLOWLISTED");
    const keys = this.credentials();
    if (!keys.API_KEY || !keys.SECRET_KEY) throw Error("CREDENTIALS_REQUIRED");
    let headers: Record<string, string>;
    try {
      headers = this.contract.authenticate(method, pathname, body, keys);
    } catch {
      throw Error("AUTH_SIGNING_FAILED");
    }
    try {
      const response = await this.fetcher(this.contract.origin + pathname, {
        method,
        headers: { Accept: "application/json", ...headers },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        redirect: "error",
      });
      if (response.status === 429) {
        const value = response.headers.get("retry-after");
        const seconds = value && /^\d+$/.test(value) ? Number(value) : NaN;
        const date = value ? Date.parse(value) : NaN;
        const ms = Number.isFinite(seconds)
          ? seconds * 1000
          : Number.isFinite(date)
            ? Math.max(0, date - Date.now())
            : 60000;
        throw new RateLimited(Math.min(60000, ms));
      }
      if (!response.ok) throw Error("EXCHANGE_HTTP_" + response.status);
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw Error("EXCHANGE_NON_JSON");
      return await response.json();
    } catch (error) {
      if (error instanceof RateLimited) throw error;
      throw Error("EXCHANGE_REQUEST_FAILED");
    }
  }
}
