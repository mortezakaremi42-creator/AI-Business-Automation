import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface StoredSecrets {
  bit24ApiKey: string;
  bit24SecretKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramEnabled: boolean;
}

const DEFAULT_SECRETS: StoredSecrets = {
  bit24ApiKey: process.env.BIT24_API_KEY || '',
  bit24SecretKey: process.env.BIT24_SECRET_KEY || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  telegramEnabled: Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
  ),
};

export function maskSensitiveValue(raw: string): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export class EncryptedSecretVault {
  private readonly vaultFilePath: string;
  private readonly encryptionKey: Buffer;
  private cache: StoredSecrets;

  constructor(customFilePath?: string) {
    this.vaultFilePath =
      customFilePath || path.resolve(process.cwd(), '.bit24-vault.enc');
    const passphrase =
      process.env.BIT24_VAULT_PASSPHRASE ||
      `bit24-ai-trader-pro::${os.hostname()}::${process.cwd()}`;
    this.encryptionKey = crypto.scryptSync(
      passphrase,
      'bit24-pro-aes256gcm-salt-v1',
      32
    );
    this.cache = this.loadFromDisk();
  }

  private loadFromDisk(): StoredSecrets {
    try {
      if (!fs.existsSync(this.vaultFilePath)) {
        return { ...DEFAULT_SECRETS };
      }
      const rawJson = JSON.parse(fs.readFileSync(this.vaultFilePath, 'utf8'));
      const iv = Buffer.from(rawJson.iv, 'hex');
      const tag = Buffer.from(rawJson.tag, 'hex');
      const ciphertext = Buffer.from(rawJson.data, 'hex');

      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        iv
      );
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
      const parsed = JSON.parse(decrypted) as Partial<StoredSecrets>;

      return {
        bit24ApiKey: parsed.bit24ApiKey || DEFAULT_SECRETS.bit24ApiKey,
        bit24SecretKey: parsed.bit24SecretKey || DEFAULT_SECRETS.bit24SecretKey,
        telegramBotToken:
          parsed.telegramBotToken || DEFAULT_SECRETS.telegramBotToken,
        telegramChatId: parsed.telegramChatId || DEFAULT_SECRETS.telegramChatId,
        telegramEnabled:
          typeof parsed.telegramEnabled === 'boolean'
            ? parsed.telegramEnabled
            : DEFAULT_SECRETS.telegramEnabled,
      };
    } catch {
      return { ...DEFAULT_SECRETS };
    }
  }

  private persistToDisk(): void {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const plaintext = Buffer.from(JSON.stringify(this.cache), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = JSON.stringify(
      {
        version: 1,
        cipher: 'aes-256-gcm',
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted.toString('hex'),
      },
      null,
      2
    );

    fs.writeFileSync(this.vaultFilePath, payload, { mode: 0o600 });
  }

  public getSecretsInternal(): StoredSecrets {
    return { ...this.cache };
  }

  public updateBit24Credentials(apiKey: string, secretKey: string): void {
    this.cache.bit24ApiKey = apiKey.trim();
    this.cache.bit24SecretKey = secretKey.trim();
    this.persistToDisk();
  }

  public clearBit24Credentials(): void {
    this.cache.bit24ApiKey = '';
    this.cache.bit24SecretKey = '';
    this.persistToDisk();
  }

  public updateTelegramConfig(params: {
    botToken?: string;
    chatId?: string;
    enabled?: boolean;
  }): void {
    if (typeof params.botToken === 'string' && params.botToken.trim() !== '') {
      this.cache.telegramBotToken = params.botToken.trim();
    }
    if (typeof params.chatId === 'string' && params.chatId.trim() !== '') {
      this.cache.telegramChatId = params.chatId.trim();
    }
    if (typeof params.enabled === 'boolean') {
      this.cache.telegramEnabled = params.enabled;
    }
    this.persistToDisk();
  }

  public getPublicSafeSummary() {
    return {
      hasBit24ApiKey: Boolean(this.cache.bit24ApiKey),
      hasBit24SecretKey: Boolean(this.cache.bit24SecretKey),
      maskedBit24ApiKey: maskSensitiveValue(this.cache.bit24ApiKey),
      telegramConfigured: Boolean(
        this.cache.telegramBotToken && this.cache.telegramChatId
      ),
      telegramEnabled: this.cache.telegramEnabled,
      maskedTelegramChatId: maskSensitiveValue(this.cache.telegramChatId),
    };
  }
}
