import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface EncryptedPayload {
  saltHex: string;
  ivHex: string;
  authTagHex: string;
  cipherHex: string;
  updatedAt: number;
}

export interface DecryptedBit24Credentials {
  apiKey: string;
  secretKey: string;
}

const VAULT_FILE = path.resolve(process.cwd(), 'data', 'bit24-vault.enc.json');
const SERVER_MASTER_PEPPER =
  process.env.BIT24_VAULT_SECRET || 'bit24-ai-gold-local-aes256-pepper-v2';

export class Bit24CredentialVault {
  private cached: DecryptedBit24Credentials | null = null;

  constructor() {
    // 1. Prefer server environment variables if explicitly configured (.env)
    const envApi = (process.env.BIT24_API_KEY || '').trim();
    const envSecret = (process.env.BIT24_SECRET_KEY || '').trim();
    if (envApi.length >= 8) {
      this.cached = { apiKey: envApi, secretKey: envSecret };
      return;
    }

    // 2. Otherwise try loading AES-256-GCM encrypted server vault file
    this.tryAutoLoadWithDefaultPassphrase();
  }

  private deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.scryptSync(`${passphrase}::${SERVER_MASTER_PEPPER}`, salt, 32);
  }

  public saveCredentials(
    apiKey: string,
    secretKey: string,
    passphrase = 'default-device-lock'
  ): { maskedKey: string } {
    const cleanApi = apiKey.trim();
    const cleanSecret = secretKey.trim();
    if (cleanApi.length < 8 || cleanApi.length > 256) {
      throw new Error('کلید API بیت‌۲۴ معتبر نیست (طول کلید خارج از محدوده مجاز است).');
    }
    if (cleanSecret.length > 256) {
      throw new Error('فرمت کلید اختصاصی (Secret Key) نامعتبر است.');
    }

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = this.deriveKey(passphrase, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const plaintext = JSON.stringify({ apiKey: cleanApi, secretKey: cleanSecret });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      saltHex: salt.toString('hex'),
      ivHex: iv.toString('hex'),
      authTagHex: authTag.toString('hex'),
      cipherHex: encrypted.toString('hex'),
      updatedAt: Date.now(),
    };

    fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true });
    fs.writeFileSync(VAULT_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });

    this.cached = { apiKey: cleanApi, secretKey: cleanSecret };
    return { maskedKey: maskApiKey(cleanApi) };
  }

  private tryAutoLoadWithDefaultPassphrase(): void {
    try {
      if (!fs.existsSync(VAULT_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) as EncryptedPayload;
      const salt = Buffer.from(raw.saltHex, 'hex');
      const iv = Buffer.from(raw.ivHex, 'hex');
      const authTag = Buffer.from(raw.authTagHex, 'hex');
      const cipherBuf = Buffer.from(raw.cipherHex, 'hex');

      const key = this.deriveKey('default-device-lock', salt);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString(
        'utf8'
      );
      const parsed = JSON.parse(decrypted) as DecryptedBit24Credentials;
      if (parsed.apiKey) {
        this.cached = parsed;
      }
    } catch {
      this.cached = null;
    }
  }

  public getCredentials(): DecryptedBit24Credentials | null {
    return this.cached;
  }

  public isConfigured(): boolean {
    return Boolean(this.cached?.apiKey);
  }

  public getMaskedKey(): string | null {
    if (!this.cached?.apiKey) return null;
    return maskApiKey(this.cached.apiKey);
  }

  /**
   * Scrubs any occurrence of configured API/Secret keys or long hex/token strings from logs.
   */
  public redactSensitiveText(input: string): string {
    let out = input;
    if (this.cached?.apiKey && this.cached.apiKey.length >= 6) {
      out = out.split(this.cached.apiKey).join('[REDACTED_API_KEY]');
    }
    if (this.cached?.secretKey && this.cached.secretKey.length >= 6) {
      out = out.split(this.cached.secretKey).join('[REDACTED_SECRET_KEY]');
    }
    return out.replace(/[A-Za-z0-9_-]{36,}/g, '[REDACTED_TOKEN]');
  }

  public clearCredentials(): void {
    this.cached = null;
    if (fs.existsSync(VAULT_FILE)) {
      fs.unlinkSync(VAULT_FILE);
    }
  }
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
