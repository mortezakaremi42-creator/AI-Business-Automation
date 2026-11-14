import http from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bit24ReadClient, ExchangeError } from "./exchange.mjs";
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/sw.js", ["sw.js", "text/javascript"]],
  [
    "/manifest.webmanifest",
    ["manifest.webmanifest", "application/manifest+json"],
  ],
  ["/icon.svg", ["icon.svg", "image/svg+xml"]],
  ["/icon-192.png", ["icon-192.png", "image/png"]],
  ["/icon-512.png", ["icon-512.png", "image/png"]],
]);
const hash = (s) => createHash("sha256").update(s).digest();
export function createLiveConsole({
  origin,
  ownerPassword,
  apiKey = "",
  client = new Bit24ReadClient({ apiKey }),
  now = Date.now,
}) {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.protocol !== "https:")
  )
    throw Error("EXACT_HTTPS_PUBLIC_ORIGIN_REQUIRED");
  if (
    typeof ownerPassword !== "string" ||
    ownerPassword.length < 32 ||
    ownerPassword.length > 256
  )
    throw Error("OWNER_PASSWORD_MIN_32_CHARACTERS");
  const expected = hash(ownerPassword),
    sessions = new Map();
  let attempts = 0,
    attemptWindow = now(),
    cached = null,
    lastAttempt = null,
    lastError = null,
    pending = null;
  function headers(res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (url.protocol === "https:")
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  function send(res, status, data) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  }
  function session(req) {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("bit24_owner="))
      ?.slice(12);
    return cookie && sessions.get(cookie) > now() ? cookie : null;
  }
  function setCookie(res, id, maxAge) {
    res.setHeader(
      "Set-Cookie",
      `bit24_owner=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`,
    );
  }
  async function body(req) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw Error("JSON_REQUIRED");
    let data = "";
    for await (const b of req) {
      data += b;
      if (Buffer.byteLength(data) > 4096) throw Error("REQUEST_TOO_LARGE");
    }
    return JSON.parse(data);
  }
  async function sync() {
    if (pending) return pending;
    if (lastAttempt !== null && now() - lastAttempt < 15000) return;
    lastAttempt = now();
    pending = (async () => {
      try {
        const next = await client.snapshot();
        cached = next;
        lastError = null;
      } catch (e) {
        cached = null;
        lastError = e instanceof ExchangeError ? e.message : "SYNC_FAILED";
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  const server = http.createServer(async (req, res) => {
    headers(res);
    try {
      if (req.headers.host !== url.host)
        return send(res, 421, { error: "HOST_REJECTED" });
      if (req.headers.origin && req.headers.origin !== origin)
        return send(res, 403, { error: "ORIGIN_REJECTED" });
      if (req.method === "POST" && req.headers.origin !== origin)
        return send(res, 403, { error: "ORIGIN_REQUIRED" });
      const path = new URL(req.url, origin).pathname;
      if (req.method === "GET" && publicFiles.has(path)) {
        const [file, type] = publicFiles.get(path);
        res.writeHead(200, { "Content-Type": type });
        return res.end(
          readFileSync(new URL("public/" + file, import.meta.url)),
        );
      }
      if (path === "/api/login" && req.method === "POST") {
        if (now() - attemptWindow >= 60000) {
          attemptWindow = now();
          attempts = 0;
        }
        if (attempts >= 5)
          return send(res, 429, { error: "LOGIN_RATE_LIMITED" });
        attempts++;
        const b = await body(req);
        if (
          typeof b.password !== "string" ||
          b.password.length > 256 ||
          !timingSafeEqual(expected, hash(b.password))
        )
          return send(res, 401, { error: "LOGIN_REJECTED" });
        // Bounded memory, rotating sessions, no permanent browser token storage.
        const old = session(req);
        if (old) sessions.delete(old);
        for (const [k, t] of sessions) if (t <= now()) sessions.delete(k);
        if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
        const id = randomBytes(32).toString("base64url");
        sessions.set(id, now() + 8 * 3600000);
        setCookie(res, id, 8 * 3600);
        return send(res, 200, { ok: true });
      }
      const sid = session(req);
      if (path.startsWith("/api/") && !sid)
        return send(res, 401, { error: "LOGIN_REQUIRED" });
      if (path === "/api/logout" && req.method === "POST") {
        sessions.delete(sid);
        cached = null;
        setCookie(res, "", 0);
        return send(res, 200, { ok: true });
      }
      if (path === "/api/state" && req.method === "GET") {
        if (req.headers["sec-fetch-site"] === "cross-site")
          return send(res, 403, { error: "ORIGIN_REJECTED" });
        await sync();
        const fresh = cached && now() - cached.receivedAt <= 30000;
        return send(res, 200, {
          connection: fresh ? "AUTHENTICATED_READ" : "DISCONNECTED",
          error: lastError,
          checkedAt: lastAttempt,
          snapshot: fresh ? cached : null,
          execution: {
            enabled: false,
            state: "LOCKED",
            permissionsVerified: false,
            blockers: [
              "SPOT_ONLY_PERMISSIONS_UNVERIFIED",
              "LIVE_WRITE_ADAPTER_NOT_IMPLEMENTED",
              "LIVE_FILL_LEDGER_NOT_INTEGRATED",
              "AUTHENTICATED_ACCEPTANCE_TEST_REQUIRED",
            ],
          },
          limits: {
            capitalLimitIrt: "1000000",
            orderBudgetLimitIrt: "100000",
            enforcedForExecution: false,
          },
        });
      }
      // No order submission, cancellation, transfer, margin or withdrawal code exists in this build.
      if (path.startsWith("/api/"))
        return send(res, 423, {
          error: "EXECUTION_NOT_IMPLEMENTED_LOCKED",
          orderSubmitted: false,
        });
      send(res, 404, { error: "NOT_FOUND" });
    } catch {
      send(res, 400, { error: "REQUEST_REJECTED" });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxConnections = 100;
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createLiveConsole({
    origin: process.env.PUBLIC_ORIGIN || "http://localhost:3050",
    ownerPassword: process.env.OWNER_PASSWORD,
    apiKey: process.env.BIT24_API_KEY || "",
  });
  server.listen(
    Number(process.env.PORT || 3050),
    process.env.HOST || "0.0.0.0",
    () =>
      console.log(
        "BIT24 real-source READ console started. Execution LOCKED; authenticated exchange connection not yet verified.",
      ),
  );
  for (const sig of ["SIGINT", "SIGTERM"])
    process.once(sig, () => server.close(() => process.exit(0)));
}
