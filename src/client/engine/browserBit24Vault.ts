const STORAGE_KEY = 'bit24_ai_gold_encrypted_vault_v2';

interface StoredEncryptedVault {
  saltB64: string;
  ivB64: string;
  cipherB64: string;
  maskedKey: string;
  proxyUrl?: string;
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(`${passphrase}::bit24-android-local-vault`),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function maskBrowserApiKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export async function saveEncryptedBrowserCredentials(
  apiKey: string,
  secretKey: string,
  passphrase = 'android-device-default',
  proxyUrl = ''
): Promise<{ maskedKey: string; proxyUrl: string }> {
  const cleanApi = apiKey.trim();
  if (cleanApi.length < 8) {
    throw new Error('کلید API بیت‌۲۴ کوتاه‌تر از حد مجاز است.');
  }
  const cleanProxy = proxyUrl.trim().replace(/\/+$/, '');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(passphrase, salt);

  const enc = new TextEncoder();
  const plaintext = enc.encode(
    JSON.stringify({
      apiKey: cleanApi,
      secretKey: secretKey.trim(),
      proxyUrl: cleanProxy,
    })
  );
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);

  const maskedKey = maskBrowserApiKey(cleanApi);
  const record: StoredEncryptedVault = {
    saltB64: bufToB64(salt),
    ivB64: bufToB64(iv),
    cipherB64: bufToB64(cipher),
    maskedKey,
    proxyUrl: cleanProxy,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  return { maskedKey, proxyUrl: cleanProxy };
}

export async function loadEncryptedBrowserCredentials(
  passphrase = 'android-device-default'
): Promise<{
  apiKey: string;
  secretKey: string;
  maskedKey: string;
  proxyUrl: string;
} | null> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredEncryptedVault;
    const salt = b64ToBuf(parsed.saltB64);
    const iv = b64ToBuf(parsed.ivB64);
    const cipher = b64ToBuf(parsed.cipherB64);

    const aesKey = await deriveAesKey(passphrase, salt);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      aesKey,
      cipher as unknown as BufferSource
    );
    const decoded = JSON.parse(new TextDecoder().decode(plainBuf));
    return {
      apiKey: decoded.apiKey,
      secretKey: decoded.secretKey || '',
      maskedKey: parsed.maskedKey,
      proxyUrl: decoded.proxyUrl || parsed.proxyUrl || '',
    };
  } catch {
    return null;
  }
}

export function getStoredMaskedBrowserKey(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as StoredEncryptedVault).maskedKey || null;
  } catch {
    return null;
  }
}

export function getStoredBrowserProxyUrl(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as StoredEncryptedVault).proxyUrl || '';
  } catch {
    return '';
  }
}

export function clearEncryptedBrowserCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
}
