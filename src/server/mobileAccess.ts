import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";
export interface MobileAccessOptions {
  token?: string;
  allowedOrigins?: string[];
}
function loopback(address: string | undefined) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address?.startsWith("::ffff:127.") === true
  );
}
export function createMobileAccess(options: MobileAccessOptions = {}) {
  const token = options.token ?? process.env.DASHBOARD_API_TOKEN ?? "";
  const origins = new Set(
    options.allowedOrigins ??
      (
        process.env.CORS_ALLOWED_ORIGINS ??
        "http://localhost,https://localhost,capacitor://localhost,http://localhost:3000,http://127.0.0.1:3000"
      )
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
  );
  function tokenMatches(value: unknown) {
    if (typeof value !== "string" || value.length > 1024) return false;
    const a = Buffer.from(value),
      b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  function authorized(req: IncomingMessage, ws = false) {
    if (!token) return loopback(req.socket.remoteAddress);
    const supplied = ws
      ? (req.headers["sec-websocket-protocol"] ?? "")
          .split(",")
          .map((s) => s.trim())
          .find((s) => s.startsWith("token."))
          ?.slice(6)
      : req.headers["x-api-token"];
    return tokenMatches(supplied);
  }
  const middleware: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {
      res.status(403).json({ ok: false, error: "ORIGIN_FORBIDDEN" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Accept,X-API-Token",
    );
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (!authorized(req)) {
      res
        .status(401)
        .json({
          ok: false,
          error: "DASHBOARD_AUTH_REQUIRED",
          messageFa:
            "توکن دسترسی پنل لازم است. روی سرور DASHBOARD_API_TOKEN را تنظیم و همان توکن را در پنل گوشی وارد کنید.",
        });
      return;
    }
    next();
  };
  return {
    middleware,
    verifyWebSocket: (req: IncomingMessage) =>
      (!req.headers.origin || origins.has(req.headers.origin)) &&
      authorized(req, true),
  };
}
