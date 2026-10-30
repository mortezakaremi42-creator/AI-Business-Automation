import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Bit24AiTraderOrchestrator } from '../engine/traderOrchestrator.js';
import { Bit24OfficialRestClient } from './bit24OfficialClient.js';
import { EncryptedSecretVault } from './encryptedVault.js';
import { SafeTelegramNotificationService } from './telegramService.js';

export function createBit24ProAppServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));

  const vault = new EncryptedSecretVault();
  const bit24Client = new Bit24OfficialRestClient(vault);
  const telegramService = new SafeTelegramNotificationService(vault);

  const orchestrator = new Bit24AiTraderOrchestrator({
    liveExecutor: {
      checkLiveIrtBalance: () => bit24Client.checkLiveIrtBalance(),
      submitAndVerifySpotOrder: (params) =>
        bit24Client.submitAndVerifySpotOrder(params),
    },
    onTelegramDispatch: (eventType, title, safeSummary) =>
      telegramService.sendAlert(eventType, title, safeSummary),
  });

  const syncVaultMetaToOrchestrator = () => {
    const meta = vault.getPublicSafeSummary();
    orchestrator.setTelegramMeta({
      configured: meta.telegramConfigured,
      enabled: meta.telegramEnabled,
      maskedChatId: meta.maskedTelegramChatId,
    });
    if (meta.hasBit24ApiKey) {
      orchestrator.setBit24Health({
        hasApiKey: meta.hasBit24ApiKey,
        hasSecretKey: meta.hasBit24SecretKey,
        maskedApiKey: meta.maskedBit24ApiKey,
      });
    }
  };
  syncVaultMetaToOrchestrator();

  // ==================== HARD WITHDRAWAL FIREWALL ====================
  app.all('/api/*withdraw*', (_req, res) => {
    res.status(403).json({
      ok: false,
      code: 'BIT24_WITHDRAWAL_FORBIDDEN',
      messageFa:
        'مسدودسازی امنیتی دائمی: ربات BIT24 AI TRADER PRO هرگز اجازه برداشت وجه ندارد.',
      messageEn:
        'Permanent security firewall: BIT24 AI TRADER PRO never permits withdrawal operations.',
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'BIT24 AI TRADER PRO',
      exchangeOnly: 'Bit24 (https://rest.bit24.cash)',
      withdrawalPermissionBlocked: true,
      liveTradingLockedByDefault: !orchestrator.getSnapshot().liveTradingUserConfirmed,
      timestamp: Date.now(),
    });
  });

  app.get('/api/status', (_req, res) => {
    res.json(orchestrator.getSnapshot());
  });

  app.post('/api/scanner/start', (_req, res) => {
    orchestrator.startScanner();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/scanner/stop', (_req, res) => {
    orchestrator.stopScanner();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/trading/start-demo', (_req, res) => {
    orchestrator.startDemoTrading();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/trading/stop', (_req, res) => {
    orchestrator.stopTrading();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/trading/emergency-stop', async (_req, res) => {
    await orchestrator.triggerEmergencyStop(true);
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/trading/clear-emergency', (_req, res) => {
    orchestrator.clearEmergencyStop();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/trading/activate-live', (req, res) => {
    const phrase = String(req.body?.confirmationPhrase || '');
    const result = orchestrator.activateLiveTradingAfterUserApproval(phrase);
    broadcastSnapshot();
    res.status(result.ok ? 200 : 400).json({
      ...result,
      snapshot: orchestrator.getSnapshot(),
    });
  });

  app.post('/api/trading/manual-demo-buy', async (req, res) => {
    const symbol = String(req.body?.symbol || '').toUpperCase();
    const snap = orchestrator.getSnapshot();
    const sig = snap.topOpportunities.find((s) => s.symbol === symbol);
    if (!sig) {
      res.status(404).json({
        ok: false,
        messageFa: 'نماد در لیست رمزارزهای Bit24 یافت نشد.',
        messageEn: 'Symbol not found in Bit24 crypto list.',
      });
      return;
    }
    const result = await orchestrator.tryOpenCryptoPosition(sig);
    broadcastSnapshot();
    res.status(result.ok ? 200 : 400).json({
      ...result,
      snapshot: orchestrator.getSnapshot(),
    });
  });

  app.post('/api/gold/toggle-auto', (req, res) => {
    orchestrator.setGoldAutoDemo(Boolean(req.body?.enabled));
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/gold/demo-buy', async (req, res) => {
    const symbol = String(req.body?.symbol || 'PAXG/IRT').toUpperCase();
    if (symbol !== 'PAXG/IRT' && symbol !== 'XAUT/IRT') {
      res.status(400).json({
        ok: false,
        messageFa: 'در بخش طلای دیجیتال فقط PAXG/IRT و XAUT/IRT مجاز هستند.',
        messageEn: 'Only PAXG/IRT and XAUT/IRT are permitted in GOLD AI TRADER.',
      });
      return;
    }
    const result = await orchestrator.tryOpenGoldDemoPosition(symbol);
    broadcastSnapshot();
    res.status(result.ok ? 200 : 400).json({
      ...result,
      snapshot: orchestrator.getSnapshot(),
    });
  });

  app.post('/api/risk/update', (req, res) => {
    orchestrator.updateRiskAndExitSettings({
      capital: req.body?.capital,
      exit: req.body?.exit,
    });
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/settings/bit24', async (req, res) => {
    const apiKey = String(req.body?.apiKey || '').trim();
    const secretKey = String(req.body?.secretKey || '').trim();
    if (!apiKey) {
      res.status(400).json({
        ok: false,
        messageFa: 'لطفاً توکن API صرافی Bit24 را وارد کنید.',
        messageEn: 'Please provide your Bit24 API key.',
      });
      return;
    }
    vault.updateBit24Credentials(apiKey, secretKey);
    syncVaultMetaToOrchestrator();
    const health = await bit24Client.verifyConnectionHealth();
    orchestrator.setBit24Health(health);

    if (health.activeMarketFeed === 'LIVE_BIT24_API') {
      const liveMarkets = await bit24Client.fetchLiveIrtMarkets();
      if (liveMarkets) orchestrator.applyLiveBit24Markets(liveMarkets);
    }

    broadcastSnapshot();
    res.json({
      ok: true,
      health,
      snapshot: orchestrator.getSnapshot(),
    });
  });

  app.post('/api/settings/bit24/verify', async (_req, res) => {
    const health = await bit24Client.verifyConnectionHealth();
    orchestrator.setBit24Health(health);
    if (health.activeMarketFeed === 'LIVE_BIT24_API') {
      const liveMarkets = await bit24Client.fetchLiveIrtMarkets();
      if (liveMarkets) orchestrator.applyLiveBit24Markets(liveMarkets);
    }
    broadcastSnapshot();
    res.json({ ok: true, health, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/settings/bit24/clear', (_req, res) => {
    vault.clearBit24Credentials();
    orchestrator.stopTrading();
    orchestrator.setBit24Health({
      state: 'NOT_CONFIGURED',
      hasApiKey: false,
      hasSecretKey: false,
      maskedApiKey: '',
      activeMarketFeed: 'SIMULATED_MARKET_FEED',
      messageFa: 'کلیدهای Bit24 از حافظه رمزنگاری‌شده پاک شدند.',
      messageEn: 'Bit24 API credentials cleared from encrypted vault.',
    });
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/settings/telegram', (req, res) => {
    vault.updateTelegramConfig({
      botToken: req.body?.botToken,
      chatId: req.body?.chatId,
      enabled: req.body?.enabled,
    });
    syncVaultMetaToOrchestrator();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/settings/telegram/daily-report', async (_req, res) => {
    const snap = orchestrator.getSnapshot();
    const d = snap.periodReports.daily;
    const logEntry = await telegramService.sendAlert(
      'DAILY_PNL_REPORT',
      'گزارش سود و زیان روزانه Bit24',
      `تعداد معاملات ۲۴ ساعت: ${d.tradesCount} | نرخ برد: ${d.winRatePct}% | سود/زیان خالص: ${d.netPnlIrt.toLocaleString()} تومان (${d.netReturnPct}%)`
    );
    orchestrator.pushTelegramLog(logEntry);
    broadcastSnapshot();
    res.json({ ok: true, logEntry, snapshot: orchestrator.getSnapshot() });
  });

  app.post('/api/verification/run-100', (_req, res) => {
    const report = orchestrator.runPro100Verification();
    broadcastSnapshot();
    res.json({ ok: true, report, snapshot: orchestrator.getSnapshot() });
  });

  app.get('/api/reports/trades.csv', (_req, res) => {
    const csv = orchestrator.exportTradeHistoryCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="bit24-ai-trader-pro-history.csv"'
    );
    res.send('\uFEFF' + csv);
  });

  // Serve built frontend assets when `dist/client` (or `docs`) exists
  const clientDistDir = fs.existsSync(path.resolve(process.cwd(), 'dist/client'))
    ? path.resolve(process.cwd(), 'dist/client')
    : path.resolve(process.cwd(), 'docs');
  if (fs.existsSync(path.join(clientDistDir, 'index.html'))) {
    app.use(express.static(clientDistDir));
    app.get(/^\/(?!api|ws).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcastSnapshot() {
    const payload = JSON.stringify({
      type: 'SNAPSHOT',
      data: orchestrator.getSnapshot(),
    });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  wss.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'SNAPSHOT',
        data: orchestrator.getSnapshot(),
      })
    );
  });

  // Periodic market scanner & position manager loop (every 4 seconds)
  const loopTimer = setInterval(async () => {
    try {
      const secrets = vault.getSecretsInternal();
      if (secrets.bit24ApiKey) {
        const liveMarkets = await bit24Client.fetchLiveIrtMarkets();
        if (liveMarkets && liveMarkets.length > 0) {
          orchestrator.applyLiveBit24Markets(liveMarkets);
        }
      }
      await orchestrator.stepCycle();
      broadcastSnapshot();
    } catch {
      // Safeguard background loop
    }
  }, 4_000);

  httpServer.on('close', () => {
    clearInterval(loopTimer);
  });

  return { app, httpServer, orchestrator, vault, bit24Client };
}

// Run directly when executed as main server entry
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('server/index.ts') ||
    process.argv[1].endsWith('server/index.js'));

if (isMainModule) {
  const port = Number(process.env.PORT || 3000);
  const { httpServer } = createBit24ProAppServer();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(
      `[BIT24 AI TRADER PRO] Server listening on http://0.0.0.0:${port}`
    );
  });
}
