/**
 * Loud validators. Throw on invalid input so the runner retries instead of
 * persisting a bad row.
 */

/**
 * Throws if value is not a positive finite number.
 *
 * Example:
 *   const apr = requirePositive(data.apr, 'data.apr')
 *   // throws "Expected positive number for data.apr, got 0" if data.apr is 0/null/undefined/NaN
 */
export function requirePositive(value: unknown, name: string = 'value'): number {
  if (typeof value !== 'number') {
    if (typeof value === 'string') {
      const parsed = parseFloat(value)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
    throw new Error(`Expected positive number for ${name}, got ${describe(value)}`)
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number for ${name}, got ${value}`)
  }
  if (value <= 0) {
    throw new Error(`Expected positive number for ${name}, got ${value}`)
  }
  return value
}

/**
 * Throws if value is not a finite number (allows zero and negatives).
 */
export function requireNumber(value: unknown, name: string = 'value'): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error(`Expected finite number for ${name}, got ${describe(value)}`)
}

/**
 * Parses a value as a number, returning fallback if invalid (no throw).
 * Use only when you genuinely want graceful fallback (rare).
 */
export function parseNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

/**
 * Parses a percent value from various input formats.
 * Accepts: 4.5, "4.5", "4.5%", " 4.5 % "
 */
export function parsePercent(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/%$/, '').trim()
    const parsed = parseFloat(cleaned)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error(`Cannot parse percent from ${describe(value)}`)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}
