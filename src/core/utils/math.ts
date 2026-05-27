/**
 * Decimal-safe math primitives.
 *
 * Floating-point math is lossy when adapters do `tvl * btcPrice` or
 * `weiBigInt / 1e18`. We use decimal.js underneath so common bugs
 * (silent precision loss, NaN propagation) don't reach the database.
 */

import Decimal from "decimal.js";

export type Numeric = number | string | bigint | Decimal;

function toDecimal(value: Numeric): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "bigint") return new Decimal(value.toString());
  return new Decimal(value as number | string);
}

function isFiniteNumber(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Sum any number of values. Skips non-finite values silently.
 * Example: add(1, 2, 3) → 6
 */
export function add(...values: Numeric[]): number {
  let sum = new Decimal(0);
  for (const v of values) {
    try {
      const d = toDecimal(v);
      if (d.isFinite()) sum = sum.add(d);
    } catch {
      // skip invalid value
    }
  }
  const result = sum.toNumber();
  return isFiniteNumber(result) ? result : 0;
}

export function sub(a: Numeric, b: Numeric): number {
  const result = toDecimal(a).sub(toDecimal(b)).toNumber();
  return isFiniteNumber(result) ? result : 0;
}

export function mul(a: Numeric, b: Numeric): number {
  try {
    const result = toDecimal(a).mul(toDecimal(b)).toNumber();
    return isFiniteNumber(result) ? result : 0;
  } catch {
    return 0;
  }
}

/**
 * Safe divide. Returns fallback (default 0) if denominator is 0 or invalid.
 * Pass `undefined` as fallback to throw on /0 instead.
 */
export function div(
  a: Numeric,
  b: Numeric,
  fallback: number | undefined = 0,
): number {
  try {
    const denom = toDecimal(b);
    if (denom.isZero() || !denom.isFinite()) {
      if (fallback === undefined) {
        throw new Error(
          `Division by zero or invalid denominator: ${String(b)}`,
        );
      }
      return fallback;
    }
    const result = toDecimal(a).div(denom).toNumber();
    return isFiniteNumber(result) ? result : (fallback ?? 0);
  } catch (err) {
    if (fallback === undefined) throw err;
    return fallback;
  }
}

/**
 * Convert from raw units (e.g., wei, satoshis, smallest token unit) to decimal.
 * Example: fromUnits(100_000_000n, 8) → 1.0   (1 BTC in satoshis)
 * Example: fromUnits('1000000000000000000', 18) → 1.0   (1 ETH in wei)
 */
export function fromUnits(value: Numeric, decimals: number): number {
  if (decimals < 0) throw new Error(`Invalid decimals: ${decimals}`);
  const divisor = new Decimal(10).pow(decimals);
  const result = toDecimal(value).div(divisor).toNumber();
  return isFiniteNumber(result) ? result : 0;
}

/**
 * Convert from decimal to raw units (returns bigint).
 * Example: toUnits(1.5, 8) → 150_000_000n
 */
export function toUnits(value: Numeric, decimals: number): bigint {
  if (decimals < 0) throw new Error(`Invalid decimals: ${decimals}`);
  const multiplier = new Decimal(10).pow(decimals);
  return BigInt(toDecimal(value).mul(multiplier).toFixed(0));
}

/**
 * Convert basis points to percent.
 * Example: fromBps(466) → 4.66
 */
export function fromBps(bps: Numeric): number {
  return div(bps, 100);
}

/**
 * Convert decimal rate (0-1) to percent.
 * Example: toPercent(0.045) → 4.5
 */
export function toPercent(rate: Numeric): number {
  return mul(rate, 100);
}

/**
 * Clamp a number into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
