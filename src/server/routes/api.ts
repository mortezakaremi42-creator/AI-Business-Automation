import { Request, Response, NextFunction, Router } from 'express';
import { Bit24PlatformOrchestrator } from '../../core/platformRuntime.js';
import { ModuleId, TradingEnvironmentMode } from '../../shared/types.js';
import { ServerBit24Adapter } from '../engine/serverAdapter.js';
import { inspectTokenContractLive } from '../security/onChainSecurityClient.js';

const VALID_MODULES = new Set<ModuleId>([
  'DIGITAL_GOLD',
  'SPOT_CRYPTO',
  'MEME_HUNTER',
  'LEVERAGE_MARGIN',
]);
const VALID_MODES = new Set<TradingEnvironmentMode>(['ANALYSIS_ONLY', 'PAPER', 'LIVE']);

export function createApiRouter(
  orchestrator: Bit24PlatformOrchestrator,
  adapter: ServerBit24Adapter,
  broadcastSnapshot: () => void
): Router {
  const router = Router();
  const adminToken = (process.env.ADMIN_ACCESS_TOKEN || '').trim();
  const ipHits = new Map<string, number[]>();

  // 1. Security Headers & No-Cache for Financial Telemetry
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // 2. HARD SECURITY FIREWALL: Never allow any withdrawal path
  router.use((req, res, next) => {
    if (req.path.toLowerCase().includes('withdraw')) {
      orchestrator.addLog(
        'ERROR',
        'SECURITY',
        'تلاش برای فراخوانی مسیر غیرمجاز برداشت وجه (withdraw) مسدود و در گزارش امنیتی ثبت شد.'
      );
      res.status(403).json({
        ok: false,
        error:
          'مسدودسازی امنیتی قطعی: عملیات برداشت وجه از طریق API در این سیستم به‌طور کامل ممنوع است.',
      });
      return;
    }
    next();
  });

  // 3. Per-IP API Rate Limiter (Stage 8 Security Requirement)
  router.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'local';
    const now = Date.now();
    const cutoff = now - 60_000;
    const recent = (ipHits.get(ip) || []).filter((ts) => ts >= cutoff);
    if (recent.length >= 120) {
      orchestrator.addLog(
        'WARN',
        'SECURITY',
        'محدودیت نرخ درخواست سمت سرور (Rate Limit) برای یک آدرس کلاینت اعمال شد.'
      );
      res.status(429).json({
        ok: false,
        error: 'تعداد درخواست‌های ارسالی بیش از حد مجاز در دقیقه است؛ لطفاً چند ثانیه صبر کنید.',
      });
      return;
    }
    recent.push(now);
    ipHits.set(ip, recent);
    next();
  });

  // 4. Optional Admin Token Authentication on Mutating Routes
  const requireAdminIfConfigured = (req: Request, res: Response, next: NextFunction) => {
    if (!adminToken) {
      next();
      return;
    }
    const provided = String(
      req.header('x-admin-token') ||
        req.header('authorization')?.replace(/^Bearer\s+/i, '') ||
        ''
    ).trim();
    if (provided !== adminToken) {
      orchestrator.addLog(
        'WARN',
        'SECURITY',
        `تلاش دسترسی بدون توکن مدیریت معتبر به مسیر ${req.path} مسدود شد.`
      );
      res.status(401).json({
        ok: false,
        error: 'احراز هویت ناموفق: توکن دسترسی مدیر (X-Admin-Token) معتبر نیست.',
      });
      return;
    }
    next();
  };

  router.get('/snapshot', (_req, res) => {
    res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
  });

  router.get('/export/history.csv', (_req, res) => {
    const csv = orchestrator.exportHistoryCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bit24-smart-trader-history-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.status(200).send(csv);
  });

  router.post('/bit24/connect', requireAdminIfConfigured, async (req, res) => {
    try {
      const snapBefore = orchestrator.getSnapshot(true);
      if (!snapBefore.paperReadinessPassed) {
        res.status(400).json({
          ok: false,
          error: 'پیش از ثبت کلید واقعی، ابتدا باید تست‌های حالت آزمایشی با موفقیت انجام شوند.',
        });
        return;
      }

      const rawApiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
      const rawSecretKey =
        typeof req.body?.secretKey === 'string' ? req.body.secretKey.trim() : '';
      const rawPassphrase =
        typeof req.body?.passphrase === 'string' ? req.body.passphrase : undefined;

      if (rawApiKey.length < 8 || rawApiKey.length > 256) {
        res.status(400).json({
          ok: false,
          error: 'اعتبارسنجی ورودی: کلید API بیت‌۲۴ باید بین ۸ تا ۲۵۶ کاراکتر باشد.',
        });
        return;
      }

      const saved = adapter.vault.saveCredentials(rawApiKey, rawSecretKey, rawPassphrase);
      const [testRes, walletRes] = await Promise.all([
        adapter.fetchLiveMarkets(),
        adapter.fetchVerifiedWallet(),
      ]);

      if (testRes.ok) {
        orchestrator.setBit24ConnectionMeta({
          state: 'CONNECTED_VERIFIED',
          latencyMs: testRes.latencyMs,
          errorCategory: 'NONE',
          verifiedWallet: walletRes,
          statusMessageFa: `کلید API بیت‌۲۴ (${saved.maskedKey}) تایید و به ${testRes.markets.length} بازار متصل شد.`,
        });
        orchestrator.addLog(
          'SUCCESS',
          'SECURITY',
          `اتصال امن کلید API بیت‌۲۴ (${saved.maskedKey}) در گاوصندوق سرور AES-256-GCM برقرار و تأیید شد.`
        );
      } else {
        orchestrator.setBit24ConnectionMeta({
          state: testRes.errorCategory === 'AUTH_OR_IP_ERROR' ? 'AUTH_ERROR' : 'UNREACHABLE',
          latencyMs: testRes.latencyMs,
          errorCategory: testRes.errorCategory,
          verifiedWallet: walletRes,
          statusMessageFa:
            testRes.errorFa ||
            `کلید ${saved.maskedKey} به‌صورت رمزنگاری‌شده در سرور ذخیره شد (در انتظار دسترسی شبکه به rest.bit24.cash).`,
        });
        orchestrator.addLog(
          'WARN',
          'SECURITY',
          `کلید ${saved.maskedKey} در سرور ذخیره شد؛ نتیجه تست اتصال: ${testRes.errorFa || 'عدم دسترسی شبکه — حالت آزمایشی فعال است'}`
        );
      }
      broadcastSnapshot();
      res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
    } catch (err: any) {
      res.status(400).json({
        ok: false,
        error: adapter.redactText(err?.message || 'خطا در ذخیره امن کلید API'),
      });
    }
  });

  router.post('/bit24/disconnect', requireAdminIfConfigured, (_req, res) => {
    adapter.vault.clearCredentials();
    orchestrator.setEnvironmentMode('PAPER');
    orchestrator.setBit24ConnectionMeta({
      state: 'KEY_NOT_SET',
      latencyMs: null,
      errorCategory: 'NONE',
      verifiedWallet: {
        confirmedByOfficialApi: false,
        totalIrt: null,
        totalUsdt: null,
        spotFreeIrt: null,
        spotFreeUsdt: null,
        assets: [],
        fetchedAt: null,
        noteFa: 'کلید API از گاوصندوق سرور حذف شد؛ سیستم در حالت آزمایشی (Paper) قرار دارد.',
      },
      statusMessageFa: 'کلید API بیت‌۲۴ از حافظه امن سرور حذف شد؛ سیستم در حالت آزمایشی قرار دارد.',
    });
    orchestrator.addLog('WARN', 'SECURITY', 'کلید API بیت‌۲۴ از گاوصندوق رمزنگاری‌شده سرور پاک شد.');
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
  });

  router.post('/module/toggle', requireAdminIfConfigured, (req, res) => {
    try {
      const { module, enabled, acknowledgeLeverageRisk } = req.body || {};
      if (!VALID_MODULES.has(module)) {
        res.status(400).json({ ok: false, error: 'شناسه ماژول نامعتبر است.' });
        return;
      }
      orchestrator.setModuleEnabled(
        module as ModuleId,
        Boolean(enabled),
        Boolean(acknowledgeLeverageRisk)
      );
      broadcastSnapshot();
      res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'خطا در تغییر وضعیت ربات' });
    }
  });

  router.post('/pause-new-trades', requireAdminIfConfigured, (req, res) => {
    const paused = Boolean(req.body?.paused);
    orchestrator.setPauseNewTrades(paused);
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
  });

  router.post('/circuit-breaker/reset', requireAdminIfConfigured, (_req, res) => {
    orchestrator.resetCircuitBreaker();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
  });

  router.post('/mode', requireAdminIfConfigured, (req, res) => {
    try {
      const { mode, explicitLiveConfirmation } = req.body || {};
      if (!VALID_MODES.has(mode)) {
        res.status(400).json({ ok: false, error: 'حالت اجرایی انتخاب‌شده معتبر نیست.' });
        return;
      }
      orchestrator.setEnvironmentMode(
        mode as TradingEnvironmentMode,
        Boolean(explicitLiveConfirmation)
      );
      broadcastSnapshot();
      res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'خطا در تغییر حالت معاملاتی' });
    }
  });

  router.post('/settings', requireAdminIfConfigured, (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json({ ok: false, error: 'ساختار تنظیمات نامعتبر است.' });
        return;
      }
      orchestrator.updateSettings(req.body);
      broadcastSnapshot();
      res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'خطا در ذخیره تنظیمات' });
    }
  });

  router.post('/emergency/stop', requireAdminIfConfigured, async (req, res) => {
    const cancelOpen = req.body?.cancelBit24OpenOrders !== false;
    const result = await orchestrator.emergencyStopAll(cancelOpen);
    broadcastSnapshot();
    res.json({ ok: true, result, snapshot: orchestrator.getSnapshot(true) });
  });

  router.post('/emergency/liquidate', requireAdminIfConfigured, async (req, res) => {
    try {
      const result = await orchestrator.emergencyLiquidateAllPositions(
        Boolean(req.body?.explicitSeparateConfirmation)
      );
      broadcastSnapshot();
      res.json({ ok: true, result, snapshot: orchestrator.getSnapshot(true) });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'نیاز به تایید جداگانه' });
    }
  });

  router.post('/positions/close', requireAdminIfConfigured, (req, res) => {
    const positionId = String(req.body?.positionId || '').trim();
    if (!positionId) {
      res.status(400).json({ ok: false, error: 'شناسه موقعیت باز الزامی است.' });
      return;
    }
    const closed = orchestrator.closeSinglePositionManually(positionId);
    broadcastSnapshot();
    res.json({ ok: true, closed, snapshot: orchestrator.getSnapshot(true) });
  });

  router.post('/signals/paper-execute', requireAdminIfConfigured, (req, res) => {
    try {
      const signalId = String(req.body?.signalId || '').trim();
      if (!signalId) {
        res.status(400).json({ ok: false, error: 'شناسه سیگنال الزامی است.' });
        return;
      }
      const pos = orchestrator.executeSignalNowInPaper(signalId);
      broadcastSnapshot();
      res.json({ ok: true, position: pos, snapshot: orchestrator.getSnapshot(true) });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || 'خطا در ثبت معامله آزمایشی' });
    }
  });

  router.post('/backtest', (req, res) => {
    const rawMod = req.body?.module;
    const mod =
      rawMod === 'SPOT_CRYPTO'
        ? 'SPOT_CRYPTO'
        : rawMod === 'MEME_HUNTER'
          ? 'MEME_HUNTER'
          : 'DIGITAL_GOLD';
    const marketName =
      typeof req.body?.marketName === 'string' ? req.body.marketName.slice(0, 24) : undefined;
    const summary = orchestrator.runBacktest(mod, marketName);
    res.json({ ok: true, summary });
  });

  router.post('/scan-now', async (_req, res) => {
    const snapshot = await orchestrator.tickCycle();
    broadcastSnapshot();
    res.json({ ok: true, snapshot });
  });

  // ==================== ANTI-RUG & SMART SECURITY ROUTES ====================
  router.post('/security/inspect-token', async (req, res) => {
    try {
      const contractAddress = String(req.body?.contractAddress || '').trim();
      const rawNet = req.body?.network;
      const network =
        rawNet === 'ETHEREUM_EVM' || rawNet === 'BSC_EVM' || rawNet === 'SOLANA_SPL'
          ? rawNet
          : undefined;

      const report = await inspectTokenContractLive({
        contractAddress,
        network,
        config: orchestrator.getSnapshot(true).antiRug.config,
      });
      orchestrator.recordCustomInspectedToken(report);
      broadcastSnapshot();
      res.json({ ok: true, report, snapshot: orchestrator.getSnapshot(true) });
    } catch (err: any) {
      res.status(400).json({
        ok: false,
        error: err?.message || 'خطا در بررسی امنیت قرارداد توکن',
      });
    }
  });

  router.post('/security/test-buy', (req, res) => {
    const symbol = String(req.body?.symbol || '').trim();
    if (!symbol) {
      res.status(400).json({ ok: false, error: 'نماد توکن الزامی است.' });
      return;
    }
    const result = orchestrator.testDemoBuyThroughAntiRug(symbol);
    broadcastSnapshot();
    res.json({ ok: true, result, snapshot: orchestrator.getSnapshot(true) });
  });

  router.post('/security/simulate-state', requireAdminIfConfigured, async (req, res) => {
    if (typeof req.body?.securityServiceOnline === 'boolean') {
      orchestrator.setSecurityServiceOnline(req.body.securityServiceOnline);
    }
    if (typeof req.body?.simulatedFeedStale === 'boolean') {
      orchestrator.setSimulatedFeedStale(req.body.simulatedFeedStale);
    }
    if (req.body?.triggerSystemFault === true) {
      await orchestrator.triggerSystemFaultEmergencyTest();
    }
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
  });

  router.post('/security/config', requireAdminIfConfigured, (req, res) => {
    orchestrator.updateAntiRugConfig(req.body || {});
    broadcastSnapshot();
    res.json({ ok: true, snapshot: orchestrator.getSnapshot(true) });
  });

  return router;
}
