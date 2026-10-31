import React, { useState } from 'react';
import {
  AppLanguage,
  Bit24ApiHealth,
  TelegramNotificationLog,
} from '../../shared/contracts.js';

interface Props {
  lang: AppLanguage;
  bit24Health: Bit24ApiHealth;
  telegramState: {
    configured: boolean;
    enabled: boolean;
    maskedChatId: string;
    recentLogs: TelegramNotificationLog[];
  };
  onSaveBit24: (apiKey: string, secretKey: string) => void;
  onVerifyBit24: () => void;
  onClearBit24: () => void;
  onSaveTelegram: (params: {
    botToken?: string;
    chatId?: string;
    enabled: boolean;
  }) => void;
  onSendDailyTelegram: () => void;
}

export const ApiAndTelegramPanel: React.FC<Props> = ({
  lang,
  bit24Health,
  telegramState,
  onSaveBit24,
  onVerifyBit24,
  onClearBit24,
  onSaveTelegram,
  onSendDailyTelegram,
}) => {
  const isFa = lang === 'fa';
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [tgEnabled, setTgEnabled] = useState(telegramState.enabled);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Official Bit24 API Vault */}
      <div className="section-card">
        <div className="section-title">
          <span>
            {isFa
              ? '🔐 اتصال رسمی و امن به صرافی Bit24 (بدون دسترسی برداشت وجه)'
              : '🔐 Official & Encrypted Bit24 API Connection (Zero-Withdrawal Policy)'}
          </span>
          <span className="badge badge-safe-lock">
            {isFa
              ? 'فایروال امنیتی: اندپوینت برداشت وجه (Withdraw) ۱۰۰٪ مسدود است'
              : 'Firewall: All Withdrawal Endpoints 100% Blocked'}
          </span>
        </div>

        <p style={{ fontSize: '0.83rem', color: '#bae6fd', marginTop: 0 }}>
          {isFa
            ? `وضعیت فعلی: ${bit24Health.messageFa} | فید فعال: ${
                bit24Health.activeMarketFeed === 'LIVE_BIT24_API'
                  ? 'API زنده Bit24'
                  : 'شبیه‌ساز دمو Bit24'
              }`
            : `Current Status: ${bit24Health.messageEn} | Active Feed: ${bit24Health.activeMarketFeed}`}
        </p>

        {bit24Health.maskedApiKey && (
          <div style={{ fontSize: '0.82rem', marginBottom: 10, color: '#34d399' }}>
            {isFa
              ? `کلید ذخیره شده (AES-256-GCM): ${bit24Health.maskedApiKey}`
              : `Encrypted Stored Key (AES-256-GCM): ${bit24Health.maskedApiKey}`}
          </div>
        )}

        <div className="form-grid">
          <label className="form-field">
            <span>
              {isFa
                ? 'کلید API صرافی Bit24 (X-BIT24-APIKEY)'
                : 'Bit24 API Key (X-BIT24-APIKEY)'}
            </span>
            <input
              type="password"
              autoComplete="off"
              placeholder={
                isFa
                  ? 'فقط دسترسی خواندن و معامله اسپات (بدون برداشت!)'
                  : 'Spot Read/Trade key ONLY (NO withdrawal permission!)'
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>

          <label className="form-field">
            <span>
              {isFa
                ? 'کلید اختصاصی امضای HMAC-SHA256 (اختیاری در حالت دمو)'
                : 'Bit24 Secret Key for HMAC-SHA256 (Optional in Demo)'}
            </span>
            <input
              type="password"
              autoComplete="off"
              placeholder="••••••••••••••••••••••••"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
            />
          </label>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 14,
          }}
        >
          <button
            type="button"
            className="cmd-btn cmd-btn-start"
            onClick={() => {
              onSaveBit24(apiKey, secretKey);
              setApiKey('');
              setSecretKey('');
            }}
          >
            {isFa
              ? 'ذخیره رمزنگاری‌شده و تست اتصال Bit24'
              : 'Encrypt, Save & Test Bit24 API'}
          </button>

          <button
            type="button"
            className="cmd-btn"
            onClick={onVerifyBit24}
          >
            {isFa ? 'بررسی مجدد وضعیت سرور Bit24' : 'Re-check Bit24 Server'}
          </button>

          <button
            type="button"
            className="cmd-btn cmd-btn-stop"
            onClick={onClearBit24}
          >
            {isFa ? 'حذف کلیدهای ذخیره‌شده' : 'Wipe Stored Keys'}
          </button>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            fontSize: '0.8rem',
          }}
        >
          {isFa
            ? '🔒 قفل ایمنی معاملات واقعی: طبق دستور شما، حالت معامله واقعی (Live) به‌صورت پیش‌فرض خاموش است و تا زمان تأیید نهایی شما هیچ سفارش واقعی در صرافی ثبت نمی‌شود.'
            : '🔒 Live Trading Safety Lock: Per your instructions, Live mode is OFF by default and zero real orders are placed until your explicit final confirmation.'}
        </div>
      </div>

      {/* Optional Safe Telegram Bot API */}
      <div className="section-card">
        <div className="section-title">
          <span>
            {isFa
              ? '📲 اعلان تلگرام اختیاری و امن (Telegram Bot API)'
              : '📲 Optional & Secret-Redacted Telegram Notifications'}
          </span>
          <span className="badge badge-gold">
            {isFa
              ? 'حذف خودکار کلیدهای محرمانه در تمامی پیام‌ها'
              : 'Auto Secret Redaction Active'}
          </span>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>{isFa ? 'توکن ربات تلگرام (Bot Token)' : 'Telegram Bot Token'}</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="123456789:ABC..."
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
          </label>

          <label className="form-field">
            <span>{isFa ? 'شناسه چت (Chat ID)' : 'Telegram Chat ID'}</span>
            <input
              type="text"
              placeholder={telegramState.maskedChatId || 'e.g. 987654321'}
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
            />
          </label>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            marginTop: 14,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={tgEnabled}
              onChange={(e) => setTgEnabled(e.target.checked)}
            />
            {isFa ? 'فعال‌سازی ارسال اعلان‌های تلگرام' : 'Enable Telegram Alerts'}
          </label>

          <button
            type="button"
            className="cmd-btn cmd-btn-start"
            onClick={() => {
              onSaveTelegram({ botToken, chatId, enabled: tgEnabled });
              setBotToken('');
            }}
          >
            {isFa ? 'ذخیره تنظیمات تلگرام' : 'Save Telegram Settings'}
          </button>

          <button
            type="button"
            className="cmd-btn cmd-btn-gold"
            onClick={onSendDailyTelegram}
          >
            {isFa
              ? 'ارسال گزارش سود و زیان روزانه به تلگرام'
              : 'Send Daily PnL Report Now'}
          </button>
        </div>

        {telegramState.recentLogs.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <strong style={{ fontSize: '0.84rem' }}>
              {isFa ? 'آخرین رویدادهای اعلان (عاری از هرگونه اطلاعات امنیتی):' : 'Recent Alert Log (Sanitized):'}
            </strong>
            <ul className="reason-list">
              {telegramState.recentLogs.slice(0, 6).map((l) => (
                <li key={l.id}>
                  [{l.eventType}] <strong>{l.title}</strong> — {l.safeMessagePreview}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
