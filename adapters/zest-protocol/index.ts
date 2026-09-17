/**
 * Zest Protocol adapter.
 *
 * Yield: Zest supply APY (on-chain v0-rates) + sBTC stacking APR
 *        (next-cycle, post-halving-aware).
 * TVL:   Sum of sBTC balances held by Zest's vault contracts on Stacks
 *        (sBTC valued 1:1 with BTC).
 */

import { createRate, defineAdapter } from "@bitcoinyield/adapters";
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

    if (stackingApr <= 0) {
      throw new Error(
        `zest-protocol: stackingApr=${stackingApr} — source is broken`,
      );
    }
    const rate = createRate({
      type: "apr",
      value: stackingApr,
      basis: "reported",
      source:
        "https://dual-stacking-v3-server.degenlab.io/dual-stacking-server/last-cycle-aprs",
      compounding: { method: "none" },
    });

    return [
      {
        symbol: "sBTC",
        tvlBtc,
        rate,
        metadata: {
          supplyApy,
          stackingApr,
          componentPolicy:
            "Headline excludes supply APY; APR and APY components are not summed",
        },
      },
    ];
  },
});
