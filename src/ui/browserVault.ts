const STORAGE_KEY = 'bit24_pro_encrypted_vault_v1';

export interface BrowserStoredConfig {
  bit24ApiKey: string;
  bit24SecretKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramEnabled: boolean;
}

function maskKey(val: string): string {
  const s = (val || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

async function deriveDeviceAesKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(`bit24-ai-trader-pro::${window.location.origin}::aes-gcm-v1`),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('bit24-pro-pwa-salt-2026'),
      iterations: 60_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function saveEncryptedBrowserVault(
  cfg: BrowserStoredConfig
): Promise<void> {
  if (!window.crypto?.subtle) return;
  const key = await deriveDeviceAesKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(cfg));
  const cipherBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(cipherBuf)),
    })
  );
}

export async function loadEncryptedBrowserVault(): Promise<BrowserStoredConfig> {
  const fallback: BrowserStoredConfig = {
    bit24ApiKey: '',
    bit24SecretKey: '',
    telegramBotToken: '',
    telegramChatId: '',
    telegramEnabled: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || !window.crypto?.subtle) return fallback;
    const parsed = JSON.parse(raw);
    const key = await deriveDeviceAesKey();
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(parsed.iv) as BufferSource },
      key,
      base64ToBytes(parsed.ct) as BufferSource
    );
    return {
      ...fallback,
      ...JSON.parse(new TextDecoder().decode(plainBuf)),
    };
  } catch {
    return fallback;
  }
}

export function clearEncryptedBrowserVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export { maskKey };
