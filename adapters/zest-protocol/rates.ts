/**
 * Zest's sBTC supply APY from the v0-rates contract.
 */

import { math, requirePositive, stacks } from "@bitcoinyield/adapters";
import { DEPLOYER } from "./constants.js";

export async function getSupplyApy(): Promise<number> {
  const result = await stacks.callReadOnly({
    contract: `${DEPLOYER}.v0-rates`,
    functionName: "get-rates-sbtc",
  });
  // The contract returns { supply-apy: uint, borrow-apy: uint } where uints
  // are scaled by 10000 (e.g. 350 means 3.50%).
  const supply = requirePositive(
    extractField(result, "supply-apy"),
    "v0-rates supply-apy",
  );
  return math.div(supply, 100);
}

/**
 * Best-effort extraction of a field from a Clarity-decoded value.
 * Clarity tuples decode to objects with string keys, sometimes wrapped in
 * { type, value } envelopes. This drills through both shapes.
 */
function extractField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  // Unwrap "value" envelope
  const inner =
    "value" in obj && typeof obj.value === "object" && obj.value !== null
      ? (obj.value as Record<string, unknown>)
      : obj;
  const f = inner[field];
  if (f === undefined) return undefined;
  // Unwrap value envelope on the field too
  if (typeof f === "object" && f !== null && "value" in f) {
    return (f as { value: unknown }).value;
  }
  return f;
}
