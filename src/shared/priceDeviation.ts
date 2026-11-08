/** Exact decimal 30-basis-point guard shared by paper and reviewed live execution. */
const SCALE = 10n ** 12n;
export function decimalPrice(value: string): bigint {
  if (!/^\d+(?:\.\d{1,12})?$/.test(value) || value.length > 40)
    throw Error("INVALID_DECIMAL_PRICE");
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0"));
  if (n <= 0n) throw Error("INVALID_DECIMAL_PRICE");
  return n;
}
export function enforcePriceDeviation(reference: string, market: string): void {
  const ref = decimalPrice(reference),
    price = decimalPrice(market),
    diff = ref > price ? ref - price : price - ref;
  // Exact cross-multiplication: 30 basis points, including boundary equality.
  if (diff * 10000n > ref * 30n) throw Error("SLIPPAGE_ABOVE_0_3_PERCENT");
}
