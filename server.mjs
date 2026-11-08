import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaperTradingEngine } from './lib/trading-engine.mjs';
import { calculateMacd, calculateRsi } from './lib/indicators.mjs';
import { LiveTradingUnavailableError } from './lib/bit24-adapter.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 64 * 1024;
const engine = new PaperTradingEngine({ startingCash: Number(process.env.DEMO_STARTING_CASH || 10_000) });
const rateBuckets = new Map();
const idempotency = new Map();
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
]);

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const safeError = (error) => ({ error: error.message || 'Request failed.' });

function consumeRateLimit(req) {
  const now = Date.now();
  const key = req.socket.remoteAddress || 'unknown';
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now >= bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 60_000; }
  bucket.count++;
  rateBuckets.set(key, bucket);
  return bucket.count <= 120;
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Malformed JSON.'), { statusCode: 400 }); }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function api(req, res, url) {
  if (!consumeRateLimit(req)) return sendJson(res, 429, { error: 'Rate limit exceeded. Retry shortly.' });
  if (req.method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request rejected.' });
  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(res, 200, { ...engine.stats, positions: [...engine.positions.values()], recentClosedTrades: engine.closedTrades.slice(-50).reverse(), config: { ...engine.config, feeRoundTrip: engine.config.feePerSide * 2, slippageLimit: 0.003 }, liveTradingAvailable: false, exchange: 'Bit24', liveReason: 'Live mode remains disabled until current official Bit24 API documentation, verified permissions and an audited server-side adapter are configured.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/trades/closed') return sendJson(res, 200, { trades: engine.closedTrades, stats: engine.stats });
    if (req.method === 'POST' && url.pathname === '/api/mode') {
      const body = await readBody(req);
      if (body.mode !== 'PAPER') return sendJson(res, 403, { error: new LiveTradingUnavailableError().message });
      return sendJson(res, 200, { mode: 'PAPER', liveTradingAvailable: false });
    }
    if (req.method === 'POST' && url.pathname === '/api/bot/start') return sendJson(res, 200, engine.start());
    if (req.method === 'POST' && url.pathname === '/api/bot/stop') return sendJson(res, 200, engine.stop());
    if (req.method === 'POST' && url.pathname === '/api/panic') {
      const result = engine.panicStop();
      return sendJson(res, 200, { ...result, mode: 'PAPER', message: 'Paper positions closed at their last simulated marks; pending paper orders cancelled; engine stopped and panic latch enabled.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/panic/reset') return sendJson(res, 200, engine.resetPanicLatch());
    if (req.method === 'POST' && url.pathname === '/api/demo/cash') {
      const body = await readBody(req);
      return sendJson(res, 200, engine.adjustPaperCash(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/trades') {
      const body = await readBody(req);
      body.manual = true;
      const key = req.headers['idempotency-key'];
      if (key && idempotency.has(key)) return sendJson(res, 200, idempotency.get(key));
      if (body.side && body.side !== 'BUY') return sendJson(res, 422, { error: 'Spot demo supports BUY to open; use a position close to sell owned base asset. Short opening is not supported.' });
      const position = engine.openLong(body);
      const result = { position, stats: engine.stats };
      if (key) idempotency.set(key, result);
      return sendJson(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/prices') {
      const body = await readBody(req);
      return sendJson(res, 200, engine.onPrice(body.symbol, body.price));
    }
    if (req.method === 'POST' && url.pathname === '/api/indicators') {
      const body = await readBody(req);
      return sendJson(res, 200, { rsi: calculateRsi(body.candles, body.rsiPeriod ?? 14), macd: calculateMacd(body.candles) });
    }
    const closeMatch = req.method === 'POST' && url.pathname.match(/^\/api\/positions\/([\da-f-]+)\/close$/i);
    if (closeMatch) {
      const body = await readBody(req);
      const trade = engine.closePosition(closeMatch[1], body.price, 'MANUAL');
      return sendJson(res, 200, { trade, stats: engine.stats });
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'API route not found.' });
    return false;
  } catch (error) {
    return sendJson(res, error.statusCode || 422, safeError(error));
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
  const file = staticFiles.get(url.pathname);
  if (!file) return sendJson(res, 404, { error: 'Not found.' });
  try {
    const bytes = await readFile(path.join(ROOT, file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': file[0] === 'index.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { sendJson(res, 404, { error: 'Asset not found.' }); }
});

server.listen(PORT, HOST, () => console.log(`Nova demo server listening on http://${HOST}:${PORT} (paper trading only; no live exchange connection)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
