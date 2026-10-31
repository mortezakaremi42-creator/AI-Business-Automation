import {
  TelegramEventType,
  TelegramNotificationLog,
} from '../shared/contracts.js';
import { EncryptedSecretVault } from './encryptedVault.js';

/**
 * Strips any potential API key, Secret key, Bot token, or long hex/alphanumeric token
 * so secrets are NEVER sent over Telegram!
 */
export function scrubSecretsFromTelegramText(
  rawText: string,
  knownSecrets: string[] = []
): string {
  let out = rawText || '';
  for (const s of knownSecrets) {
    const clean = (s || '').trim();
    if (clean.length >= 6) {
      out = out.split(clean).join('[REDACTED_SECRET]');
    }
  }
  // Redact Telegram Bot token pattern (digits:alphanumeric)
  out = out.replace(/\b\d{7,12}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_BOT_TOKEN]');
  // Redact long hex/API key strings (>= 28 contiguous hex/base64url chars)
  out = out.replace(/\b[A-Za-z0-9_-]{28,}\b/g, '[REDACTED_KEY]');
  return out;
}

export class SafeTelegramNotificationService {
  private readonly vault: EncryptedSecretVault;

  constructor(vault: EncryptedSecretVault) {
    this.vault = vault;
  }

  public async sendAlert(
    eventType: TelegramEventType,
    title: string,
    summaryText: string
  ): Promise<TelegramNotificationLog> {
    const secrets = this.vault.getSecretsInternal();
    const secretList = [
      secrets.bit24ApiKey,
      secrets.bit24SecretKey,
      secrets.telegramBotToken,
    ];

    const safeTitle = scrubSecretsFromTelegramText(title, secretList);
    const safeBody = scrubSecretsFromTelegramText(summaryText, secretList);
    const fullMessage = `🤖 BIT24 AI TRADER PRO\n📌 ${safeTitle}\n${safeBody}`;

    if (
      !secrets.telegramEnabled ||
      !secrets.telegramBotToken ||
      !secrets.telegramChatId
    ) {
      return {
        id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        eventType,
        deliveredToTelegram: false,
        title: safeTitle,
        safeMessagePreview: safeBody,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_500);

    try {
      const endpoint = `https://api.telegram.org/bot${secrets.telegramBotToken}/sendMessage`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: secrets.telegramChatId,
          text: fullMessage,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });

      return {
        id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        eventType,
        deliveredToTelegram: resp.ok,
        title: safeTitle,
        safeMessagePreview: safeBody,
      };
    } catch {
      return {
        id: `tg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        eventType,
        deliveredToTelegram: false,
        title: safeTitle,
        safeMessagePreview: `${safeBody} (آفلاین / عدم دسترسی به سرور تلگرام در شبکه فعلی)`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
