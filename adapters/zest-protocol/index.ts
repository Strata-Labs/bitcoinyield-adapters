/**
 * Zest Protocol adapter.
 *
 * Yield: Zest supply APY (on-chain v0-rates) + sBTC stacking APR
 *        (next-cycle, post-halving-aware).
 * TVL:   Sum of sBTC balances held by Zest's vault contracts on Stacks
 *        (sBTC valued 1:1 with BTC).
 */

import { defineAdapter, math } from "@bitcoinyield/adapters";
import { getTotalSbtcBtc } from "./vaults.js";
import { getStackingApr, getSupplyApy } from "./rates.js";

export default defineAdapter({
  slug: "zest-protocol",
  name: "Zest Protocol",
  url: "https://zestprotocol.com",
  category: "lending",
  custody: "multisig",
  requires: { stacks: true },

  async fetch() {
    const [tvlBtc, supplyApy, stackingApr] = await Promise.all([
      getTotalSbtcBtc(),
      getSupplyApy(),
      getStackingApr(),
    ]);

    return [
      {
        symbol: "sBTC",
        tvlBtc,
        apr: math.add(supplyApy, stackingApr),
        metadata: { supplyApy, stackingApr },
      },
    ];
  },
});
