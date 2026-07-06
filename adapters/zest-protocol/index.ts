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

    // getSupplyApy fails soft to 0 (logged); if the stacking component is
    // also 0 the total is a fabricated 0% — fail the run instead.
    const apr = math.add(supplyApy, stackingApr);
    if (apr <= 0) {
      throw new Error(
        `zest-protocol: apr=${apr} (supplyApy=${supplyApy}, stackingApr=${stackingApr}) — both sources broken`,
      );
    }

    return [
      {
        symbol: "sBTC",
        tvlBtc,
        apr,
        metadata: { supplyApy, stackingApr },
      },
    ];
  },
});
