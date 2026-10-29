/**
 * Reads total sBTC supplied to Zest's V2 sBTC vault.
 */

import { math, requirePositive, stacks } from "@bitcoinyield/adapters";
import { SBTC_DECIMALS, SBTC_VAULT } from "./constants.js";

/**
 * Total assets (lent out + idle) in BTC, which is the "Total Supplied" figure
 * on Zest's sBTC page. The vault's sBTC balance only holds the idle part.
 */
export async function getTotalSbtcBtc(): Promise<number> {
  const result = await stacks.callReadOnly({
    contract: SBTC_VAULT,
    functionName: "get-total-assets",
  });
  // (ok uint) decodes to { type: "uint", value: "<sats>" }.
  const raw =
    typeof result === "object" && result !== null && "value" in result
      ? (result as { value: unknown }).value
      : result;
  const sats = requirePositive(String(raw), "v0-vault-sbtc get-total-assets");
  return math.fromUnits(sats, SBTC_DECIMALS);
}
