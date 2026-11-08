import crypto from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import path from "node:path";

export interface StoredSecrets {
  bit24ApiKey: string;
  bit24SecretKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramEnabled: boolean;
}

const DEFAULT_SECRETS: StoredSecrets = {
  bit24ApiKey: process.env.BIT24_API_KEY || "",
  bit24SecretKey: process.env.BIT24_SECRET_KEY || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  telegramEnabled: Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
  ),
};

export function maskSensitiveValue(raw: string): string {
  const clean = (raw || "").trim();
  if (!clean) return "";
  if (clean.length <= 8) return "****";
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export class EncryptedSecretVault {
  private readonly vaultFilePath: string;
  private readonly encryptionKey: Buffer;
  private cache: StoredSecrets;
  private readonly durableKeyConfigured: boolean;

  constructor(customFilePath?: string) {
    this.vaultFilePath =
      customFilePath || path.resolve(process.cwd(), ".bit24-vault.enc");
    const passphrase = process.env.BIT24_VAULT_PASSPHRASE;
    this.durableKeyConfigured =
      typeof passphrase === "string" && passphrase.length >= 32;
    // No predictable hostname/path-derived key. Empty Demo vault can exist in memory only.
    if (fs.existsSync(this.vaultFilePath) && !this.durableKeyConfigured)
      throw Error("VAULT_PASSPHRASE_REQUIRED");
    this.encryptionKey = this.durableKeyConfigured
      ? crypto.scryptSync(passphrase!, "bit24-pro-aes256gcm-salt-v1", 32)
      : crypto.randomBytes(32);
    this.cache = this.loadFromDisk();
  }

  private loadFromDisk(): StoredSecrets {
    try {
      if (!fs.existsSync(this.vaultFilePath)) {
        return { ...DEFAULT_SECRETS };
      }
      const rawJson = JSON.parse(fs.readFileSync(this.vaultFilePath, "utf8"));
      const iv = Buffer.from(rawJson.iv, "hex");
      const tag = Buffer.from(rawJson.tag, "hex");
      const ciphertext = Buffer.from(rawJson.data, "hex");

      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.encryptionKey,
        iv,
      );
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
      return z
        .object({
          bit24ApiKey: z.string(),
          bit24SecretKey: z.string(),
          telegramBotToken: z.string(),
          telegramChatId: z.string(),
          telegramEnabled: z.boolean(),
        })
        .strict()
        .parse(JSON.parse(decrypted));
    } catch {
      // Wrong key/tampered data must not silently fall back to environment credentials.
      throw Error("VAULT_INVALID_PRESERVE_AND_RESTORE");
    }
  }

  private persistToDisk(): void {
    if (!this.durableKeyConfigured) throw Error("VAULT_PASSPHRASE_REQUIRED");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const plaintext = Buffer.from(JSON.stringify(this.cache), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = JSON.stringify(
      {
        version: 1,
        cipher: "aes-256-gcm",
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        data: encrypted.toString("hex"),
      },
      null,
      2,
    );

    fs.mkdirSync(path.dirname(this.vaultFilePath), {
      recursive: true,
      mode: 0o700,
    });
    const temp = this.vaultFilePath + "." + crypto.randomUUID() + ".tmp";
    let fd: number | undefined;
    try {
      fd = fs.openSync(temp, "wx", 0o600);
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, this.vaultFilePath);
      if (process.platform !== "win32") {
        const dir = fs.openSync(path.dirname(this.vaultFilePath), "r");
        try {
          fs.fsyncSync(dir);
        } finally {
          fs.closeSync(dir);
        }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }

  public getSecretsInternal(): StoredSecrets {
    return { ...this.cache };
  }

  public updateBit24Credentials(apiKey: string, secretKey: string): void {
    if (!this.durableKeyConfigured) throw Error("VAULT_PASSPHRASE_REQUIRED");
    this.cache.bit24ApiKey = apiKey.trim();
    this.cache.bit24SecretKey = secretKey.trim();
    this.persistToDisk();
  }

  public clearBit24Credentials(): void {
    if (!this.durableKeyConfigured) throw Error("VAULT_PASSPHRASE_REQUIRED");
    this.cache.bit24ApiKey = "";
    this.cache.bit24SecretKey = "";
    this.persistToDisk();
  }

  public updateTelegramConfig(params: {
    botToken?: string;
    chatId?: string;
    enabled?: boolean;
  }): void {
    if (!this.durableKeyConfigured) throw Error("VAULT_PASSPHRASE_REQUIRED");
    if (typeof params.botToken === "string" && params.botToken.trim() !== "") {
      this.cache.telegramBotToken = params.botToken.trim();
    }
    if (typeof params.chatId === "string" && params.chatId.trim() !== "") {
      this.cache.telegramChatId = params.chatId.trim();
    }
    if (typeof params.enabled === "boolean") {
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
        this.cache.telegramBotToken && this.cache.telegramChatId,
      ),
      telegramEnabled: this.cache.telegramEnabled,
      maskedTelegramChatId: maskSensitiveValue(this.cache.telegramChatId),
    };
  }
}
