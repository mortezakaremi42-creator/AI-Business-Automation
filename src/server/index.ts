import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import { Bit24PlatformOrchestrator } from '../core/platformRuntime.js';
import { Bit24OfficialClient } from './bit24/bit24Client.js';
import { Bit24CredentialVault } from './bit24/credentialVault.js';
import { ServerBit24Adapter } from './engine/serverAdapter.js';
import { createApiRouter } from './routes/api.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const hasAdminToken = Boolean((process.env.ADMIN_ACCESS_TOKEN || '').trim());

async function bootstrap() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  const vault = new Bit24CredentialVault();
  const bit24Client = new Bit24OfficialClient();
  const adapter = new ServerBit24Adapter(vault, bit24Client);
  const orchestrator = new Bit24PlatformOrchestrator(adapter, {
    serverBackendConnected: true,
    adminAuthProtected: hasAdminToken,
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcastSnapshot = () => {
    const payload = JSON.stringify({
      type: 'SNAPSHOT',
      snapshot: orchestrator.getSnapshot(true),
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        type: 'SNAPSHOT',
        snapshot: orchestrator.getSnapshot(true),
      })
    );
  });

  // Root-level Zero-Withdrawal Firewall across all routes
  app.use((req, res, next) => {
    if (req.originalUrl.toLowerCase().includes('withdraw')) {
      orchestrator.addLog(
        'ERROR',
        'SECURITY',
        'تلاش برای فراخوانی مسیر برداشت وجه در لایه ریشه سرور مسدود شد (HTTP 403).'
      );
      res.status(403).json({
        ok: false,
        error: 'مسدودسازی امنیتی قطعی: هیچ‌گونه مجوز یا عملیات برداشت وجه در این سامانه مجاز نیست.',
      });
      return;
    }
    next();
  });

  app.use('/api', createApiRouter(orchestrator, adapter, broadcastSnapshot));

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist/client');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Continuous 24/7 market & bot evaluation loop
  setInterval(async () => {
    try {
      await orchestrator.tickCycle();
      broadcastSnapshot();
    } catch {
      // Resilient background loop
    }
  }, 7000);

  server.listen(PORT, HOST, () => {
    console.log(
      `[Bit24 Smart Trader AI + Gold] Running on http://${HOST}:${PORT} (Safe-Boot Lock Active | Server Vault Active)`
    );
  });
}

bootstrap().catch((err) => {
  console.error('Fatal server startup error:', err?.message || 'startup failure');
  process.exit(1);
});
