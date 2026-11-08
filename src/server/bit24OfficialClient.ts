import crypto from "node:crypto";
import type { EncryptedSecretVault } from "./encryptedVault.js";
export const BIT24_REST_BASE_URL = "https://rest.bit24.cash";
export function assertNoWithdrawalEndpoint(endpointPath: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(endpointPath).toLowerCase();
  } catch {
    throw Error("INVALID_ENDPOINT");
  }
  if (/withdraw|transfer|payout/i.test(decoded))
    throw Error("BIT24_WITHDRAWAL_FORBIDDEN");
}
/** Generic legacy utility only; NOT evidence that this is Bit24's verified authentication protocol. */
export function createBit24HmacSignature(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}
/** Replaces the old unreachable, guessed implementation (which fabricated fills from order ACKs).
 * Never remove this gate to "enable" live trading. Supply a reviewed VerifiedSpotAdapter instead.
 */
export class Bit24OfficialRestClient {
  constructor(_vault: EncryptedSecretVault, _baseUrl = BIT24_REST_BASE_URL) {
    throw Error("DEMO_ONLY_OFFICIAL_API_CONTRACT_UNVERIFIED");
  }
}
