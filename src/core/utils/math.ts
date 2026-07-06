/**
 * Decimal-safe math primitives.
 *
 * Floating-point math is lossy when adapters do `tvl * btcPrice` or
 * `weiBigInt / 1e18`. We use decimal.js underneath so common bugs
 * (silent precision loss, NaN propagation) don't reach the database.
 *
 * Invalid input THROWS. A renamed API field must fail the run loudly,
 * not flow downstream as 0 — silent zeros are the bug class this repo
 * exists to prevent. `div` is the one deliberate exception: it takes an
 * explicit fallback for denominator-zero (pass `undefined` to throw).
 */

import Decimal from "decimal.js";

export type Numeric = number | string | bigint | Decimal;

function toDecimal(value: Numeric, op: string): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "bigint") return new Decimal(value.toString());
  try {
    const d = new Decimal(value as number | string);
    if (!d.isFinite()) {
      throw new Error(`math.${op}: non-finite input ${String(value)}`);
    }
    return d;
  } catch (err) {
    throw err instanceof Error && err.message.startsWith("math.")
      ? err
      : new Error(`math.${op}: invalid input ${describeInput(value)}`);
  }
}

function describeInput(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function toFiniteNumber(d: Decimal, op: string): number {
  const n = d.toNumber();
  if (!Number.isFinite(n)) {
    throw new Error(`math.${op}: result is not finite (${d.toString()})`);
  }
  return n;
}

/**
 * Sum any number of values. Throws on invalid/non-finite input.
 * Example: add(1, 2, 3) → 6
 */
export function add(...values: Numeric[]): number {
  let sum = new Decimal(0);
  for (const v of values) {
    sum = sum.add(toDecimal(v, "add"));
  }
  return toFiniteNumber(sum, "add");
}

export function sub(a: Numeric, b: Numeric): number {
  return toFiniteNumber(toDecimal(a, "sub").sub(toDecimal(b, "sub")), "sub");
}

export function mul(a: Numeric, b: Numeric): number {
  return toFiniteNumber(toDecimal(a, "mul").mul(toDecimal(b, "mul")), "mul");
}

/**
 * Safe divide. Returns fallback (default 0) if denominator is 0 or invalid.
 * Pass `undefined` as fallback to throw on /0 instead.
 * An invalid NUMERATOR always throws — only the denominator gets the fallback.
 */
export function div(
  a: Numeric,
  b: Numeric,
  fallback: number | undefined = 0,
): number {
  const numerator = toDecimal(a, "div");
  let denom: Decimal;
  try {
    denom = toDecimal(b, "div");
  } catch (err) {
    if (fallback === undefined) throw err;
    return fallback;
  }
  if (denom.isZero()) {
    if (fallback === undefined) {
      throw new Error(`Division by zero: ${numerator.toString()} / 0`);
    }
    return fallback;
  }
  return toFiniteNumber(numerator.div(denom), "div");
}

/**
 * Convert from raw units (e.g., wei, satoshis, smallest token unit) to decimal.
 * Example: fromUnits(100_000_000n, 8) → 1.0   (1 BTC in satoshis)
 * Example: fromUnits('1000000000000000000', 18) → 1.0   (1 ETH in wei)
 */
export function fromUnits(value: Numeric, decimals: number): number {
  if (decimals < 0) throw new Error(`Invalid decimals: ${decimals}`);
  const divisor = new Decimal(10).pow(decimals);
  return toFiniteNumber(
    toDecimal(value, "fromUnits").div(divisor),
    "fromUnits",
  );
}

/**
 * Convert from decimal to raw units (returns bigint).
 * Example: toUnits(1.5, 8) → 150_000_000n
 */
export function toUnits(value: Numeric, decimals: number): bigint {
  if (decimals < 0) throw new Error(`Invalid decimals: ${decimals}`);
  const multiplier = new Decimal(10).pow(decimals);
  return BigInt(toDecimal(value, "toUnits").mul(multiplier).toFixed(0));
}

/**
 * Convert basis points to percent.
 * Example: fromBps(466) → 4.66
 */
export function fromBps(bps: Numeric): number {
  return div(bps, 100, undefined);
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
