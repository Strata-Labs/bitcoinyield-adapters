/**
 * Zest Protocol adapter.
 *
 * Yield: sBTC supply APY from v0-rates.
 * TVL:   total sBTC supplied to the V2 vault (sBTC valued 1:1 with BTC).
 */

import { defineAdapter } from "@bitcoinyield/adapters";
import { getTotalSbtcBtc } from "./vaults.js";
import { getSupplyApy } from "./rates.js";

export default defineAdapter({
  slug: "zest-protocol",
  name: "Zest Protocol",
  url: "https://zestprotocol.com",
  category: "lending",
  custody: "multisig",
  requires: { stacks: true },

  async fetch() {
    const [tvlBtc, supplyApy] = await Promise.all([
      getTotalSbtcBtc(),
      getSupplyApy(),
    ]);

    // Spot rate, the contract has no history to take a window over.
    return [{ symbol: "sBTC", tvlBtc, rate: supplyApy, rateType: "apy" }];
  },
});
