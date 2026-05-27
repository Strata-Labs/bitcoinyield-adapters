/**
 * Stacks Dual Stacking (Base) adapter.
 *
 * sBTC base-tier dual-stacking yield. Uses DegenLab v3's next-cycle base APR
 * since current-cycle numbers go stale immediately after cycle transitions
 * (especially around halvings).
 */

import {
  defineAdapter,
  http,
  parseNumber,
  requireNumber,
} from "@bitcoinyield/adapters";

const ENDPOINT =
  "https://dual-stacking-v3-server.degenlab.io/dual-stacking-server/last-cycle-aprs";

interface ApyResponse {
  cycle_id?: string;
  base_apr?: string;
  max_defi_apr?: string;
  stacking_apr?: string;
  base_tvl?: string;
  base_sbtc?: string;
  next_cycle_base_apr?: string;
  next_cycle_max_defi_apr?: string;
}

export default defineAdapter({
  slug: "stacks-dual-stacking",
  name: "Stacks Dual Stacking (Base)",
  url: "https://stx.eco/dual-stack",
  category: "staking",
  custody: "self",

  async fetch() {
    const data = await http.get<ApyResponse>(ENDPOINT);
    if (!data?.next_cycle_base_apr) {
      throw new Error("Invalid DegenLab response: missing next_cycle_base_apr");
    }

    const apr = requireNumber(data.next_cycle_base_apr, "next_cycle_base_apr");
    const tvlBtc = parseNumber(data.base_sbtc, 0);
    const tvlUsd = parseNumber(data.base_tvl, 0);

    return [
      {
        symbol: "sBTC",
        tvlBtc,
        ...(tvlUsd > 0 ? { tvlUsd } : {}),
        apr,
        metadata: {
          cycleId: data.cycle_id,
          baseApr: parseNumber(data.base_apr, 0),
          maxDefiApr: parseNumber(data.max_defi_apr, 0),
          stackingApr: parseNumber(data.stacking_apr, 0),
          nextCycleBaseApr: apr,
        },
      },
    ];
  },
});
