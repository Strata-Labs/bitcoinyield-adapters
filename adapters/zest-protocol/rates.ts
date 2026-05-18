/**
 * Helpers for fetching Zest's APR components.
 *
 * Zest's total supply yield is the sum of:
 *   1. supplyApy from the v0-rates contract (Zest's own lending APY)
 *   2. sBTC stacking APR from DegenLab's dual-stacking endpoint
 *      (the sBTC backing earns Stacks-cycle yield on top of Zest's lending yield)
 *
 * For new depositors we use the next-cycle APR rather than the current cycle —
 * post-halving the current-cycle number is stale.
 */

import { http, math, parseNumber, stacks } from '@bitcoinyield/adapters'
import { DEPLOYER } from './constants.js'

const STACKING_APR_URL =
  'https://dual-stacking-v3-server.degenlab.io/dual-stacking-server/last-cycle-aprs'

interface StackingResponse {
  next_cycle_max_defi_apr?: string
  max_defi_apr?: string
  // ... other fields ignored
}

/**
 * Fetches Zest's lending supply APY from the v0-rates contract.
 * Returns 0 if the contract is unreachable (the on-chain rates contract has
 * occasionally returned errors that aren't worth failing the whole adapter for).
 */
export async function getSupplyApy(): Promise<number> {
  try {
    const result = await stacks.callReadOnly({
      contract: `${DEPLOYER}.v0-rates`,
      functionName: 'get-rates-sbtc',
    })
    // The contract returns { supply-apy: uint, borrow-apy: uint } where uints
    // are scaled by 10000 (e.g. 350 means 3.50%).
    const supply = extractField(result, 'supply-apy')
    if (supply === undefined) return 0
    return math.div(parseNumber(supply, 0), 100)
  } catch {
    return 0
  }
}

/**
 * Fetches the next-cycle sBTC stacking APR from DegenLab.
 * Forward-looking value — what new depositors will earn on the next cycle.
 */
export async function getStackingApr(): Promise<number> {
  const data = await http.get<StackingResponse>(STACKING_APR_URL)
  const value = data.next_cycle_max_defi_apr ?? data.max_defi_apr
  return parseNumber(value, 0)
}

/**
 * Best-effort extraction of a field from a Clarity-decoded value.
 * Clarity tuples decode to objects with string keys, sometimes wrapped in
 * { type, value } envelopes. This drills through both shapes.
 */
function extractField(value: unknown, field: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  // Unwrap "value" envelope
  const inner =
    'value' in obj && typeof obj.value === 'object' && obj.value !== null
      ? (obj.value as Record<string, unknown>)
      : obj
  const f = inner[field]
  if (f === undefined) return undefined
  // Unwrap value envelope on the field too
  if (typeof f === 'object' && f !== null && 'value' in f) {
    return (f as { value: unknown }).value
  }
  return f
}
